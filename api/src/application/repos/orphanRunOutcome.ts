/**
 * orphanRunOutcome — what became of a task's last run, for the orphan-draft sweep (`sweepOrphanedDraftPrs`).
 *
 * `live`: a run is still going — nothing to settle. `recent`: the last run ended less than the grace period ago (a
 * retry or follow-up run gets that long to start) — not yet. `succeeded`: it completed, so its work is real, yet
 * the finalize never took the draft over. `dead`: it failed, was cancelled or was reaped — its branch is half-done
 * work that must never become mergeable. `none`: the task has no execution at all — there is no evidence either way.
 * The grace is measured from the last run's END, not from when the draft was opened.
 */
import { desc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { executions } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { ExecutionStatus } from '../../domain/shared/types';
import { isLiveExecutionStatus, taskHasLiveRun } from '../runtime/liveExecutionStatus';

/** How long a task may have no live run before its draft counts as orphaned. */
export const ORPHAN_DRAFT_GRACE_MS = 30 * 60_000;

export type RunOutcome = 'live' | 'recent' | 'succeeded' | 'dead' | 'none';

export async function lastRunOutcome(db: Db, tenantId: number, taskId: number, now: Date): Promise<RunOutcome> {
  if (await taskHasLiveRun(db, tenantId, taskId)) return 'live';
  const [last] = await db.select({ status: executions.status, completedAt: executions.completedAt, createdAt: executions.createdAt })
    .from(executions)
    .where(scopedToTenant(executions, tenantId, eq(executions.taskId, taskId)))
    .orderBy(desc(executions.createdAt))
    .limit(1);
  if (!last) return 'none';
  if (isLiveExecutionStatus(last.status)) return 'live';
  const endedAt = last.completedAt ?? last.createdAt;
  if (now.getTime() - endedAt.getTime() < ORPHAN_DRAFT_GRACE_MS) return 'recent';
  return last.status === ExecutionStatus.COMPLETED ? 'succeeded' : 'dead';
}
