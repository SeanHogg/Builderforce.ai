/**
 * Deferred dispatch: a one-shot dispatcher's run that admission DEFERRED (a live run on the
 * ticket, the plan's concurrent cap) is parked and retried, instead of being dropped.
 *
 * Lane and role dispatches need none of this: the `auto-exec` sweep re-evaluates every
 * agent-owned ticket without a live run each tick, so a deferred ticket simply stays eligible.
 * A ONE-SHOT dispatcher - CI auto-fix, incident triage, security audit, validation review -
 * has no such sweep behind it: the event that triggered it will not fire again. It passes
 * `parkIfDeferred`, and the refusal is recorded here as a `dispatch.deferred` row in the
 * existing `tool_audit_events` table (keyed `task:<id>`, the dispatch params in `args`).
 * The `deferred-dispatch` cron sweep re-dispatches parked rows through the SAME dispatcher
 * and writes `dispatch.deferred.done` once the dispatch is no longer deferred (started, or
 * refused for a reason that will not clear). A parked row older than the window is abandoned.
 *
 * No new table: the audit table already holds the append-only, tenant-scoped, redacted
 * record this needs, and the retry window is short.
 */
import { and, asc, eq, gt, notExists, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import { toolAuditEvents } from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { recordCloudToolEvent } from './cloudToolEvents';
import type { dispatchCloudRunForTask as DispatchCloudRunForTask } from './dispatchCloudRun';
import type { Env } from '../../env';
import type { TickDispatchBudget } from './tickDispatchBudget';

export const DEFERRED_DISPATCH_EVENT = 'dispatch.deferred';
export const DEFERRED_DISPATCH_DONE_EVENT = 'dispatch.deferred.done';
/** A parked dispatch older than this is abandoned: the event that wanted it is stale. */
export const DEFERRED_DISPATCH_WINDOW_MS = 6 * 60 * 60_000;
const MAX_RETRIES_PER_TICK = 25;

export interface DeferredDispatchParams {
  tenantId: number;
  taskId: number;
  submittedBy: string;
  payload?: string;
  agentHostId?: number | null;
}

const sessionKeyOf = (taskId: number): string => `task:${taskId}`;

/** Park a deferred one-shot dispatch for the `deferred-dispatch` sweep. Best-effort. */
export async function parkDeferredDispatch(db: Db, params: DeferredDispatchParams): Promise<void> {
  try {
    await recordCloudToolEvent(db, {
      tenantId: params.tenantId, executionId: null, sessionKey: sessionKeyOf(params.taskId),
      toolName: DEFERRED_DISPATCH_EVENT, category: 'planning',
      detail: { submittedBy: params.submittedBy, payload: params.payload ?? null, agentHostId: params.agentHostId ?? null },
      result: 'Dispatch deferred (a run is live on the ticket, or the workspace is at its concurrent cloud-run limit); it is retried automatically.',
    });
  } catch (error) {
    reportCaughtError(error, { source: 'application/runtime/deferredDispatch.ts', operation: 'parkDeferredDispatch' });
  }
}

/** The parked dispatches still owed a retry: no later `done` for the same ticket, inside the window. */
async function loadParked(db: Db, nowMs: number) {
  const done = alias(toolAuditEvents, 'done');
  return db
    .select({ id: toolAuditEvents.id, tenantId: toolAuditEvents.tenantId, sessionKey: toolAuditEvents.sessionKey, args: toolAuditEvents.args })
    .from(toolAuditEvents)
    .where(acrossTenants(
      toolAuditEvents, 'scheduled_sweep',
      eq(toolAuditEvents.toolName, DEFERRED_DISPATCH_EVENT),
      gt(toolAuditEvents.ts, new Date(nowMs - DEFERRED_DISPATCH_WINDOW_MS)),
      notExists(db.select({ one: sql`1` }).from(done).where(and(
        eq(done.tenantId, toolAuditEvents.tenantId),
        eq(done.sessionKey, toolAuditEvents.sessionKey),
        eq(done.toolName, DEFERRED_DISPATCH_DONE_EVENT),
        gt(done.id, toolAuditEvents.id),
      ))),
    ))
    .orderBy(asc(toolAuditEvents.id))
    .limit(MAX_RETRIES_PER_TICK);
}

export interface DeferredDispatchSweepResult { parked: number; started: number; stillDeferred: number }

/**
 * Re-dispatch parked dispatches through the one dispatcher (passed in, so this module does
 * not import it at runtime). A tenant out of tick budget keeps its rows parked.
 */
export async function runDeferredDispatchSweep(
  env: Env, budget: TickDispatchBudget, dispatch: typeof DispatchCloudRunForTask,
): Promise<DeferredDispatchSweepResult> {
  const db = buildDatabase(env);
  const result: DeferredDispatchSweepResult = { parked: 0, started: 0, stillDeferred: 0 };
  const parked = await loadParked(db, Date.now());
  result.parked = parked.length;
  if (parked.length === 0) return result;
  // Lazy: only a tick with parked work needs the service, and the heavy graph stays out of the
  // admission module's import path (this module is imported by `dispatchAdmission`).
  const { buildRuntimeService } = await import('../../buildRuntimeService');
  const runtimeService = buildRuntimeService(env, db);

  for (const row of parked) {
    const taskId = Number(/^task:(\d+)$/.exec(row.sessionKey ?? '')?.[1]);
    if (!Number.isSafeInteger(taskId) || !budget.tryReserve(row.tenantId)) continue;
    let started = false;
    try {
      const saved = JSON.parse(row.args ?? '{}') as { submittedBy?: string; payload?: string | null; agentHostId?: number | null };
      const background: Promise<unknown>[] = [];
      const outcome = await dispatch(env, db, runtimeService, (p) => { background.push(Promise.resolve(p)); }, {
        taskId, tenantId: row.tenantId, submittedBy: saved.submittedBy ?? 'system:deferred-dispatch',
        ...(saved.payload ? { payload: saved.payload } : {}),
        ...(saved.agentHostId != null ? { agentHostId: saved.agentHostId } : {}),
      });
      await Promise.allSettled(background);
      started = outcome.executionId != null;
      if (outcome.deferred) { result.stillDeferred += 1; continue; }
      if (started) result.started += 1;
      await recordCloudToolEvent(db, {
        tenantId: row.tenantId, executionId: outcome.executionId, sessionKey: sessionKeyOf(taskId),
        toolName: DEFERRED_DISPATCH_DONE_EVENT, category: 'planning',
        detail: { parkedEventId: row.id, started },
        result: started ? 'Deferred dispatch started.' : `Deferred dispatch ended without a run: ${outcome.refusal?.message ?? 'no reason given'}`,
        resultCap: 300,
      });
    } catch (error) {
      reportCaughtError(error, { source: 'application/runtime/deferredDispatch.ts', operation: 'runDeferredDispatchSweep', context: { logMessage: '[deferred-dispatch] retry failed; it stays parked', details: { tenantId: row.tenantId, taskId } } });
    } finally {
      if (!started) budget.release(row.tenantId);
    }
  }
  return result;
}
