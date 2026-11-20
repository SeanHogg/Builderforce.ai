/**
 * grantedMergeCohort — the PR merge sweep's SECOND cohort: pull requests a person granted a
 * merge into main for (PRD 48 §4.6).
 *
 * A grant is a PRE-APPROVED HUMAN MERGE, so it works EXACTLY like the in-product Merge button:
 * the same checks (`gateHumanMerge` — the security gate, at the commit it is judged on) plus green
 * CI on that same commit, and none of the project's merge settings (the manager opt-in,
 * `allowAutoMerge`, canary, sign-off) — the button is not bound by them either. It runs AHEAD of
 * the managed queue, inside the sweep's own budget.
 *
 * WHAT MERGES IS NARROW, ON PURPOSE:
 *   - only a PR bound to the grant at its run's finalize (`merge_grant_pull_requests`);
 *   - only at the commit that run pushed (`head_sha`). A head that moved past it means someone
 *     else pushed: the grant is VOIDED, never merged on commits nobody granted;
 *   - only while the person who granted it may STILL merge (current membership + role), else
 *     voided `granter_revoked`;
 *   - only ONCE: the grant is claimed atomically before the merge (`claimMergeGrant`). It is given
 *     back ONLY on a definite provider refusal; a THROW keeps the claim (the merge may have
 *     happened), and once the claim is 30 minutes old with its PR still open the reconcile
 *     (`reconcileStuckMergeClaims`) asks the provider — merged → spent, not merged → released.
 *
 * FAIRNESS: grants are visited least-recently-considered first and stamped on every visit, so a
 * tenant's held grants cannot starve another's; a grant expires seven days after it was given.
 *
 * NO BASE SYNC. The managed queue updates a branch from its base before merging; doing that here
 * would move the head off the commit the person granted. The managed queue in turn SKIPS a PR
 * bound to a live grant, so its sync and conflict recovery can never void one.
 */
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { mergeGrantPullRequests, mergeGrants, pullRequests } from '../../infrastructure/database/schema';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { recordManagerAction, recordManagerActionOnChange, stateFingerprint } from '../manager/managerActionJournal';
import type { PassBudget } from '../manager/passBudget';
import { taskHasLiveRun } from '../runtime/liveExecutionStatus';
import {
  claimMergeGrant, expireMergeGrants, granterStillAuthorized, reconcileStuckMergeClaims, releaseMergeGrant, setMergeGrantHold,
  settleGrantsWithoutOpenPr, touchMergeGrant, voidMergeGrant,
  MERGE_GRANT_HELD_ACTION, type MergeGrantHoldCode,
} from '../runtime/mergeGrants';
import { INLINE_STEP_MIN_REMAINING_MS } from '../security/ensurePrSecurityVerdict';
import { gateHumanMerge } from './humanMergeGate';
import { mergeRecordedPullRequest } from './mergeRecordedPr';
import { pollPrCiHead } from './pollPrCiStatus';

/** Bound PRs examined per tick — a grant is rare and each costs a scan at most. */
export const GRANTED_MERGE_WINDOW = 20;
/** Granted merges per tick — a small constant, like the queue's depth: each one moves a base. */
export const MAX_GRANTED_MERGES_PER_TICK = 3;

export interface GrantedPr {
  bindingId: string;
  grantId: string;
  grantedBy: string | null;
  pinnedHeadSha: string;
  tenantId: number;
  projectId: number;
  taskId: number | null;
  id: string;
  number: number | null;
  repoId: string | null;
  buildStatus: string | null;
  updatedAt: Date;
}

export interface GrantedMergeResult { considered: number; merged: number; held: number; voided: number }

/**
 * The bound PRs of LIVE grants, LEAST-RECENTLY-CONSIDERED grant first (never-visited first). Bound
 * through `merge_grant_pull_requests` — the PR the granted run opened — and tenant-correlated at
 * every join.
 */
