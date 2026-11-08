/**
 * mergeOnGreen - merge a task's ticket branch once CI is green, THROUGH the security gate.
 *
 * Callers: the CI webhook (`ingestRepoCiEvent`, mode `defer`) and the security-verdict catch-up sweep
 * (`security/securityVerdictCatchup`, mode `check`). PRD 08 §10: an incomplete scan or an open BLOCKER
 * finding on the PR at the commit CI passed on holds the merge (the same gate cloudFinalize and the manager's
 * merge sweep use); the PR stays open for a human to fix, triage or accept the risk.
 *
 * `eventSha` is the commit CI reported green. The gate judges - and the merge is pinned to - the open PR whose
 * head IS that commit, so a verdict reached for a newer head can never ship on the strength of an older
 * commit's green CI: that case is a block until CI is green on the new head.
 *
 * `defer` (the webhook): a missing scan is SCHEDULED past the response - never run inline - and when it
 * completes this same evaluation runs again in `check` mode, so the merge actually happens then. `check`
 * only judges what is recorded, so a scan that ends blocked cannot reschedule itself.
 */
import { reportCaughtError } from '../observability/caughtErrorReporter';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { resolveDefaultRepoForTask } from '../repos/resolveDefaultRepo';
import { resolveRepoCredential, isResolveError } from '../repos/resolveRepoCredential';
import { mergeBranchToBase } from '../repos/mergeBranchToBase';
import { ticketBranchName } from '../repos/commitFileAsPendingChange';
import { markPullRequestMergedByTask } from '../repos/recordPullRequestRow';
import { closeTicketAutomatically } from '../manager/reviewGateAuthority';
import { describeSecurityBlock } from '../security/prSecurityGate';
import { securityGateForTask } from '../security/ensurePrSecurityVerdict';
import { recordCloudToolEvent } from '../runtime/cloudToolEvents';
import { taskHasLiveRun } from '../runtime/liveExecutionStatus';

export interface MergeOnGreenContext {
  tenantId: number;
  taskId: number;
  execId: number | null;
  /** The branch CI reported on; must be the task's ticket branch. */
  branch: string | null;
  /** The commit CI passed on. */
  eventSha: string | null;
}

export async function mergeOnGreen(
  db: Db, env: Env, secret: string, ctx: MergeOnGreenContext, mode: 'defer' | 'check',
): Promise<boolean> {
  const { tenantId, taskId, execId } = ctx;
  // Green CI on a branch a run is still writing is not a finished change (and may be the run's own early draft).
  if (await taskHasLiveRun(db, tenantId, taskId)) return false;
  const verdict = await securityGateForTask(db, env, tenantId, taskId, {
    mode, eventSha: ctx.eventSha,
    afterScan: mode === 'defer' ? async () => { await mergeOnGreen(db, env, secret, ctx, 'check'); } : undefined,
  });
  if (!verdict.allow) {
    await recordCloudToolEvent(db, {
      tenantId, executionId: execId, sessionKey: execId ? `exec:${execId}` : `task:${taskId}`,
      toolName: 'merge_blocked_security', category: 'tool',
      detail: { reasons: verdict.reasons }, result: describeSecurityBlock(verdict).slice(0, 300),
    });
    return false;
  }
  const repoRef = await resolveDefaultRepoForTask(db, tenantId, taskId);
  if (!repoRef) return false;
  const resolved = await resolveRepoCredential(db, secret, tenantId, repoRef.repoId);
  const ticketBranch = ticketBranchName(taskId);
  if (isResolveError(resolved) || ctx.branch !== ticketBranch) return false;
  const base = (resolved.repo.defaultBranch ?? 'main').trim();
  const mr = await mergeBranchToBase({
    provider: resolved.repo.provider, host: resolved.repo.host,
    owner: resolved.repo.owner, repo: resolved.repo.repo, token: resolved.token,
    base, head: ticketBranch, message: `Task #${taskId}: merge on green CI (BuilderForce)`,
    // Merge exactly the commit the gate verified (= the commit CI passed on); a moved head is a
    // non-merge (`head_moved`) and the next sweep re-scans it.
    expectedHeadSha: verdict.headSha,
  });
  if (!mr.ok) return false;
  // Stamp the merge SHA so the resulting deploy-branch build correlates back.
  await markPullRequestMergedByTask(db, tenantId, taskId, { mergeSha: mr.sha ?? null, env }).catch((error) => {
    reportCaughtError(error, { source: 'application/ci/mergeOnGreen.ts', operation: 'markMerged' });
  });
  // Merge on green → ticket complete, through the same review gate every automatic close obeys (1153).
  // Held: the merge above stands and the ticket waits in review.
  await closeTicketAutomatically(env, db, { tenantId, taskId, source: 'ci_merge' }).catch((error) => {
    reportCaughtError(error, { source: 'application/ci/mergeOnGreen.ts', operation: 'closeTicket' });
  });
  return true;
}
