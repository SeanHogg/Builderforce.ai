/**
 * sweepOrphanedDraftPrs — settle the early draft PR (`ci/draftPrForCi`) of a run that never reached its finalize.
 *
 * A run that is cancelled, fails or is reaped after it opened its draft leaves that draft open on the provider: the
 * finalize that takes it out of draft (`adoptRunDraftPr`) never ran. This ONE scheduled sweep is the only cleanup —
 * there is no per-path handling in cancel or reap.
 *
 * WHOSE draft: only a row carrying the platform marker (`pull_requests.platform_draft_execution_id`, migration 1331)
 * that the task's own PR stamp names. A draft a human opened, or converted back to draft, has no marker and is never
 * touched — the sweep cannot fight a person over a PR.
 *
 * WHEN: the task has no live run, and the run that OPENED the draft (the row's marker, with any sub-agent children) ENDED more
 * than the grace period ago (`draftRunOutcome`). The candidates are filtered in SQL, so live drafts never fill the batch.
 *
 * WHAT, by how that opener ended — never by "the branch has commits" alone, because a cancelled or failed run's
 * commits are half-done work that must not become mergeable:
 *   - failed / cancelled / reaped → the PR is CLOSED, and the task's stamp, claim and the marker are released so a
 *     later run opens a fresh one. It is never marked ready.
 *   - succeeded but never adopted → marked READY with the run's final text (the finalize's builder), the marker
 *     cleared. A succeeded run with nothing on its branch has nothing to review: that one is closed.
 * A branch whose commits cannot be listed is left for the next pass.
 *
 * A draft whose RECORD never landed (the opener died between the provider create and the transaction: the task holds
 * an old claim and no PR stamp) is found through the provider: the open PR on the task's branch, only if it is a
 * draft whose body is the platform's own draft placeholder, is settled the same way.
 *
 * A mark-ready that FAILED leaves the row `open` with its marker kept (`markPlatformDraftOpen(..., false)`). The recorded
 * query selects those rows too (`open` + marker), so the next pass retries the mark-ready and clears the marker on
 * success; on failure the marker stays for the pass after. An `open` marked row may be a human's ready PR (the
 * reconciler keeps the marker), so it is never closed and its title/body are never sent: the retry is status-only, and
 * when its opener died or left nothing on the branch the marker is simply cleared (ownership given up).
 *
 * A crash between the close's compare-and-set and the provider close leaves the task's open-claim in place
 * (`retirePlatformDraft` does not clear it); the claim is released here only after the provider close succeeded, and
 * the held-claim pass below finds the still-open draft through the provider if the close never happened.
 */
