/**
 * The deferred-LLM cron tick (PRD D6) — runs on the frequent cadence.
 *
 *   1. SLA      — a job with no answer after {@link BATCH_SLA_MS} runs synchronously now.
 *   2. Settle   — poll every open provider batch; an ended one's results are metered at
 *                 the batch rate and handed to the job's registered handler.
 *   3. Recover  — rows a crashed tick left mid-submit / mid-fallback are released.
 *   4. Submit   — queued jobs are grouped per (provider, credential, model) into ONE
 *                 provider batch each.
 *
 * A job leaves the batch path for the synchronous one — the same provider, model and
 * credential, priced at the standard rate, its reason recorded on the row
 * (`fallback_reason`) and the usage metadata — when it outlives its SLA, exhausts
 * {@link BATCH_MAX_ATTEMPTS}, or the provider refused it inside the batch.
 *
 * Every dependency is injected so the tick is tested without a database or a network.
 */
import type { Env } from '../../../env';
import type { Db } from '../../../infrastructure/database/connection';
import { reportCaughtError } from '../../observability/caughtErrorReporter';
import { toLlmUsage } from '../proxyTypes';
import { logTrace } from '../traceLogger';
import { normalizeByoProvider, recordUsageRow } from '../usageLedger';
import { anthropicBatchAdapter } from '../vendors/anthropicBatch';
import { openaiBatchAdapter } from '../vendors/openaiBatch';
import type { VendorCallResult } from '../vendors/types';
import { BATCH_CALLBACKS } from './batchCallbackRegistry';
import type { BatchCallbackHandler, BatchSettleContext } from './batchCallbacks';
import { resolveBatchApiKey } from './batchCredentials';
import { drizzleBatchJobStore, type BatchJobStore } from './batchJobStore';
import {
  BATCH_MAX_ATTEMPTS,
  BATCH_SLA_MS,
  batchCustomId,
  type BatchCallbackKind,
  type BatchFunding,
  type BatchJob,
  type BatchVendor,
} from './batchTypes';
import type { BatchVendorAdapter } from './batchVendorPort';
import { hasBatchWork } from './batchWorkMarker';

export const BATCH_TICK_LIMITS = {
  /** Queued jobs claimed for submission per tick. */
  submitPerTick: 2000,
  /** Requests per provider batch (both providers allow far more). */
  perBatch: 500,
  /** Open provider batches polled per tick. */
  pollPerTick: 50,
  /** Overdue jobs run synchronously per tick — bounded so a backlog cannot eat the tick. */
  overduePerTick: 25,
  /** A mid-submit / mid-fallback row untouched this long was left by a crashed tick. */
  staleMs: 60 * 60 * 1000,
} as const;

/** How a metered call was served. */
export interface BatchUsageHow {
  batched: boolean;
  providerBatchId?: string;
  fallbackReason?: string;
}

export interface BatchTickDeps {
  store: BatchJobStore;
  adapters: Readonly<Record<BatchVendor, BatchVendorAdapter>>;
  handlers: Readonly<Record<BatchCallbackKind, BatchCallbackHandler>>;
  resolveKey(vendor: BatchVendor, funding: BatchFunding, tenantId: number): Promise<string | null>;
  recordUsage(job: BatchJob, result: VendorCallResult, how: BatchUsageHow): Promise<void>;
  now(): Date;
}

export interface BatchTickSummary {
  submitted: number;
  batches: number;
  settled: number;
  requeued: number;
  syncFallbacks: number;
  failed: number;
}

export const BATCH_ADAPTERS: Readonly<Record<BatchVendor, BatchVendorAdapter>> = {
  anthropic: anthropicBatchAdapter,
  openai: openaiBatchAdapter,
};

/** The production wiring. */
export function defaultBatchTickDeps(env: Env, db: Db): BatchTickDeps {
  return {
    store: drizzleBatchJobStore(db),
    adapters: BATCH_ADAPTERS,
    handlers: BATCH_CALLBACKS,
    resolveKey: (vendor, funding, tenantId) => resolveBatchApiKey(env, tenantId, vendor, funding),
    recordUsage: (job, result, how) => recordBatchUsage(env, db, job, result, how),
    now: () => new Date(),
  };
}