export async function loadGrantedPrs(db: Db, limit: number = GRANTED_MERGE_WINDOW): Promise<GrantedPr[]> {
  const rows = await db
    .select({
      bindingId: mergeGrantPullRequests.id, grantId: mergeGrants.id, grantedBy: mergeGrants.grantedBy,
      pinnedHeadSha: mergeGrantPullRequests.headSha, tenantId: mergeGrants.tenantId,
      projectId: pullRequests.projectId, taskId: pullRequests.taskId,
      id: pullRequests.id, number: pullRequests.number, repoId: pullRequests.repoId,
      buildStatus: pullRequests.buildStatus, updatedAt: pullRequests.updatedAt,
    })
    .from(mergeGrantPullRequests)
    .innerJoin(mergeGrants, and(
      eq(mergeGrants.id, mergeGrantPullRequests.grantId),
      eq(mergeGrants.tenantId, mergeGrantPullRequests.tenantId),
    ))
    .innerJoin(pullRequests, and(
      eq(pullRequests.id, mergeGrantPullRequests.pullRequestId),
      eq(pullRequests.tenantId, mergeGrantPullRequests.tenantId),
    ))
    .where(and(
      isNull(mergeGrants.consumedAt),
      isNull(mergeGrants.voidedAt),
      eq(pullRequests.status, 'open'),
    ))
    .orderBy(sql`${mergeGrants.lastConsideredAt} asc nulls first`, asc(mergeGrants.createdAt), asc(mergeGrantPullRequests.createdAt))
    .limit(limit);
  return rows.flatMap((r) => (r.projectId == null ? [] : [{ ...r, projectId: r.projectId }]));
}

/** Hold a bound PR: its CURRENT reason on the binding, and one timeline line per change of reason. */
async function hold(db: Db, pr: GrantedPr, code: MergeGrantHoldCode, why: string, detail: readonly string[] = []): Promise<void> {
  await setMergeGrantHold(db, pr.tenantId, pr.bindingId, code);
  await recordManagerActionOnChange(db, {
    tenantId: pr.tenantId, projectId: pr.projectId, taskId: pr.taskId, prId: pr.id,
    actionType: MERGE_GRANT_HELD_ACTION,
    stateKey: `merge-grant:${pr.id}`,
    fingerprint: stateFingerprint([code, ...[...detail].sort()]),
    summary: `A person granted merging PR #${pr.number ?? '?'} into main; it is held — ${why}`,
    detail: { grantId: pr.grantId, code, reasons: detail },
  });
}

/**
 * Work the granted cohort once, inside the SWEEP's budget (never its own). Never throws; one
 * PR's failure never stops the next.
 */
