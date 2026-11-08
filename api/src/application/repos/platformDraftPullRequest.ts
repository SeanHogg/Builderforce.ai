/**
 * platformDraftPullRequest — the DURABLE record of the PR the platform itself opened for a task's run
 * (`ci/draftPrForCi`), so any later tick, the run-end finalize and the orphan sweep can find it.
 *
 * Neither the row status nor the task's PR stamp can say whose draft it is: the PR reconciler rewrites every row's
 * status from the provider (a human can convert a PR back to draft), and a Done-drag PR is stamped too. The identity
 * is `pull_requests.platform_draft_execution_id` (migration 1331): the early draft writes the opening execution's
 * id in the SAME transaction as the row and the task's PR stamp (`recordTaskPullRequest`), and it is cleared once
 * the draft has been taken out of draft or closed. A row WITHOUT it is never ours, whatever its status, and is
 * never adopted, readied or closed here. The stamp is still checked, so a row the task no longer names is skipped.
 */
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { pullRequests, tasks } from '../../infrastructure/database/schema';
import { inTransaction, type Db } from '../../infrastructure/database/connection';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';

/** The row status of a PR the platform opened as a draft and has not yet taken out of draft. */
export const PLATFORM_DRAFT_STATUS = 'draft';

export interface PlatformDraftPr { id: string; number: number; url: string; status: string }

/**
 * The run's own PR on this task's branch and repository: a marked row (status `draft`, or `open` once a human marked
 * it ready), whichever the task's PR stamp names.
 */
export async function findPlatformDraftPullRequest(
  db: Db,
  a: { tenantId: number; taskId: number; repoId: string | null; branch: string },
): Promise<PlatformDraftPr | null> {
  const rows = await db
    .select({ id: pullRequests.id, number: pullRequests.number, url: pullRequests.url, status: pullRequests.status })
    .from(pullRequests)
    .where(and(
      eq(pullRequests.tenantId, a.tenantId), eq(pullRequests.taskId, a.taskId),
      ...(a.repoId ? [eq(pullRequests.repoId, a.repoId)] : []),
      eq(pullRequests.branchName, a.branch), inArray(pullRequests.status, [PLATFORM_DRAFT_STATUS, 'open']),
      isNotNull(pullRequests.platformDraftExecutionId),
    ))
    .orderBy(desc(pullRequests.createdAt))
    .limit(5);
  if (rows.length === 0) return null;
  const [task] = await db.select({ number: tasks.githubPrNumber }).from(tasks)
    .where(scopedToTenant(tasks, a.tenantId, eq(tasks.id, a.taskId))).limit(1);
  const own = rows.find((r) => r.number != null && r.number === task?.number && r.url);
  return own ? { id: own.id, number: own.number as number, url: own.url as string, status: own.status } : null;
}

/**
 * The draft has been taken out of draft: its row is an ordinary open PR from here on. The marker is cleared once the
 * provider took it out of draft (`cleared`); when that call FAILED the marker stays, so the orphan sweep can retry if
 * the reconciler reverts the row to `draft`.
 */
export async function markPlatformDraftOpen(db: Db, tenantId: number, rowId: string, cleared = true): Promise<void> {
  await db.update(pullRequests)
    .set({ status: 'open', updatedAt: new Date(), ...(cleared ? { platformDraftExecutionId: null } : {}) })
    .where(scopedToTenant(pullRequests, tenantId, eq(pullRequests.id, rowId), isNotNull(pullRequests.platformDraftExecutionId)));
}

/**
 * The draft was closed for good (its run left nothing on the branch, or did not succeed): the row is `closed` and
 * unmarked, and the task's PR stamp and open-claim are released so a later run can open a fresh PR instead of finding
 * a dead one.
 */
export async function retirePlatformDraft(db: Db, tenantId: number, a: { rowId: string; taskId: number; number: number }): Promise<void> {
  await inTransaction(db, async (tx) => {
    await tx.update(pullRequests)
      .set({ status: 'closed', platformDraftExecutionId: null, updatedAt: new Date() })
      .where(scopedToTenant(pullRequests, tenantId, eq(pullRequests.id, a.rowId)));
    await tx.update(tasks)
      .set({ githubPrUrl: null, githubPrNumber: null, prOpeningAt: null, updatedAt: new Date() })
      .where(scopedToTenant(tasks, tenantId, eq(tasks.id, a.taskId), eq(tasks.githubPrNumber, a.number)));
  });
}
