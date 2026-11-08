/**
 * The `deferred-dispatch` cron sweep: claim due rows of `deferred_dispatches`, re-dispatch each
 * through its kind's handler (`deferredDispatchHandlers.ts`) and settle it.
 *
 * Runs on the CORE database handle (`buildDatabase`) - the queue is a core table, unlike the
 * audit stream its predecessor lived in (operational database), which this sweep never read.
 *
 * Every row is independent:
 *   - the claim is ONE statement (`FOR UPDATE SKIP LOCKED` + a lease), so overlapping ticks
 *     cannot take the same row and a tick that died mid-batch strands nothing for longer than
 *     the lease;
 *   - a row still deferred goes back to `pending` with an exponential, jittered `next_attempt_at`,
 *     so a ticket whose slot never frees cannot hold the head of the queue;
 *   - started -> `done`; refused for a reason that will not clear, or older than the window ->
 *     `abandoned`. Both run the kind's hook, because a dispatcher's own bookkeeping (an audit left
 *     `running`, the auto-fix attempt budget) must not depend on WHEN its run started.
 */
import { eq, inArray, isNull, sql } from 'drizzle-orm';
import { buildRuntimeService } from '../../buildRuntimeService';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import { deferredDispatches } from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { DEFERRED_DISPATCH_LEASE_SECONDS, isDeferredDispatchKind } from './deferredDispatch';
import { DEFERRED_DISPATCH_HANDLERS, type DeferredRow, type RunDeferredDispatch } from './deferredDispatchHandlers';
import type { dispatchCloudRunForTask as DispatchCloudRunForTask } from './dispatchCloudRun';
import type { Env } from '../../env';
import type { TickDispatchBudget } from './tickDispatchBudget';

/** A parked dispatch older than this is abandoned: the event that wanted it is stale. */
export const DEFERRED_DISPATCH_WINDOW_MS = 6 * 60 * 60_000;
export { DEFERRED_DISPATCH_LEASE_SECONDS };
export const MAX_DEFERRED_PER_TICK = 25;
/** Settled (`done` / `abandoned`) rows are kept this long for diagnosis, then deleted by the sweep. */
export const DEFERRED_DISPATCH_RETENTION_DAYS = 14;
/** Settled rows deleted per tick: the delete is bounded so a backlog drains over ticks instead of in one statement. */
export const DEFERRED_DISPATCH_PRUNE_BATCH = 500;
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_CAP_MS = 30 * 60_000;

/** Exponential backoff with +-25% jitter, for the Nth attempt (1-based). `random` in [0,1). */
export function deferredBackoffMs(attempts: number, random: number = Math.random()): number {
  const base = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));
  return Math.round(base * (0.75 + random * 0.5));
}

export interface DeferredDispatchSweepResult { claimed: number; started: number; stillDeferred: number; abandoned: number }

/**
 * Claim up to `limit` due rows: bump `attempts`, take the lease, skip rows another tick holds. The returned `claimedAt`
 * is the FENCING TOKEN: `settle` and `reschedule` only write while the row still carries it, so a holder whose lease
 * expired and was retaken cannot overwrite the new holder's outcome. It is truncated to milliseconds so the JS `Date`
 * handed back compares equal to the stored value.
 */
export async function claimDueDeferredDispatches(db: Db, limit: number): Promise<DeferredRow[]> {
  const rows = await db.update(deferredDispatches)
    .set({ claimedAt: sql`date_trunc('milliseconds', now())`, attempts: sql`${deferredDispatches.attempts} + 1`, updatedAt: sql`now()` })
    .where(acrossTenants(deferredDispatches, 'scheduled_sweep', inArray(deferredDispatches.id, sql`(
      SELECT id FROM deferred_dispatches
      WHERE state = 'pending' AND next_attempt_at <= now()
        AND (claimed_at IS NULL OR claimed_at < now() - (${DEFERRED_DISPATCH_LEASE_SECONDS}::double precision) * interval '1 second')
      ORDER BY next_attempt_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )`)))
    .returning();
  return rows as DeferredRow[];
}

/** The row, only while it is still pending AND still held by THIS claim (the fence). */
const own = (row: DeferredRow) =>
  scopedToTenant(
    deferredDispatches, row.tenantId, eq(deferredDispatches.id, row.id), eq(deferredDispatches.state, 'pending'),
    row.claimedAt ? eq(deferredDispatches.claimedAt, row.claimedAt) : isNull(deferredDispatches.claimedAt),
  );

/** Delete settled rows past the retention, a bounded batch per tick. Best-effort: a failed prune never blocks the dispatches. */
async function pruneSettledDispatches(db: Db): Promise<void> {
  try {
    await db.delete(deferredDispatches).where(acrossTenants(deferredDispatches, 'scheduled_sweep', inArray(deferredDispatches.id, sql`(
      SELECT id FROM deferred_dispatches
      WHERE state IN ('done', 'abandoned') AND updated_at < now() - (${DEFERRED_DISPATCH_RETENTION_DAYS}::double precision) * interval '1 day'
      LIMIT ${DEFERRED_DISPATCH_PRUNE_BATCH}
    )`)));
  } catch (error) {
    reportCaughtError(error, { source: 'application/runtime/deferredDispatchSweep.ts', operation: 'pruneSettledDispatches' });
  }
}

