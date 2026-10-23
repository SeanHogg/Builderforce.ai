/**
 * The durable job queue behind deferred LLM work — port + its Drizzle adapter.
 *
 * Every state change is ONE conditional statement (`WHERE status = <expected>`), so two
 * overlapping ticks can never both submit, settle or fall back the same job: the loser's
 * update matches nothing. Claims use `FOR UPDATE SKIP LOCKED` for the same reason.
 *
 * Lives on the usage ledger's database (`usageDatabaseOf`) — the queue is written at the
 * moments its usage rows are (transactional-migrations/0020). Every read and update is
 * the scheduled sweep's (`acrossTenants(…, 'scheduled_sweep')`): the tick settles every
 * tenant's jobs, and a job id is only ever one the tick itself just read.
 */
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { acrossTenants } from '../../../infrastructure/database/tenantScope';
import type { Db } from '../../../infrastructure/database/connection';
import { llmBatchJobs } from '../../../infrastructure/database/schema';
import { usageDatabaseOf } from '../usageLedger';
import {
  isBatchCallbackKind,
  isBatchVendor,
  type BatchJob,
  type BatchJobStatus,
  type DeferredLlmRequest,
  type NewBatchJob,
} from './batchTypes';

/** One open provider batch, as the poller needs it. */
export interface OpenProviderBatch {
  providerBatchId: string;
  vendor: BatchJob['vendor'];
  funding: BatchJob['funding'];
  /** Whose key a BYO batch runs on (every job in a BYO batch shares it). */
  tenantId: number;
}

export interface BatchJobStore {
  insert(job: NewBatchJob): Promise<number>;
  /** queued → submitting (attempts + 1), oldest first. */
  claimQueued(limit: number): Promise<BatchJob[]>;
  /** submitting → submitted under the provider's batch id. */
  markSubmitted(ids: readonly number[], providerBatchId: string): Promise<void>;
  /** submitting → queued after a refused submit, keeping the error. */
  release(ids: readonly number[], error: string): Promise<void>;
  /** submitting / running_sync rows a crashed tick left behind → queued (an old one is
   *  then picked up as overdue and run synchronously; a recent one is resubmitted). */
  releaseStale(olderThan: Date): Promise<number>;
  openBatches(limit: number): Promise<OpenProviderBatch[]>;
  jobsInBatch(providerBatchId: string): Promise<BatchJob[]>;
  /** submitted → queued: the provider did not run it; it goes into the next batch. */
  requeue(id: number, error: string): Promise<boolean>;
  /** submitted → completed, BEFORE its handler runs: at most one settle per job. The
   *  handler works from the job already in memory; the row keeps no prompt text. */
  claimSettle(id: number): Promise<boolean>;
  /** Any open status → running_sync for jobs created before `cutoff` (the SLA). */
  claimOverdue(cutoff: Date, limit: number): Promise<BatchJob[]>;
  /** submitting | submitted → running_sync for a job the batch path gave up on. */
  claimForSync(id: number): Promise<boolean>;
  /** Close a job: completed | failed, request and payload cleared. */
  settle(id: number, outcome: { status: Extract<BatchJobStatus, 'completed' | 'failed'>; fallbackReason?: string | null; error?: string | null }): Promise<void>;
}

const OPEN_STATUSES: BatchJobStatus[] = ['queued', 'submitting', 'submitted'];

type Row = typeof llmBatchJobs.$inferSelect;

/** A stored row → the job the use cases see; null for a row no code can settle. */
export function toBatchJob(row: Row): BatchJob | null {
  if (!isBatchCallbackKind(row.callbackKind) || !isBatchVendor(row.vendor)) return null;
  if (row.funding !== 'byo' && row.funding !== 'platform') return null;
  return {
    id: row.id,
    tenantId: row.tenantId,
    projectId: row.projectId ?? null,
    taskId: row.taskId ?? null,
    useCase: row.useCase,
    callbackKind: row.callbackKind,
    callbackPayload: row.callbackPayload ?? {},
    request: row.request as unknown as DeferredLlmRequest,
    vendor: row.vendor,
    model: row.model,
    funding: row.funding,
    status: row.status as BatchJobStatus,
    providerBatchId: row.providerBatchId ?? null,
    attempts: row.attempts,
    createdAt: row.createdAt,
  };
}

function jobs(rows: Row[]): BatchJob[] {
  return rows.map(toBatchJob).filter((j): j is BatchJob => j !== null);
}

const trimError = (e: string) => e.slice(0, 1000);

