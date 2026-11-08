/**
 * THE "is this execution still live?" predicate.
 *
 * A ticket has a live run while one of its executions is pending, submitted, running
 * or paused (parked on a human). Two readers need exactly this answer and used to
 * risk holding two copies: the autonomy evaluator (`already_running`) and the human
 * dispatch admission (a second POST /executions for the same task is refused with the
 * live run's id). They share this module so the two can never disagree.
 */
import { ExecutionStatus } from '../../domain/shared/types';

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
import { eq as eqLive, inArray as inArrayLive } from 'drizzle-orm';
import type { Db as LiveDb } from '../../infrastructure/database/connection';
import { executions as liveExecutions } from '../../infrastructure/database/schema';
import { scopedToTenant as scopedLive } from '../../infrastructure/database/tenantScope';

/** Whether the task has an execution that is still live. Merge decisions and the orphan-draft sweep ask this. */
export async function taskHasLiveRun(db: LiveDb, tenantId: number, taskId: number): Promise<boolean> {
  const rows = await db.select({ id: liveExecutions.id }).from(liveExecutions)
    .where(scopedLive(liveExecutions, tenantId, eqLive(liveExecutions.taskId, taskId), inArrayLive(liveExecutions.status, [...LIVE_EXECUTION_STATUSES])))
    .limit(1);
  return rows.length > 0;
}
