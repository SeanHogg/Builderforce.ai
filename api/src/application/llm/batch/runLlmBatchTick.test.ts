import { describe, expect, it, vi } from 'vitest';

// The tick is exercised against in-memory fakes; the KV marker reads an env with no KV
// (fail-open), and the production adapters/registry are never touched.
vi.mock('./batchCallbackRegistry', () => ({ BATCH_CALLBACKS: {} }));

import { BATCH_TICK_LIMITS, groupForSubmit, runLlmBatchTick, type BatchTickDeps, type BatchUsageHow } from './runLlmBatchTick';
import type { BatchJobStore, OpenProviderBatch } from './batchJobStore';
import type { BatchCallbackHandler } from './batchCallbacks';
import { BATCH_MAX_ATTEMPTS, BATCH_SLA_MS, batchCustomId, type BatchJob, type BatchJobStatus } from './batchTypes';
import type { BatchVendorAdapter } from './batchVendorPort';
import type { VendorCallResult } from '../vendors/types';

const NOW = new Date('2026-10-22T12:00:00Z');

function job(id: number, over: Partial<BatchJob> = {}): BatchJob {
  return {
    id, tenantId: 1, projectId: 5, taskId: null, useCase: 'brain_project_memory', callbackKind: 'project_memory',
    callbackPayload: { projectId: 5 }, request: { messages: [{ role: 'user', content: 'x' }], maxTokens: 10 },
    vendor: 'anthropic', model: 'claude-sonnet-5-5', funding: 'platform', status: 'queued', providerBatchId: null,
    attempts: 0, createdAt: NOW, ...over,
  };
}

/** A store over a plain map that enforces the same conditional transitions. */
function memoryStore(seed: BatchJob[]) {
  const rows = new Map(seed.map((j) => [j.id, { ...j, fallbackReason: null as string | null, lastError: null as string | null }]));
  const move = (id: number, from: BatchJobStatus[], to: BatchJobStatus, extra: Partial<BatchJob> = {}) => {
    const r = rows.get(id);
    if (!r || !from.includes(r.status)) return false;
    Object.assign(r, extra, { status: to });
    return true;
  };
  const store: BatchJobStore = {
    insert: async () => 0,
    claimQueued: async (limit) => [...rows.values()].filter((r) => r.status === 'queued').slice(0, limit)
      .map((r) => { r.status = 'submitting'; r.attempts += 1; return { ...r }; }),
    markSubmitted: async (ids, providerBatchId) => { for (const id of ids) move(id, ['submitting'], 'submitted', { providerBatchId }); },
    release: async (ids, error) => { for (const id of ids) { if (move(id, ['submitting'], 'queued')) rows.get(id)!.lastError = error; } },
    releaseStale: async () => 0,
    openBatches: async () => {
      const seen = new Map<string, OpenProviderBatch>();
      for (const r of rows.values()) {
        if (r.status === 'submitted' && r.providerBatchId) seen.set(r.providerBatchId, { providerBatchId: r.providerBatchId, vendor: r.vendor, funding: r.funding, tenantId: r.tenantId });
      }
      return [...seen.values()];
    },
    jobsInBatch: async (id) => [...rows.values()].filter((r) => r.providerBatchId === id && r.status === 'submitted').map((r) => ({ ...r })),
    requeue: async (id, error) => { const ok = move(id, ['submitted'], 'queued', { providerBatchId: null }); if (ok) rows.get(id)!.lastError = error; return ok; },
    claimSettle: async (id) => move(id, ['submitted'], 'completed'),
    claimOverdue: async (cutoff, limit) => [...rows.values()]
      .filter((r) => ['queued', 'submitting', 'submitted'].includes(r.status) && r.createdAt < cutoff).slice(0, limit)
      .map((r) => { r.status = 'running_sync'; return { ...r }; }),
    claimForSync: async (id) => move(id, ['queued', 'submitting', 'submitted'], 'running_sync'),
    settle: async (id, outcome) => {
      const r = rows.get(id)!;
      r.status = outcome.status;
      if (outcome.fallbackReason) r.fallbackReason = outcome.fallbackReason;
      if (outcome.error) r.lastError = outcome.error;
    },
  };
  return { store, rows };
}

const answer = (content: string): VendorCallResult => ({ raw: { model: 'claude-sonnet-5-5' }, content, usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } });

function harness(seed: BatchJob[], adapter: Partial<BatchVendorAdapter> = {}, handler: Partial<BatchCallbackHandler> = {}) {
  const { store, rows } = memoryStore(seed);
  const usage: Array<{ jobId: number; how: BatchUsageHow }> = [];
  const settled: Array<{ jobId: number; content: string }> = [];
  const full: BatchVendorAdapter = {
    vendor: 'anthropic',
    submit: vi.fn(async () => 'batch-1'),
    poll: vi.fn(async () => ({ state: 'pending' as const })),
    results: vi.fn(async () => new Map()),
    callSync: vi.fn(async () => answer('sync answer')),
    ...adapter,
  };
  const record: BatchCallbackHandler['settle'] = async (_ctx, j, c) => { settled.push({ jobId: j.id, content: c.content }); };
  const h: BatchCallbackHandler = { settle: vi.fn(record), ...handler };
  const deps: BatchTickDeps = {
    store,
    adapters: { anthropic: full, openai: full },
    handlers: { task_action_type: h, project_memory: h, agent_host_session_summary: h, evermind_teacher: h },
    resolveKey: async () => 'key',
    recordUsage: async (j, _r, how) => { usage.push({ jobId: j.id, how }); },
    now: () => NOW,
  };
  return { deps, rows, usage, settled, adapter: full, handler: h };
}

