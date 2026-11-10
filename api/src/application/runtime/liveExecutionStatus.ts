/**
 * THE "is this execution still live?" predicate.
 *
 * A ticket has a live run while one of its executions is pending, submitted, running
 * or paused (parked on a human). Two readers need exactly this answer and used to
 * risk holding two copies: the autonomy evaluator (`already_running`) and the human
 * dispatch admission (a second POST /executions for the same task is refused with the
 * live run's id). They share this module so the two can never disagree.
 */
import { asc, eq, inArray, type SQL } from 'drizzle-orm';
import { ExecutionStatus } from '../../domain/shared/types';
import type { Db, Tx } from '../../infrastructure/database/connection';
import { executions } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { liveExecution } from '../rehearsal/executionMode';

export const LIVE_EXECUTION_STATUSES: readonly ExecutionStatus[] = [
  ExecutionStatus.PENDING,
  ExecutionStatus.SUBMITTED,
  ExecutionStatus.RUNNING,
  ExecutionStatus.PAUSED,
];

const LIVE_SET: ReadonlySet<string> = new Set<string>(LIVE_EXECUTION_STATUSES);

export function isLiveExecutionStatus(status: string): boolean {
  return LIVE_SET.has(status);
}

/** The first live row of a newest-first execution list, reduced to `{ id, status }`, or null. */
export function findLiveExecution(rows: ReadonlyArray<{ id: number; status: string }>): { id: number; status: string } | null {
  const live = rows.find((row) => isLiveExecutionStatus(row.status));
  return live ? { id: live.id, status: live.status } : null;
}

// ── "does this TASK have a live run?" — the database form of the predicate above ──────────────────────

/**
 * THE predicate for "a live run of this task": a live status, and a run that COUNTS
 * (`liveExecution()`: not a rehearsal, not a sub-agent child, which is a slice of its parent's
 * run). Every task-scoped live-run read composes this one, so dedupe, merge and sweeps agree.
 */
export function liveRunOfTask(tenantId: number, taskId: number): SQL {
  return scopedToTenant(
    executions, tenantId,
    eq(executions.taskId, taskId),
    inArray(executions.status, [...LIVE_EXECUTION_STATUSES]),
    liveExecution(),
  );
}

/** The live runs of one ticket, oldest first. */
export async function liveRunsForTask(
  db: Db | Tx, tenantId: number, taskId: number,
): Promise<Array<{ id: number; status: string }>> {
  return db.select({ id: executions.id, status: executions.status }).from(executions)
    .where(liveRunOfTask(tenantId, taskId))
    .orderBy(asc(executions.id));
}

/** Whether the task has an execution that is still live. Merge decisions and the orphan-draft sweep ask this. */
export async function taskHasLiveRun(db: Db | Tx, tenantId: number, taskId: number): Promise<boolean> {
  const rows = await db.select({ id: executions.id }).from(executions)
    .where(liveRunOfTask(tenantId, taskId))
    .limit(1);
  return rows.length > 0;
}