export async function runGrantedMerges(env: Env, db: Db, budget: PassBudget): Promise<GrantedMergeResult> {
  const out: GrantedMergeResult = { considered: 0, merged: 0, held: 0, voided: 0 };
  // Housekeeping first, so the cohort below only sees grants that can still apply.
  out.voided += await expireMergeGrants(db).catch((error) => {
    reportCaughtError(error, { source: 'application/repos/grantedMergeCohort.ts', operation: 'expireMergeGrants' });
    return 0;
  });
  await settleGrantsWithoutOpenPr(db).catch((error) => {
    reportCaughtError(error, { source: 'application/repos/grantedMergeCohort.ts', operation: 'settleGrantsWithoutOpenPr' });
  });
  // A claim kept over a thrown merge whose PR is still open is asked of the provider (merged →
  // spent; not merged → released back to live), so it can never sit "pending" forever.
  await reconcileStuckMergeClaims(env, db).catch((error) => {
    reportCaughtError(error, { source: 'application/repos/grantedMergeCohort.ts', operation: 'reconcileStuckMergeClaims' });
  });
  const granted = await loadGrantedPrs(db).catch((error) => {
    reportCaughtError(error, { source: 'application/repos/grantedMergeCohort.ts', operation: 'loadGrantedPrs' });
    return [] as GrantedPr[];
  });
  /** Grants spent (merged, voided, claimed) this tick — a second PR bound to the same grant is skipped. */
  const spent = new Set<string>();
  /** Grants already stamped as visited this tick. */
  const touched = new Set<string>();
  for (const pr of granted) {
    if (budget.over() || out.merged >= MAX_GRANTED_MERGES_PER_TICK) break;
    if (spent.has(pr.grantId)) continue;
    try {
      if (!touched.has(pr.grantId)) {
        touched.add(pr.grantId);
        await touchMergeGrant(db, pr.tenantId, pr.grantId);
      }
      // The run (or a later one) is still writing the ticket's branch: nothing to judge yet.
      if (pr.taskId != null && await taskHasLiveRun(db, pr.tenantId, pr.taskId)) continue;
      out.considered += 1;

      // THE IN-PRODUCT MERGE BUTTON'S CHECK — shared, so the two cannot drift.
      const gate = await gateHumanMerge(db, env, pr.tenantId, pr.id, {
        mode: budget.canAfford(INLINE_STEP_MIN_REMAINING_MS) ? 'inline' : 'defer',
      });
      const judgedHead = gate.ok ? gate.headSha : gate.body.details.headSha;
      // Someone pushed past the commit the grant covers: void it — never merge commits nobody granted.
      if (judgedHead && judgedHead.toLowerCase() !== pr.pinnedHeadSha.toLowerCase()) {
        await voidMergeGrant(db, { tenantId: pr.tenantId, grantId: pr.grantId, reason: 'head_moved' });
        spent.add(pr.grantId);
        out.voided += 1;
        continue;
      }
      if (!gate.ok) {
        out.held += 1;
        await hold(db, pr, 'security', gate.body.error, gate.body.details.reasons.map((r) => r.code));
        continue;
      }

      // PLUS GREEN CI on that same commit (unknown or pending CI holds, exactly like red).
      const ci = await pollPrCiHead(env, db, pr.tenantId, pr);
      if (!ci || !ci.green || !ci.headSha || ci.headSha.toLowerCase() !== gate.headSha.toLowerCase()) {
        out.held += 1;
        const failed = pr.buildStatus === 'failure';
        await hold(db, pr, failed ? 'ci_failed' : 'ci_pending', failed
          ? 'CI failed on this pull request; it merges once CI is green.'
          : 'waiting for CI to pass on the commit the grant covers.');
        continue;
      }

      // THE GRANTER'S AUTHORITY, NOW — not as it was when they clicked.
      if (!(await granterStillAuthorized(env, db, pr.tenantId, pr.grantedBy))) {
        await voidMergeGrant(db, { tenantId: pr.tenantId, grantId: pr.grantId, reason: 'granter_revoked' });
        spent.add(pr.grantId);
        out.voided += 1;
        continue;
      }

      // ONCE: claim the grant atomically, then merge.
      if (!(await claimMergeGrant(db, pr.tenantId, pr.grantId))) { spent.add(pr.grantId); continue; }
      spent.add(pr.grantId);
      let result: Awaited<ReturnType<typeof mergeRecordedPullRequest>>;
      try {
        result = await mergeRecordedPullRequest(db, env, {
          tenantId: pr.tenantId, prId: pr.id, method: 'squash', mergedBy: pr.grantedBy,
          expectedHeadSha: pr.pinnedHeadSha,
        });
      } catch (error) {
        // The provider may have merged before the throw: KEEP the claim, so nothing merges twice on
        // one grant. The reconcile settles it from the PR row (merged → spent, closed → voided).
        reportCaughtError(error, { source: 'application/repos/grantedMergeCohort.ts', operation: 'mergeRecordedPullRequest', context: { prId: pr.id, grantId: pr.grantId } });
        continue;
      }
      if (!result.ok) {
        // A DEFINITE refusal: the merge did not happen, so the grant is given back.
        await releaseMergeGrant(db, pr.tenantId, pr.grantId);
        if (result.code === 'head_moved') {
          await voidMergeGrant(db, { tenantId: pr.tenantId, grantId: pr.grantId, reason: 'head_moved' });
          out.voided += 1;
          continue;
        }
        out.held += 1;
        await hold(db, pr, 'merge_refused', `the provider refused the merge: ${result.error}`, [String(result.code ?? result.httpStatus)]);
        continue;
      }
      await setMergeGrantHold(db, pr.tenantId, pr.bindingId, null);
      if (result.alreadyMerged) {
        await recordManagerAction(db, {
          tenantId: pr.tenantId, projectId: pr.projectId, taskId: pr.taskId, prId: pr.id, actionType: 'merge_pr',
          summary: `PR #${pr.number ?? '?'} was already merged; the person's merge grant on it is settled without a merge.`,
          detail: { grantId: pr.grantId, alreadyMerged: true },
        });
        continue;
      }
      out.merged += 1;
      await recordManagerAction(db, {
        tenantId: pr.tenantId, projectId: pr.projectId, taskId: pr.taskId, prId: pr.id, actionType: 'merge_pr',
        summary: `Merged PR #${pr.number ?? '?'} into main on a person's merge grant (security scan and CI passed).`,
        detail: { sha: result.sha, grantId: pr.grantId, grantedBy: pr.grantedBy },
      });
    } catch (error) {
      reportCaughtError(error, { source: 'application/repos/grantedMergeCohort.ts', operation: 'runGrantedMerges', context: { prId: pr.id, grantId: pr.grantId } });
    }
  }
  return out;
}