/**
 * Meter one served job through THE ledger write, and write its `llm_traces` row like any
 * synchronous call. A batch answer is priced at the batch rate (`pricingTier: 'batch'`);
 * a synchronous fallback at the standard one, with why.
 */
export async function recordBatchUsage(env: Env, db: Db, job: BatchJob, result: VendorCallResult, how: BatchUsageHow): Promise<void> {
  await traceBatchCall(env, job, result, how);
  if (!result.usage) {
    console.warn(`[llm-batch] job=${job.id} ${job.vendor}/${job.model} returned no usage; nothing metered`);
    return;
  }
  await recordUsageRow(db, env, {
    tenantId: job.tenantId,
    userId: null,
    llmProduct: 'builderforceLLM',
    model: job.model,
    usage: toLlmUsage(result.usage),
    useCase: job.useCase,
    attribution: { projectId: job.projectId, taskId: job.taskId },
    byo: job.funding === 'byo',
    byoProvider: job.funding === 'byo' ? normalizeByoProvider(job.vendor) : null,
    pricingTier: how.batched ? 'batch' : 'standard',
    metadata: {
      batchJobId: job.id,
      ...(how.providerBatchId ? { providerBatchId: how.providerBatchId } : {}),
      ...(how.fallbackReason ? { batchFallbackReason: how.fallbackReason } : {}),
    },
  });
}

/**
 * The served job's diagnostic trace. Awaited through a local `waitUntil` so the cron
 * tick does not end before the insert lands; `logTrace` never throws.
 */
async function traceBatchCall(env: Env, job: BatchJob, result: VendorCallResult, how: BatchUsageHow): Promise<void> {
  const pending: Promise<unknown>[] = [];
  const usage = result.usage ? toLlmUsage(result.usage) : null;
  logTrace(env, { waitUntil: (p) => pending.push(p) }, {
    traceId: crypto.randomUUID(),
    surface: 'batch',
    tenantId: job.tenantId,
    llmProduct: 'builderforceLLM',
    useCase: job.useCase,
    result: { response: { status: 200 }, resolvedModel: answeredModel(result, job.model), resolvedVendor: job.vendor, outcome: 'success' },
    usage: usage ? { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, totalTokens: usage.totalTokens } : null,
    requestBody: { messages: job.request.messages, model: job.model, max_tokens: job.request.maxTokens, useCase: job.useCase },
    responseBody: result.raw,
    callerMetadata: {
      batchJobId: job.id,
      batched: how.batched,
      ...(how.providerBatchId ? { providerBatchId: how.providerBatchId } : {}),
      ...(how.fallbackReason ? { batchFallbackReason: how.fallbackReason } : {}),
    },
  });
  await Promise.all(pending);
}