/** Back to `pending`: the claim is cleared and the next attempt is scheduled. `refund` hands the attempt back (never tried). */
async function reschedule(db: Db, row: DeferredRow, delayMs: number, lastError: string | null, refund = false): Promise<void> {
  await db.update(deferredDispatches)
    .set({
      claimedAt: null, nextAttemptAt: sql`now() + (${delayMs / 1000}::double precision) * interval '1 second'`, updatedAt: sql`now()`,
      ...(refund ? { attempts: sql`${deferredDispatches.attempts} - 1` } : {}),
      ...(lastError != null ? { lastError } : {}),
    })
    .where(own(row));
}

/** True when THIS claim settled the row; false when the fence refused it (another tick holds the row now). */
async function settle(db: Db, row: DeferredRow, state: 'done' | 'abandoned', lastError: string | null): Promise<boolean> {
  const won = await db.update(deferredDispatches)
    .set({ state, claimedAt: null, updatedAt: sql`now()`, ...(lastError != null ? { lastError } : {}) })
    .where(own(row))
    .returning({ id: deferredDispatches.id });
  return won.length > 0;
}

/**
 * Re-dispatch the due parked dispatches through the one dispatcher (passed in, so this module does
 * not import it at runtime). A tenant out of tick budget keeps its rows pending, attempt refunded.
 */
export async function runDeferredDispatchSweep(
  env: Env, budget: TickDispatchBudget, dispatch: typeof DispatchCloudRunForTask,
): Promise<DeferredDispatchSweepResult> {
  const db = buildDatabase(env);
  const result: DeferredDispatchSweepResult = { claimed: 0, started: 0, stillDeferred: 0, abandoned: 0 };
  await pruneSettledDispatches(db);
  const claimed = await claimDueDeferredDispatches(db, MAX_DEFERRED_PER_TICK);
  result.claimed = claimed.length;
  if (claimed.length === 0) return result;
  const runtimeService = buildRuntimeService(env, db);

  const abandon = async (row: DeferredRow, reason: string): Promise<void> => {
    if (!(await settle(db, row, 'abandoned', reason))) return; // fenced out: the new holder owns the outcome and its hook
    result.abandoned += 1;
    const handler = isDeferredDispatchKind(row.kind) ? DEFERRED_DISPATCH_HANDLERS[row.kind] : null;
    await handler?.onAbandoned(row, reason, db).catch((error) => reportCaughtError(error, { source: 'application/runtime/deferredDispatchSweep.ts', operation: 'onAbandoned', context: { logMessage: '[deferred-dispatch] abandon hook failed', details: { id: row.id, kind: row.kind } } }));
  };

  for (const row of claimed) {
    let started = false;
    let reserved = false;
    // A lease already past its bound by the time this row's turn comes (earlier rows in the batch were slow): another tick
    // may own it now. Leave it untouched; its outcome is that holder's to write (and the fence stops ours anyway).
    if (row.claimedAt && Date.now() - new Date(row.claimedAt).getTime() > DEFERRED_DISPATCH_LEASE_SECONDS * 1000) continue;
    try {
      if (!isDeferredDispatchKind(row.kind)) { await abandon(row, `unknown dispatch kind '${row.kind}'`); continue; }
      if (Date.now() - new Date(row.createdAt).getTime() > DEFERRED_DISPATCH_WINDOW_MS) { await abandon(row, 'expired: the event that wanted this run is stale'); continue; }
      if (!budget.tryReserve(row.tenantId)) { await reschedule(db, row, BACKOFF_BASE_MS, null, true); continue; }
      reserved = true;
      const handler = DEFERRED_DISPATCH_HANDLERS[row.kind];
      const background: Promise<unknown>[] = [];
      const run: RunDeferredDispatch = (params) => dispatch(env, db, runtimeService, (p) => { background.push(Promise.resolve(p)); }, params);
      const outcome = await handler.dispatch(row, run);
      await Promise.allSettled(background);
      started = outcome.executionId != null;
      if (outcome.deferred) {
        result.stillDeferred += 1;
        await reschedule(db, row, deferredBackoffMs(row.attempts), outcome.refusal?.message ?? null);
      } else if (outcome.executionId != null) {
        result.started += 1;
        await settle(db, row, 'done', null);
        await handler.onStarted(row, outcome.executionId, db).catch((error) => reportCaughtError(error, { source: 'application/runtime/deferredDispatchSweep.ts', operation: 'onStarted', context: { logMessage: '[deferred-dispatch] started hook failed', details: { id: row.id, kind: row.kind } } }));
      } else {
        await abandon(row, outcome.refusal?.message ?? 'the dispatcher declined without a reason');
      }
    } catch (error) {
      reportCaughtError(error, { source: 'application/runtime/deferredDispatchSweep.ts', operation: 'runDeferredDispatchSweep', context: { logMessage: '[deferred-dispatch] retry failed; it stays pending', details: { tenantId: row.tenantId, taskId: row.taskId, kind: row.kind } } });
      await reschedule(db, row, deferredBackoffMs(row.attempts), error instanceof Error ? error.message.slice(0, 500) : 'retry failed').catch((rescheduleError) => reportCaughtError(rescheduleError, { source: 'application/runtime/deferredDispatchSweep.ts', operation: 'reschedule' }));
    } finally {
      if (reserved && !started) budget.release(row.tenantId);
    }
  }
  return result;
}