export function drizzleBatchJobStore(core: Db): BatchJobStore {
  const db = usageDatabaseOf(core);
  const now = () => new Date();

  return {
    async insert(job) {
      const [row] = await db.insert(llmBatchJobs).values({
        tenantId: job.tenantId,
        projectId: job.projectId,
        taskId: job.taskId,
        useCase: job.useCase,
        callbackKind: job.callbackKind,
        callbackPayload: job.callbackPayload,
        vendor: job.vendor,
        model: job.model,
        funding: job.funding,
        request: job.request as unknown as Record<string, unknown>,
      }).returning({ id: llmBatchJobs.id });
      if (!row) throw new Error('llm_batch_jobs insert returned no row');
      return row.id;
    },

    async claimQueued(limit) {
      const rows = await db.update(llmBatchJobs)
        .set({ status: 'submitting', attempts: sql`${llmBatchJobs.attempts} + 1`, updatedAt: now() })
        .where(acrossTenants(llmBatchJobs, 'scheduled_sweep', inArray(llmBatchJobs.id, sql`(SELECT id FROM llm_batch_jobs WHERE status = 'queued' ORDER BY id LIMIT ${limit} FOR UPDATE SKIP LOCKED)`)))
        .returning();
      return jobs(rows);
    },

    async markSubmitted(ids, providerBatchId) {
      if (ids.length === 0) return;
      await db.update(llmBatchJobs)
        .set({ status: 'submitted', providerBatchId, submittedAt: now(), updatedAt: now() })
        .where(acrossTenants(llmBatchJobs, 'scheduled_sweep', and(inArray(llmBatchJobs.id, [...ids]), eq(llmBatchJobs.status, 'submitting'))));
    },

    async release(ids, error) {
      if (ids.length === 0) return;
      await db.update(llmBatchJobs)
        .set({ status: 'queued', lastError: trimError(error), updatedAt: now() })
        .where(acrossTenants(llmBatchJobs, 'scheduled_sweep', and(inArray(llmBatchJobs.id, [...ids]), eq(llmBatchJobs.status, 'submitting'))));
    },

    async releaseStale(olderThan) {
      const rows = await db.update(llmBatchJobs)
        .set({ status: 'queued', lastError: 'released: a tick did not finish it', updatedAt: now() })
        .where(acrossTenants(llmBatchJobs, 'scheduled_sweep', and(inArray(llmBatchJobs.status, ['submitting', 'running_sync']), lt(llmBatchJobs.updatedAt, olderThan))))
        .returning({ id: llmBatchJobs.id });
      return rows.length;
    },

    async openBatches(limit) {
      const rows = await db
        .select({
          providerBatchId: llmBatchJobs.providerBatchId,
          vendor: llmBatchJobs.vendor,
          funding: llmBatchJobs.funding,
          tenantId: sql<number>`MIN(${llmBatchJobs.tenantId})`,
        })
        .from(llmBatchJobs)
        .where(acrossTenants(llmBatchJobs, 'scheduled_sweep', and(eq(llmBatchJobs.status, 'submitted'), sql`${llmBatchJobs.providerBatchId} IS NOT NULL`)))
        .groupBy(llmBatchJobs.providerBatchId, llmBatchJobs.vendor, llmBatchJobs.funding)
        .limit(limit);
      return rows.flatMap((r) => (r.providerBatchId && isBatchVendor(r.vendor) && (r.funding === 'byo' || r.funding === 'platform'))
        ? [{ providerBatchId: r.providerBatchId, vendor: r.vendor, funding: r.funding, tenantId: Number(r.tenantId) }]
        : []);
    },

    async jobsInBatch(providerBatchId) {
      return jobs(await db.select().from(llmBatchJobs).where(acrossTenants(llmBatchJobs, 'scheduled_sweep', and(eq(llmBatchJobs.providerBatchId, providerBatchId), eq(llmBatchJobs.status, 'submitted')))));
    },

    async requeue(id, error) {
      const rows = await db.update(llmBatchJobs)
        .set({ status: 'queued', providerBatchId: null, lastError: trimError(error), updatedAt: now() })
        .where(acrossTenants(llmBatchJobs, 'scheduled_sweep', and(eq(llmBatchJobs.id, id), eq(llmBatchJobs.status, 'submitted'))))
        .returning({ id: llmBatchJobs.id });
      return rows.length > 0;
    },

    async claimSettle(id) {
      const rows = await db.update(llmBatchJobs)
        .set({ status: 'completed', completedAt: now(), request: {}, callbackPayload: {}, updatedAt: now() })
        .where(acrossTenants(llmBatchJobs, 'scheduled_sweep', and(eq(llmBatchJobs.id, id), eq(llmBatchJobs.status, 'submitted'))))
        .returning({ id: llmBatchJobs.id });
      return rows.length > 0;
    },

    async claimOverdue(cutoff, limit) {
      const rows = await db.update(llmBatchJobs)
        .set({ status: 'running_sync', updatedAt: now() })
        .where(acrossTenants(llmBatchJobs, 'scheduled_sweep', inArray(llmBatchJobs.id, sql`(SELECT id FROM llm_batch_jobs WHERE status IN ('queued', 'submitting', 'submitted') AND created_at < ${cutoff.toISOString()}::timestamptz ORDER BY id LIMIT ${limit} FOR UPDATE SKIP LOCKED)`)))
        .returning();
      return jobs(rows);
    },

    async claimForSync(id) {
      const rows = await db.update(llmBatchJobs)
        .set({ status: 'running_sync', updatedAt: now() })
        .where(acrossTenants(llmBatchJobs, 'scheduled_sweep', and(eq(llmBatchJobs.id, id), inArray(llmBatchJobs.status, OPEN_STATUSES))))
        .returning({ id: llmBatchJobs.id });
      return rows.length > 0;
    },

    async settle(id, outcome) {
      await db.update(llmBatchJobs)
        .set({
          status: outcome.status,
          completedAt: now(),
          request: {},
          callbackPayload: {},
          ...(outcome.fallbackReason ? { fallbackReason: outcome.fallbackReason } : {}),
          ...(outcome.error ? { lastError: trimError(outcome.error) } : {}),
          updatedAt: now(),
        })
        .where(acrossTenants(llmBatchJobs, 'scheduled_sweep', eq(llmBatchJobs.id, id)));
    },
  };
}
