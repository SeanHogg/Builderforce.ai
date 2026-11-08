/**
 * orphanRunOutcome — what became of the run that opened a platform draft PR, for the orphan-draft sweep
 * (`sweepOrphanedDraftPrs`).
 *
 * The judge is the run that OPENED the draft (`pull_requests.platform_draft_execution_id`), never "the task's last run":
 * a duplicate dispatch that admission refused (a cancelled row created after the live run) is the task's newest run,
 * and judging by it would read a healthy draft as dead and close it. A draft with no marker (its record never landed)
 * has no opener to name, so it falls back to the task's newest run that actually STARTED.
 *
 * `live`: the run, or any run it spawned (sub-agent children, to any depth), or any other run on the task, is still
 * going — nothing to settle. `recent`: the work ended less than the grace period ago (a retry or follow-up run gets
 * that long to start) — not yet. `succeeded`: the opener completed, so its work is real, yet the finalize never took
 * the draft over. `dead`: it failed, was cancelled or was reaped — its branch is half-done work that must never become
 * mergeable. `none`: no run to judge by — there is no evidence either way.
 *
 * A row CANCELLED BY `system:admission` is never evidence. That actor is recorded only on the audit event, not the
 * execution, so it is recognised by its shape: cancelled without ever having started (a user cancelling a queued run
 * has the same shape, and such a run equally never opened a draft). The grace is measured from the work's END (the
 * opener or its last child, whichever ended later), not from when the draft was opened.
 */
import { desc, eq, inArray, isNotNull, or } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { executions } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { ExecutionStatus } from '../../domain/shared/types';
import { isLiveExecutionStatus, taskHasLiveRun } from '../runtime/liveExecutionStatus';

/** How long a task may have no live run before its draft counts as orphaned. */
export const ORPHAN_DRAFT_GRACE_MS = 30 * 60_000;

/** How deep a run's sub-agent tree is followed. A child of a child is rare; four levels is past any real tree. */
const MAX_CHILD_DEPTH = 4;

export type RunOutcome = 'live' | 'recent' | 'succeeded' | 'dead' | 'none';

interface RunRow { id: number; status: string; startedAt: Date | null; completedAt: Date | null; createdAt: Date }

const runColumns = { id: executions.id, status: executions.status, startedAt: executions.startedAt, completedAt: executions.completedAt, createdAt: executions.createdAt };

/** A cancelled run that never started: how a run refused by admission looks. It opened nothing, so it judges nothing. */
const neverStartedCancel = (r: RunRow): boolean => r.status === ExecutionStatus.CANCELLED && r.startedAt == null;

const endedAtOf = (r: RunRow): Date => r.completedAt ?? r.createdAt;

/** The sub-agent runs spawned under `rootId`, to `MAX_CHILD_DEPTH`. */
async function descendants(db: Db, tenantId: number, rootId: number): Promise<RunRow[]> {
  const all: RunRow[] = [];
  let frontier = [rootId];
  for (let depth = 0; depth < MAX_CHILD_DEPTH && frontier.length > 0; depth++) {
    const children = await db.select(runColumns).from(executions)
      .where(scopedToTenant(executions, tenantId, inArray(executions.parentExecutionId, frontier)));
    all.push(...children);
    frontier = children.map((c) => c.id);
  }
  return all;
}

/**
 * The outcome of the run that opened the draft (`draftExecutionId`), or — for a draft with no marker — of the task's
 * newest run that started.
 */
export async function draftRunOutcome(
  db: Db, tenantId: number, taskId: number, draftExecutionId: number | null, now: Date,
): Promise<RunOutcome> {
  if (await taskHasLiveRun(db, tenantId, taskId)) return 'live';
  const [opener] = await db.select(runColumns).from(executions)
    .where(draftExecutionId != null
      ? scopedToTenant(executions, tenantId, eq(executions.id, draftExecutionId))
      : scopedToTenant(executions, tenantId, eq(executions.taskId, taskId), or(isNotNull(executions.startedAt), inArray(executions.status, [ExecutionStatus.COMPLETED, ExecutionStatus.FAILED]))))
    .orderBy(desc(executions.createdAt))
    .limit(1);
  if (!opener || neverStartedCancel(opener)) return 'none';

  const tree = [opener, ...(await descendants(db, tenantId, opener.id))];
  if (tree.some((r) => isLiveExecutionStatus(r.status))) return 'live';
  const endedAt = Math.max(...tree.filter((r) => !neverStartedCancel(r)).map((r) => endedAtOf(r).getTime()));
  if (now.getTime() - endedAt < ORPHAN_DRAFT_GRACE_MS) return 'recent';
  return opener.status === ExecutionStatus.COMPLETED ? 'succeeded' : 'dead';
}