const env = {} as never;
const db = {} as never;

describe('runLlmBatchTick', () => {
  it('submits queued jobs as one provider batch per provider + credential + model', async () => {
    const t = harness([job(1), job(2), job(3, { model: 'claude-haiku-5-5' })]);
    const s = await runLlmBatchTick(env, db, t.deps);
    expect(s).toMatchObject({ submitted: 3, batches: 2 });
    expect(t.rows.get(1)).toMatchObject({ status: 'submitted', providerBatchId: 'batch-1', attempts: 1 });
    expect(t.adapter.submit).toHaveBeenCalledTimes(2);
  });

  it('settles an ended batch: meters at the batch rate, then hands the answer to the handler', async () => {
    const t = harness(
      [job(1, { status: 'submitted', providerBatchId: 'b1', attempts: 1 })],
      {
        poll: async () => ({ state: 'ended', resultsRef: null }),
        results: async () => new Map([[batchCustomId(1), { ok: true as const, result: answer('memory text') }]]),
      },
    );
    const s = await runLlmBatchTick(env, db, t.deps);
    expect(s.settled).toBe(1);
    expect(t.usage).toEqual([{ jobId: 1, how: { batched: true, providerBatchId: 'b1' } }]);
    expect(t.settled).toEqual([{ jobId: 1, content: 'memory text' }]);
    expect(t.rows.get(1)?.status).toBe('completed');
  });

  it('requeues what the provider did not run, and runs it synchronously once attempts are spent', async () => {
    const t = harness(
      [job(1, { status: 'submitted', providerBatchId: 'b1', attempts: 1 }), job(2, { status: 'submitted', providerBatchId: 'b1', attempts: BATCH_MAX_ATTEMPTS })],
      {
        poll: async () => ({ state: 'ended', resultsRef: null }),
        results: async () => new Map([[batchCustomId(1), { ok: false as const, error: 'expired', retryable: true }]]),
      },
    );
    await runLlmBatchTick(env, db, t.deps);
    // Job 1 went back to the queue and straight into the next batch of the same tick.
    expect(t.rows.get(1)).toMatchObject({ status: 'submitted', lastError: 'expired' });
    // Job 2 had no result line and no attempts left: synchronous, standard rate, reason kept.
    expect(t.rows.get(2)).toMatchObject({ status: 'completed', fallbackReason: 'batch_attempts_exhausted' });
    expect(t.usage).toContainEqual({ jobId: 2, how: { batched: false, fallbackReason: 'batch_attempts_exhausted' } });
  });

  it('runs a job past its SLA synchronously and records why', async () => {
    const old = new Date(NOW.getTime() - BATCH_SLA_MS - 1000);
    const t = harness([job(1, { status: 'submitted', providerBatchId: 'b1', createdAt: old })]);
    const s = await runLlmBatchTick(env, db, t.deps);
    expect(s.syncFallbacks).toBe(1);
    expect(t.rows.get(1)).toMatchObject({ status: 'completed', fallbackReason: 'sla_expired' });
    expect(t.settled).toEqual([{ jobId: 1, content: 'sync answer' }]);
  });

  it('releases a refused submit for the next tick', async () => {
    const t = harness([job(1)], { submit: async () => { throw new Error('HTTP 529'); } });
    await runLlmBatchTick(env, db, t.deps);
    expect(t.rows.get(1)).toMatchObject({ status: 'queued', lastError: 'HTTP 529', attempts: 1 });
  });

  it('fails a job whose handler throws, without retrying the billed call', async () => {
    const t = harness(
      [job(1, { status: 'submitted', providerBatchId: 'b1', attempts: 1 })],
      {
        poll: async () => ({ state: 'ended', resultsRef: null }),
        results: async () => new Map([[batchCustomId(1), { ok: true as const, result: answer('') }]]),
      },
      { settle: async () => { throw new Error('LLM returned empty response'); } },
    );
    const s = await runLlmBatchTick(env, db, t.deps);
    expect(s.failed).toBe(1);
    expect(t.rows.get(1)).toMatchObject({ status: 'failed' });
    expect(t.usage).toHaveLength(1);
  });

  it('lets the handler run its own fallback when no answer can be had', async () => {
    const abandon = vi.fn(async () => undefined);
    const old = new Date(NOW.getTime() - BATCH_SLA_MS - 1000);
    const t = harness([job(1, { createdAt: old })], { callSync: async () => { throw new Error('down'); } }, { abandon });
    await runLlmBatchTick(env, db, t.deps);
    expect(t.rows.get(1)).toMatchObject({ status: 'failed', fallbackReason: 'sla_expired' });
    expect(abandon).toHaveBeenCalledOnce();
  });
});

describe('groupForSubmit', () => {
  it('keeps BYO batches per tenant and splits at the per-batch cap', () => {
    const many = Array.from({ length: BATCH_TICK_LIMITS.perBatch + 1 }, (_, i) => job(i + 1));
    expect(groupForSubmit(many).map((g) => g.length)).toEqual([BATCH_TICK_LIMITS.perBatch, 1]);
    const byo = [job(1, { funding: 'byo', tenantId: 1 }), job(2, { funding: 'byo', tenantId: 2 }), job(3, { funding: 'byo', tenantId: 1 })];
    expect(groupForSubmit(byo).map((g) => g.map((j) => j.id))).toEqual([[1, 3], [2]]);
  });
});