import { and, asc, eq, exists, inArray, isNotNull, isNull, lt, notExists, notInArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { executions, pullRequests, tasks } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { integrationCredentialSecret } from '../integrations/integrationCredentialSecret';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { isDraftPullRequestBody, runPullRequestText } from '../runtime/runPullRequestText';
import { closePullRequest, listBranchCommits } from './branchLifecycle';
import { ticketBranchName } from './commitFileAsPendingChange';
import { lookupOpenPullRequest, markReadyForReview } from './createPullRequest';
import { draftRunOutcome, ORPHAN_DRAFT_GRACE_MS } from './orphanRunOutcome';
import { LIVE_EXECUTION_STATUSES, taskHasLiveRun } from '../runtime/liveExecutionStatus';
import { prClaimStaleBefore, releaseTaskPrClaim } from './openTaskPullRequest';
import { markPlatformDraftOpen, PLATFORM_DRAFT_STATUS, restorePlatformDraft, retirePlatformDraft } from './platformDraftPullRequest';
import { recordTaskPullRequest } from './recordTaskPullRequest';
import { resolveDefaultRepoForTask } from './resolveDefaultRepo';
import { isResolveError, resolveRepoCredential } from './resolveRepoCredential';

export { ORPHAN_DRAFT_GRACE_MS };

/** Drafts settled per pass: each is a few provider calls, and a Worker has a subrequest ceiling. The rest wait for the next pass. */
export const ORPHAN_DRAFT_BATCH = 10;

const SOURCE = 'application/repos/sweepOrphanedDraftPrs.ts';

/** The row status of a marked row whose mark-ready failed: `open` (taken out of draft locally) with its marker kept. */
const RETRY_READY_STATUS = 'open';

export interface OrphanDraftSweepResult { checked: number; readied: number; closed: number; skipped: number }

interface Orphan {
  tenantId: number; taskId: number; taskTitle: string; repoId: string; number: number; url: string; branch: string; base: string | null;
  /** The recorded row; absent for a draft whose record never landed. */
  rowId?: string;
  /** The recorded row's status: `open` is a marked row whose mark-ready failed (retried, never closed). */
  rowStatus?: string;
  /** The run that opened the draft (the row's marker); absent for a draft whose record never landed. */
  draftExecutionId?: number;
}

/** Settle one orphaned draft by how the run that OPENED it ended. */
async function settle(db: Db, secret: string, now: Date, o: Orphan): Promise<'readied' | 'closed' | 'skipped'> {
  const outcome = await draftRunOutcome(db, o.tenantId, o.taskId, o.draftExecutionId ?? null, now);
  if (outcome !== 'succeeded' && outcome !== 'dead') return 'skipped';
  if (o.rowStatus === RETRY_READY_STATUS && o.rowId) return settleOpenMarked(db, secret, o, o.rowId, outcome);
  const resolved = await resolveRepoCredential(db, secret, o.tenantId, o.repoId);
  if (isResolveError(resolved)) return 'skipped';
  const target = { provider: resolved.repo.provider, host: resolved.repo.host, owner: resolved.repo.owner, repo: resolved.repo.repo, token: resolved.token };
  const commits = await listBranchCommits({ ...target, base: o.base ?? resolved.repo.defaultBranch ?? 'main', branch: o.branch });
  if (!commits.ok) return 'skipped';

  // The outcome was read before the credential and commit lookups (a few provider calls): a run may have started on the
  // task since. Re-check IMMEDIATELY before the first provider mutation, so a new run is never raced by a close or ready.
  if (await taskHasLiveRun(db, o.tenantId, o.taskId)) return 'skipped';

  if (outcome === 'succeeded' && (commits.commits.length > 0 || commits.truncated)) {
    const text = runPullRequestText({ taskId: o.taskId, taskTitle: o.taskTitle, agentLabel: 'Builderforce agent', writtenPaths: [], ciVerified: false });
    const ready = await markReadyForReview({ ...target, number: o.number, text });
    if (!ready.ok) reportCaughtError(new Error(`could not mark orphaned draft PR #${o.number} ready: ${ready.reason}`), { source: SOURCE, operation: 'markReadyForReview' });
    // The row follows the PR into the readers' view either way; a failed ready keeps the marker, and the `open` + marker
    // row is selected again next pass to retry the mark-ready.
    if (o.rowId) {
      await markPlatformDraftOpen(db, o.tenantId, o.rowId, ready.ok, o.draftExecutionId);
    } else {
      await recordTaskPullRequest(db, {
        tenantId: o.tenantId, segmentId: resolved.repo.segmentId, projectId: resolved.repo.projectId, repoId: o.repoId, taskId: o.taskId,
        provider: resolved.repo.provider, number: o.number, url: o.url, branchName: o.branch, baseBranch: o.base ?? resolved.repo.defaultBranch ?? 'main',
        status: 'open',
      });
    }
    return 'readied';
  }

  if (!o.rowId || o.draftExecutionId == null) {
    const closed = await closePullRequest({ ...target, number: o.number });
    if (!closed.ok && closed.code !== 'not_found') return 'skipped';
    await releaseTaskPrClaim(db, o.tenantId, o.taskId);
    return 'closed';
  }
  // A recorded draft: win the row's compare-and-set BEFORE touching the provider (see `retirePlatformDraft` for why that
  // order), and put the row back if the provider then refuses.
  const retire = { rowId: o.rowId, taskId: o.taskId, number: o.number, executionId: o.draftExecutionId };
  const retired = await retirePlatformDraft(db, o.tenantId, retire);
  if (!retired) return 'skipped';
  const closed = await closePullRequest({ ...target, number: o.number });
  if (!closed.ok && closed.code !== 'not_found') {
    await restorePlatformDraft(db, o.tenantId, { ...retire, url: o.url });
    return 'skipped';
  }
  // Only now that the provider closed it is the task's open-claim let go (the CAS left it so a crash stays recoverable),
  // and only the claim the CAS SAW: a run that retook the claim meanwhile keeps it.
  if (retired.claimedAt) await releaseTaskPrClaim(db, o.tenantId, o.taskId, retired.claimedAt);
  return 'closed';
}

/**
 * An `open` row that still carries the marker: either a mark-ready that failed, or a draft a human marked ready (the
 * reconciler keeps the marker). Either way it is never closed, and its title and body are never sent: the PR is taken
 * out of draft STATUS-ONLY (a no-op when it is already ready), then the marker is cleared. When the opener died, or
 * succeeded with nothing on the branch, there is nothing to ready: ownership is given up (the marker cleared) rather
 * than skipping the row forever.
 */
async function settleOpenMarked(db: Db, secret: string, o: Orphan, rowId: string, outcome: 'succeeded' | 'dead'): Promise<'readied' | 'skipped'> {
  const resolved = await resolveRepoCredential(db, secret, o.tenantId, o.repoId);
  if (isResolveError(resolved)) return 'skipped';
  const target = { provider: resolved.repo.provider, host: resolved.repo.host, owner: resolved.repo.owner, repo: resolved.repo.repo, token: resolved.token };
  if (outcome === 'succeeded') {
    const commits = await listBranchCommits({ ...target, base: o.base ?? resolved.repo.defaultBranch ?? 'main', branch: o.branch });
    if (!commits.ok) return 'skipped';
    if (await taskHasLiveRun(db, o.tenantId, o.taskId)) return 'skipped';
    if (commits.commits.length > 0 || commits.truncated) {
      const ready = await markReadyForReview({ ...target, number: o.number });
      if (!ready.ok) {
        reportCaughtError(new Error(`could not mark orphaned draft PR #${o.number} ready: ${ready.reason}`), { source: SOURCE, operation: 'markReadyForReview' });
        await markPlatformDraftOpen(db, o.tenantId, rowId, false, o.draftExecutionId); // marker kept; moves behind the queue
        return 'skipped';
      }
      await markPlatformDraftOpen(db, o.tenantId, rowId, true, o.draftExecutionId);
      return 'readied';
    }
  } else if (await taskHasLiveRun(db, o.tenantId, o.taskId)) return 'skipped';
  await markPlatformDraftOpen(db, o.tenantId, rowId, true, o.draftExecutionId); // give up ownership (only of the opener judged above)
  return 'skipped';
}

/** A pass that examined a task's unrecorded draft without settling it: it is not looked at again until the grace elapses. */
async function markHeldTaskChecked(db: Db, tenantId: number, taskId: number, now: Date): Promise<void> {
  await db.update(tasks).set({ orphanDraftCheckedAt: now }).where(scopedToTenant(tasks, tenantId, eq(tasks.id, taskId)));
}

/** A recorded draft examined and left: its `updated_at` moves it behind the rest of the oldest-first queue. */
async function rotateDraftBehind(db: Db, tenantId: number, rowId: string, now: Date): Promise<void> {
  await db.update(pullRequests).set({ updatedAt: now }).where(scopedToTenant(pullRequests, tenantId, eq(pullRequests.id, rowId)));
}

export async function sweepOrphanedDraftPullRequests(env: Env, db: Db, now: Date = new Date()): Promise<OrphanDraftSweepResult> {
  const result: OrphanDraftSweepResult = { checked: 0, readied: 0, closed: 0, skipped: 0 };
  const secret = integrationCredentialSecret(env);
  const graceCutoff = new Date(now.getTime() - ORPHAN_DRAFT_GRACE_MS);
  /** Settle one; a draft examined and not settled goes to the back of its queue so it cannot starve the rest. */
  const run = async (o: Orphan): Promise<boolean> => {
    result.checked++;
    let outcome: 'readied' | 'closed' | 'skipped' = 'skipped';
    try { outcome = await settle(db, secret, now, o); } catch (error) {
      reportCaughtError(error, { source: SOURCE, operation: 'sweepOrphanedDraftPullRequests' });
    }
    result[outcome]++;
    return outcome !== 'skipped';
  };

  // Recorded platform drafts: marked, and named by the task's own PR stamp. Filtered IN SQL to the ones that can be acted
  // on (the task has no live run, the opener ended before the grace), so live drafts - however many - cannot fill the batch
  // and starve a real orphan behind them.
  const opener = alias(executions, 'draft_opener');
  const drafts = await db
    .select({
      id: pullRequests.id, tenantId: pullRequests.tenantId, taskId: tasks.id, taskTitle: tasks.title, repoId: pullRequests.repoId,
      number: pullRequests.number, url: pullRequests.url, branch: pullRequests.branchName, base: pullRequests.baseBranch,
      draftExecutionId: pullRequests.platformDraftExecutionId, status: pullRequests.status,
    })
    .from(pullRequests)
    .innerJoin(tasks, and(eq(tasks.id, pullRequests.taskId), eq(tasks.githubPrNumber, pullRequests.number)))
    .where(and(
      inArray(pullRequests.status, [PLATFORM_DRAFT_STATUS, RETRY_READY_STATUS]), isNotNull(pullRequests.platformDraftExecutionId),
      isNotNull(pullRequests.repoId), isNotNull(pullRequests.number), isNotNull(pullRequests.branchName),
      notExists(db.select({ one: sql`1` }).from(executions).where(and(
        eq(executions.tenantId, pullRequests.tenantId), eq(executions.taskId, tasks.id), inArray(executions.status, [...LIVE_EXECUTION_STATUSES]),
      ))),
      exists(db.select({ one: sql`1` }).from(opener).where(and(
        eq(opener.tenantId, pullRequests.tenantId), eq(opener.id, pullRequests.platformDraftExecutionId),
        notInArray(opener.status, [...LIVE_EXECUTION_STATUSES]), lt(sql`coalesce(${opener.completedAt}, ${opener.createdAt})`, graceCutoff),
      ))),
    ))
    .orderBy(asc(pullRequests.updatedAt))
    .limit(ORPHAN_DRAFT_BATCH);
  for (const d of drafts) {
    const settled = await run({ tenantId: d.tenantId, taskId: d.taskId, taskTitle: d.taskTitle, repoId: d.repoId!, number: d.number!, url: d.url ?? '', branch: d.branch!, base: d.base, rowId: d.id, rowStatus: d.status ?? undefined, draftExecutionId: d.draftExecutionId! });
    if (!settled) await rotateDraftBehind(db, d.tenantId, d.id, now).catch((error) => reportCaughtError(error, { source: SOURCE, operation: 'rotateDraftBehind' }));
  }

  // Unrecorded drafts: a claim held past the bound with no PR stamped. The provider says whether a draft of ours is there.
  // Filtered in SQL like the recorded ones: tenant known, no live run, and not examined within the grace - a task whose
  // stale claim has nothing to settle is stamped below, so it does not crowd out the tasks behind it every tick.
  const held = await db
    .select({ id: tasks.id, tenantId: tasks.tenantId, title: tasks.title })
    .from(tasks)
    .where(and(
      isNotNull(tasks.tenantId), isNotNull(tasks.prOpeningAt), lt(tasks.prOpeningAt, prClaimStaleBefore(now)), isNull(tasks.githubPrUrl),
      or(isNull(tasks.orphanDraftCheckedAt), lt(tasks.orphanDraftCheckedAt, graceCutoff)),
      notExists(db.select({ one: sql`1` }).from(executions).where(and(
        eq(executions.taskId, tasks.id), eq(executions.tenantId, tasks.tenantId), inArray(executions.status, [...LIVE_EXECUTION_STATUSES]),
      ))),
    ))
    .orderBy(asc(tasks.prOpeningAt))
    .limit(ORPHAN_DRAFT_BATCH);
  for (const t of held) {
    const heldTenantId = t.tenantId!; // filtered `IS NOT NULL` above: a task with no tenant has no credential to settle against
    let settled = false;
    try {
      const repo = await resolveDefaultRepoForTask(db, heldTenantId, t.id);
      const resolved = repo ? await resolveRepoCredential(db, secret, heldTenantId, repo.repoId) : null;
      if (resolved && !isResolveError(resolved)) {
        const branch = ticketBranchName(t.id);
        const base = resolved.repo.defaultBranch ?? 'main';
        const found = await lookupOpenPullRequest({
          provider: resolved.repo.provider, host: resolved.repo.host, owner: resolved.repo.owner, repo: resolved.repo.repo,
          token: resolved.token, head: branch, base, title: '', body: '',
        });
        if (found && found.draft === true && isDraftPullRequestBody(found.body, t.id)) {
          settled = await run({ tenantId: heldTenantId, taskId: t.id, taskTitle: t.title, repoId: repo!.repoId, number: found.number, url: found.url, branch, base });
        }
      }
    } catch (error) {
      reportCaughtError(error, { source: SOURCE, operation: 'sweepUnrecordedDrafts' });
    }
    if (!settled) await markHeldTaskChecked(db, heldTenantId, t.id, now).catch((error) => reportCaughtError(error, { source: SOURCE, operation: 'markHeldTaskChecked' }));
  }
  return result;
}
