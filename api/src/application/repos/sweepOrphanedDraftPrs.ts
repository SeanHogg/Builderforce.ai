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
 * WHEN: the task has no live run, and its last run ENDED more than the grace period ago (`lastRunOutcome`).
 *
 * WHAT, by how that last run ended — never by "the branch has commits" alone, because a cancelled or failed run's
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
 * The same pass retries a mark-ready that failed: the row keeps its marker, and when the reconciler reverts it to
 * `draft` this sweep sees it again.
 */
import { and, asc, eq, isNotNull, isNull, lt } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { pullRequests, tasks } from '../../infrastructure/database/schema';
import { integrationCredentialSecret } from '../integrations/integrationCredentialSecret';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { isDraftPullRequestBody, runPullRequestText } from '../runtime/runPullRequestText';
import { closePullRequest, listBranchCommits } from './branchLifecycle';
import { ticketBranchName } from './commitFileAsPendingChange';
import { lookupOpenPullRequest, markReadyForReview } from './createPullRequest';
import { lastRunOutcome } from './orphanRunOutcome';
import { prClaimStaleBefore, releaseTaskPrClaim } from './openTaskPullRequest';
import { markPlatformDraftOpen, PLATFORM_DRAFT_STATUS, retirePlatformDraft } from './platformDraftPullRequest';
import { recordTaskPullRequest } from './recordTaskPullRequest';
import { resolveDefaultRepoForTask } from './resolveDefaultRepo';
import { isResolveError, resolveRepoCredential } from './resolveRepoCredential';

export { ORPHAN_DRAFT_GRACE_MS } from './orphanRunOutcome';

/** Drafts settled per pass: each is a few provider calls, and a Worker has a subrequest ceiling. The rest wait for the next pass. */
export const ORPHAN_DRAFT_BATCH = 10;

const SOURCE = 'application/repos/sweepOrphanedDraftPrs.ts';

export interface OrphanDraftSweepResult { checked: number; readied: number; closed: number; skipped: number }

interface Orphan {
  tenantId: number; taskId: number; taskTitle: string; repoId: string; number: number; url: string; branch: string; base: string | null;
  /** The recorded row; absent for a draft whose record never landed. */
  rowId?: string;
}

/** Settle one orphaned draft by how its task's last run ended. */
async function settle(db: Db, secret: string, now: Date, o: Orphan): Promise<'readied' | 'closed' | 'skipped'> {
  const outcome = await lastRunOutcome(db, o.tenantId, o.taskId, now);
  if (outcome !== 'succeeded' && outcome !== 'dead') return 'skipped';
  const resolved = await resolveRepoCredential(db, secret, o.tenantId, o.repoId);
  if (isResolveError(resolved)) return 'skipped';
  const target = { provider: resolved.repo.provider, host: resolved.repo.host, owner: resolved.repo.owner, repo: resolved.repo.repo, token: resolved.token };
  const commits = await listBranchCommits({ ...target, base: o.base ?? resolved.repo.defaultBranch ?? 'main', branch: o.branch });
  if (!commits.ok) return 'skipped';

  if (outcome === 'succeeded' && (commits.commits.length > 0 || commits.truncated)) {
    const text = runPullRequestText({ taskId: o.taskId, taskTitle: o.taskTitle, agentLabel: 'Builderforce agent', writtenPaths: [], ciVerified: false });
    const ready = await markReadyForReview({ ...target, number: o.number, text });
    if (!ready.ok) reportCaughtError(new Error(`could not mark orphaned draft PR #${o.number} ready: ${ready.reason}`), { source: SOURCE, operation: 'markReadyForReview' });
    // The row follows the PR into the readers' view either way; a failed ready keeps the marker so a reverted row is retried.
    if (o.rowId) {
      await markPlatformDraftOpen(db, o.tenantId, o.rowId, ready.ok);
    } else {
      await recordTaskPullRequest(db, {
        tenantId: o.tenantId, segmentId: resolved.repo.segmentId, projectId: resolved.repo.projectId, repoId: o.repoId, taskId: o.taskId,
        provider: resolved.repo.provider, number: o.number, url: o.url, branchName: o.branch, baseBranch: o.base ?? resolved.repo.defaultBranch ?? 'main',
        status: 'open',
      });
    }
    return 'readied';
  }

  const closed = await closePullRequest({ ...target, number: o.number });
  if (!closed.ok && closed.code !== 'not_found') return 'skipped';
  if (o.rowId) await retirePlatformDraft(db, o.tenantId, { rowId: o.rowId, taskId: o.taskId, number: o.number });
  else await releaseTaskPrClaim(db, o.tenantId, o.taskId);
  return 'closed';
}

