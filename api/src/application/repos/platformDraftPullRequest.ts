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
import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
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
 * provider took it out of draft (`cleared`); when that call FAILED the row is `open` and the marker stays, and the orphan
 * sweep selects exactly such rows (`open` + marker) to retry the mark-ready, clearing the marker on success.
 *
 * With `executionId` the write is FENCED to the marker the caller judged: a row whose marker moved on (a later run's
 * draft took it over) is left untouched.
 */
export async function markPlatformDraftOpen(db: Db, tenantId: number, rowId: string, cleared = true, executionId?: number): Promise<void> {
  await db.update(pullRequests)
    .set({ status: 'open', updatedAt: new Date(), ...(cleared ? { platformDraftExecutionId: null } : {}) })
    .where(scopedToTenant(
      pullRequests, tenantId, eq(pullRequests.id, rowId),
      executionId != null ? eq(pullRequests.platformDraftExecutionId, executionId) : isNotNull(pullRequests.platformDraftExecutionId),
    ));
}

/**
 * The draft is being closed for good (its run left nothing on the branch, or did not succeed): the row is `closed` and
 * unmarked, and the task's PR stamp is released so a later run can open a fresh PR instead of finding a dead one.
 * The task's open-claim (`pr_opening_at`) is deliberately LEFT: the caller releases it only once the provider close
 * succeeded, so a worker that dies between the CAS and the close leaves a stale claim, which the held-claim pass of the
 * sweep resolves by finding the still-open provider draft and closing it.
 *
 * A COMPARE-AND-SET on the marker the sweep SAW (`executionId`) and the status `draft`: it only wins while the row is
 * still the draft that run opened. A finalize adoption or a human marking the PR ready in the meantime clears the marker
 * or moves the status, and the CAS then loses (returns false) and changes nothing.
 *
 * ORDER, which the caller (`sweepOrphanedDraftPrs`) must keep: CAS FIRST, provider close SECOND, `restorePlatformDraft`
 * if the provider refuses. The reverse order can end with a closed PR whose row still carries a live marker, which the
 * finalize would then try to adopt; this order can only end with a restored draft (retried next pass) or, if the worker
 * dies between the two steps, an unmarked row beside a still-open provider draft, which the stale claim above leads the
 * held-claim pass to (never a closed PR a run is relying on).
 */
export async function retirePlatformDraft(
  db: Db, tenantId: number, a: { rowId: string; taskId: number; number: number; executionId: number },
): Promise<{ claimedAt: Date | null } | null> {
  return inTransaction(db, async (tx) => {
    const won = await tx.update(pullRequests)
      .set({ status: 'closed', platformDraftExecutionId: null, updatedAt: new Date() })
      .where(scopedToTenant(pullRequests, tenantId, eq(pullRequests.id, a.rowId), eq(pullRequests.platformDraftExecutionId, a.executionId), eq(pullRequests.status, PLATFORM_DRAFT_STATUS)))
      .returning({ id: pullRequests.id });
    if (won.length === 0) return null;
    // The task's open-claim AS IT STANDS NOW: the caller releases it only if it is still this value once the provider
    // close succeeded (a run that retook the claim meanwhile must keep it).
    const [claim] = await tx.select({ claimedAt: tasks.prOpeningAt }).from(tasks)
      .where(scopedToTenant(tasks, tenantId, eq(tasks.id, a.taskId), eq(tasks.githubPrNumber, a.number))).limit(1);
    await tx.update(tasks)
      .set({ githubPrUrl: null, githubPrNumber: null, updatedAt: new Date() })
      .where(scopedToTenant(tasks, tenantId, eq(tasks.id, a.taskId), eq(tasks.githubPrNumber, a.number)));
    return { claimedAt: claim?.claimedAt ?? null };
  });
}

/**
 * Undo a won {@link retirePlatformDraft} whose provider close failed: the row is the marked draft again and the task
 * names it again (only if the task has not meanwhile been stamped with a different PR), so the next pass retries.
 */
export async function restorePlatformDraft(
  db: Db, tenantId: number, a: { rowId: string; taskId: number; number: number; url: string; executionId: number },
): Promise<void> {
  await inTransaction(db, async (tx) => {
    const restored = await tx.update(pullRequests)
      .set({ status: PLATFORM_DRAFT_STATUS, platformDraftExecutionId: a.executionId, updatedAt: new Date() })
      .where(scopedToTenant(pullRequests, tenantId, eq(pullRequests.id, a.rowId), isNull(pullRequests.platformDraftExecutionId), eq(pullRequests.status, 'closed')))
      .returning({ id: pullRequests.id });
    // The row moved on meanwhile (the reconciler, a human): the task must not be re-pointed at a PR that is no longer the draft.
    if (restored.length === 0) return;
    await tx.update(tasks)
      .set({ githubPrUrl: a.url, githubPrNumber: a.number, updatedAt: new Date() })
      .where(scopedToTenant(tasks, tenantId, eq(tasks.id, a.taskId), isNull(tasks.githubPrNumber)));
  });
}