/** The model that answered, read off the OpenAI-shape body; the job's own otherwise. */
function answeredModel(result: VendorCallResult, fallback: string): string {
  const model = (result.raw as { model?: unknown } | null)?.model;
  return typeof model === 'string' && model ? model : fallback;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

class BatchTick {
  readonly summary: BatchTickSummary = { submitted: 0, batches: 0, settled: 0, requeued: 0, syncFallbacks: 0, failed: 0 };

  constructor(private readonly ctx: BatchSettleContext, private readonly deps: BatchTickDeps) {}

  private report(error: unknown, operation: string, context: Record<string, unknown>): void {
    reportCaughtError(error, { source: 'application/llm/batch/runLlmBatchTick.ts', operation, level: 'warning', context });
  }

  /** Hand an answer to the job's handler. A handler throw fails the job (the call was
   *  already served and billed, so it is not retried). */
  private async handOff(job: BatchJob, result: VendorCallResult): Promise<boolean> {
    try {
      await this.deps.handlers[job.callbackKind].settle(this.ctx, job, { content: result.content, model: answeredModel(result, job.model) });
      return true;
    } catch (error) {
      this.report(error, 'settle', { jobId: job.id, kind: job.callbackKind });
      await this.deps.store.settle(job.id, { status: 'failed', error: `handler: ${errorText(error)}` });
      this.summary.failed++;
      return false;
    }
  }

  /** Close a job with no answer, letting its handler run its own failure fallback. */
  private async fail(job: BatchJob, error: string, fallbackReason?: string): Promise<void> {
    console.warn(`[llm-batch] job=${job.id} ${job.callbackKind} failed${fallbackReason ? ` (${fallbackReason})` : ''}: ${error}`);
    await this.deps.store.settle(job.id, { status: 'failed', error, ...(fallbackReason ? { fallbackReason } : {}) });
    this.summary.failed++;
    const abandon = this.deps.handlers[job.callbackKind].abandon;
    if (!abandon) return;
    try {
      await abandon(this.ctx, job, error);
    } catch (abandonError) {
      this.report(abandonError, 'abandon', { jobId: job.id, kind: job.callbackKind });
    }
  }

  /** Run a job the batch path gave up on synchronously (it must already be claimed). */
  async runSync(job: BatchJob, reason: string): Promise<void> {
    console.info(`[llm-batch] job=${job.id} ${job.callbackKind} runs synchronously: ${reason}`);
    this.summary.syncFallbacks++;
    const key = await this.deps.resolveKey(job.vendor, job.funding, job.tenantId);
    if (!key) return this.fail(job, `no ${job.funding} credential for ${job.vendor}`, reason);
    let result: VendorCallResult;
    try {
      result = await this.deps.adapters[job.vendor].callSync(key, job.model, job.request);
    } catch (error) {
      return this.fail(job, `sync: ${errorText(error)}`, reason);
    }
    await this.deps.recordUsage(job, result, { batched: false, fallbackReason: reason });
    if (await this.handOff(job, result)) await this.deps.store.settle(job.id, { status: 'completed', fallbackReason: reason });
  }

  /** A job the provider did not answer: back into the next batch, or synchronous once
   *  it has used its attempts. */
  private async retryOrSync(job: BatchJob, error: string): Promise<void> {
    if (job.attempts >= BATCH_MAX_ATTEMPTS) {
      if (await this.deps.store.claimForSync(job.id)) await this.runSync(job, 'batch_attempts_exhausted');
      return;
    }
    if (await this.deps.store.requeue(job.id, error)) this.summary.requeued++;
  }

  async runOverdue(): Promise<void> {
    const cutoff = new Date(this.deps.now().getTime() - BATCH_SLA_MS);
    for (const job of await this.deps.store.claimOverdue(cutoff, BATCH_TICK_LIMITS.overduePerTick)) {
      await this.runSync(job, 'sla_expired');
    }
  }

  async settleOpenBatches(): Promise<void> {
    for (const batch of await this.deps.store.openBatches(BATCH_TICK_LIMITS.pollPerTick)) {
      try {
        const key = await this.deps.resolveKey(batch.vendor, batch.funding, batch.tenantId);
        // The credential went away: leave the jobs open — the SLA pass runs them (and
        // records why) rather than settling them blind here.
        if (!key) {
          console.warn(`[llm-batch] batch=${batch.providerBatchId} has no ${batch.funding} ${batch.vendor} credential to poll with`);
          continue;
        }
        const adapter = this.deps.adapters[batch.vendor];
        const poll = await adapter.poll(key, batch.providerBatchId);
        if (poll.state === 'pending') continue;
        const jobs = await this.deps.store.jobsInBatch(batch.providerBatchId);
        if (poll.state === 'failed') {
          for (const job of jobs) await this.retryOrSync(job, poll.reason);
          continue;
        }
        const results = await adapter.results(key, batch.providerBatchId, poll.resultsRef);
        for (const job of jobs) {
          const item = results.get(batchCustomId(job.id));
          if (!item) {
            await this.retryOrSync(job, 'no result line');
          } else if (item.ok) {
            if (!await this.deps.store.claimSettle(job.id)) continue; // another tick settled it
            await this.deps.recordUsage(job, item.result, { batched: true, providerBatchId: batch.providerBatchId });
            if (await this.handOff(job, item.result)) this.summary.settled++;
          } else if (item.retryable) {
            await this.retryOrSync(job, item.error);
          } else if (await this.deps.store.claimForSync(job.id)) {
            await this.runSync(job, 'batch_item_refused');
          }
        }
      } catch (error) {
        this.report(error, 'settleOpenBatches', { providerBatchId: batch.providerBatchId, vendor: batch.vendor });
      }
    }
  }

  async submitQueued(): Promise<void> {
    await this.deps.store.releaseStale(new Date(this.deps.now().getTime() - BATCH_TICK_LIMITS.staleMs));
    const claimed = await this.deps.store.claimQueued(BATCH_TICK_LIMITS.submitPerTick);
    for (const group of groupForSubmit(claimed)) {
      const [first] = group;
      if (!first) continue;
      const ids = group.map((j) => j.id);
      const key = await this.deps.resolveKey(first.vendor, first.funding, first.tenantId);
      if (!key) {
        // Nothing can run these on this credential, batch or not.
        for (const job of group) await this.fail(job, `no ${job.funding} credential for ${job.vendor}`, 'no_batch_credential');
        continue;
      }
      try {
        const providerBatchId = await this.deps.adapters[first.vendor].submit(
          key,
          group.map((j) => ({ customId: batchCustomId(j.id), model: j.model, request: j.request })),
        );
        await this.deps.store.markSubmitted(ids, providerBatchId);
        this.summary.submitted += group.length;
        this.summary.batches++;
      } catch (error) {
        this.report(error, 'submitQueued', { vendor: first.vendor, model: first.model, jobs: ids.length });
        const exhausted = group.filter((j) => j.attempts >= BATCH_MAX_ATTEMPTS);
        await this.deps.store.release(group.filter((j) => j.attempts < BATCH_MAX_ATTEMPTS).map((j) => j.id), errorText(error));
        for (const job of exhausted) {
          if (await this.deps.store.claimForSync(job.id)) await this.runSync(job, 'submit_failed');
        }
      }
    }
  }
}

/**
 * Claimed jobs → provider batches: one per (provider, credential, model), split at
 * {@link BATCH_TICK_LIMITS.perBatch}. A BYO batch is one tenant's (it runs on their key);
 * platform jobs from every tenant share one. One model per batch — OpenAI requires it.
 * Exported for tests.
 */
export function groupForSubmit(jobs: readonly BatchJob[]): BatchJob[][] {
  const groups = new Map<string, BatchJob[]>();
  for (const job of jobs) {
    const owner = job.funding === 'byo' ? `tenant:${job.tenantId}` : 'platform';
    const key = `${job.vendor}|${owner}|${job.model}`;
    const list = groups.get(key) ?? [];
    list.push(job);
    groups.set(key, list);
  }
  const out: BatchJob[][] = [];
  for (const list of groups.values()) {
    for (let i = 0; i < list.length; i += BATCH_TICK_LIMITS.perBatch) out.push(list.slice(i, i + BATCH_TICK_LIMITS.perBatch));
  }
  return out;
}

export async function runLlmBatchTick(env: Env, db: Db, deps: BatchTickDeps = defaultBatchTickDeps(env, db)): Promise<BatchTickSummary> {
  const tick = new BatchTick({ env, db }, deps);
  // No enqueue in the last 26h ⇒ no open job; leave the queue's database asleep.
  if (!await hasBatchWork(env)) return tick.summary;
  await tick.runOverdue();
  await tick.settleOpenBatches();
  await tick.submitQueued();
  return tick.summary;
}

/** The cron log line, or null when the tick did nothing. */
export function describeBatchTick(s: BatchTickSummary): string | null {
  const busy = s.submitted + s.settled + s.requeued + s.syncFallbacks + s.failed;
  return busy > 0
    ? `submitted=${s.submitted} batches=${s.batches} settled=${s.settled} requeued=${s.requeued} sync=${s.syncFallbacks} failed=${s.failed}`
    : null;
}