export async function sweepOrphanedDraftPullRequests(env: Env, db: Db, now: Date = new Date()): Promise<OrphanDraftSweepResult> {
  const result: OrphanDraftSweepResult = { checked: 0, readied: 0, closed: 0, skipped: 0 };
  const secret = integrationCredentialSecret(env);
  const run = async (o: Orphan) => {
    result.checked++;
    try { result[await settle(db, secret, now, o)]++; } catch (error) {
      result.skipped++;
      reportCaughtError(error, { source: SOURCE, operation: 'sweepOrphanedDraftPullRequests' });
    }
  };

  // Recorded platform drafts: marked, and named by the task's own PR stamp.
  const drafts = await db
    .select({
      id: pullRequests.id, tenantId: pullRequests.tenantId, taskId: tasks.id, taskTitle: tasks.title, repoId: pullRequests.repoId,
      number: pullRequests.number, url: pullRequests.url, branch: pullRequests.branchName, base: pullRequests.baseBranch,
    })
    .from(pullRequests)
    .innerJoin(tasks, and(eq(tasks.id, pullRequests.taskId), eq(tasks.githubPrNumber, pullRequests.number)))
    .where(and(
      eq(pullRequests.status, PLATFORM_DRAFT_STATUS), isNotNull(pullRequests.platformDraftExecutionId),
      isNotNull(pullRequests.repoId), isNotNull(pullRequests.number), isNotNull(pullRequests.branchName),
    ))
    .orderBy(asc(pullRequests.updatedAt))
    .limit(ORPHAN_DRAFT_BATCH);
  for (const d of drafts) await run({ tenantId: d.tenantId, taskId: d.taskId, taskTitle: d.taskTitle, repoId: d.repoId!, number: d.number!, url: d.url ?? '', branch: d.branch!, base: d.base, rowId: d.id });

  // Unrecorded drafts: a claim held past the bound with no PR stamped. The provider says whether a draft of ours is there.
  const held = await db
    .select({ id: tasks.id, tenantId: tasks.tenantId, title: tasks.title })
    .from(tasks)
    .where(and(isNotNull(tasks.prOpeningAt), lt(tasks.prOpeningAt, prClaimStaleBefore(now)), isNull(tasks.githubPrUrl)))
    .orderBy(asc(tasks.prOpeningAt))
    .limit(ORPHAN_DRAFT_BATCH);
  for (const t of held) {
    const heldTenantId = t.tenantId;
    if (heldTenantId === null) continue; // a task with no tenant has no credential to settle against
    try {
      const repo = await resolveDefaultRepoForTask(db, heldTenantId, t.id);
      const resolved = repo ? await resolveRepoCredential(db, secret, heldTenantId, repo.repoId) : null;
      if (!resolved || isResolveError(resolved)) continue;
      const branch = ticketBranchName(t.id);
      const base = resolved.repo.defaultBranch ?? 'main';
      const found = await lookupOpenPullRequest({
        provider: resolved.repo.provider, host: resolved.repo.host, owner: resolved.repo.owner, repo: resolved.repo.repo,
        token: resolved.token, head: branch, base, title: '', body: '',
      });
      if (!found || found.draft !== true || !isDraftPullRequestBody(found.body, t.id)) continue;
      await run({ tenantId: heldTenantId, taskId: t.id, taskTitle: t.title, repoId: repo!.repoId, number: found.number, url: found.url, branch, base });
    } catch (error) {
      reportCaughtError(error, { source: SOURCE, operation: 'sweepUnrecordedDrafts' });
    }
  }
  return result;
}
