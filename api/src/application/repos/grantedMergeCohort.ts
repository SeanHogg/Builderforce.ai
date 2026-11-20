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
 *   - only a PR the granted run itself opened (`merge_grant_pull_requests`, bound at its finalize)
 *     — never another run's PR on the same ticket;
 *   - only at the head that run left (`head_sha`). A head that moved past it means someone else
 *     pushed: the grant is VOIDED, never merged on commits nobody granted;
 *   - only ONCE: the grant is claimed atomically before the merge (`claimMergeGrant`) and given
 *     back if the merge does not happen, so two bound PRs or two overlapping sweeps cannot both
 *     merge on one grant.
 *
 * NO BASE SYNC. The managed queue updates a branch from its base before merging; doing that here
 * would move the head off the commit the person's grant (and the run's checks) covered. A granted
 * PR merges at its pinned commit or not at all — the provider refuses (conflict / branch rule)
 * when that is not possible, and the hold says so.
 *
 * A hold is the binding's CURRENT `hold_code` (cleared when it clears) plus one PR-timeline line
 * per change of reason (`merge_grant_held`, `recordManagerActionOnChange`) — its own type, so it
 * never feeds the managed queue's `merge_blocked` ceilings. The sweep calls this; it is still the
 * ONE automatic merge writer.
 */
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { mergeGrantPullRequests, mergeGrants, pullRequests } from '../../infrastructure/database/schema';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { recordManagerAction, recordManagerActionOnChange, stateFingerprint } from '../manager/managerActionJournal';
import type { PassBudget } from '../manager/passBudget';
import { taskHasLiveRun } from '../runtime/liveExecutionStatus';
import {
  claimMergeGrant, releaseMergeGrant, setMergeGrantHold, voidMergeGrant,
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
  grantedBy: string;
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
 * The bound PRs of LIVE grants, oldest grant first. Bound through `merge_grant_pull_requests` —
 * the PR the granted run opened — and tenant-correlated at every join.
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
    .orderBy(asc(mergeGrants.createdAt), asc(mergeGrantPullRequests.createdAt))
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
  const granted = await loadGrantedPrs(db).catch((error) => {
    reportCaughtError(error, { source: 'application/repos/grantedMergeCohort.ts', operation: 'loadGrantedPrs' });
    return [] as GrantedPr[];
  });
  /** Grants spent (merged, voided) this tick — a second PR bound to the same grant is skipped. */
  const spent = new Set<string>();
  for (const pr of granted) {
    if (budget.over() || out.merged >= MAX_GRANTED_MERGES_PER_TICK) break;
    if (spent.has(pr.grantId)) continue;
    try {
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

      // ONCE: claim the grant atomically, merge, and give it back if the merge did not happen.
      if (!(await claimMergeGrant(db, pr.tenantId, pr.grantId))) { spent.add(pr.grantId); continue; }
      spent.add(pr.grantId);
      const result = await mergeRecordedPullRequest(db, env, {
        tenantId: pr.tenantId, prId: pr.id, method: 'squash', mergedBy: pr.grantedBy,
        expectedHeadSha: pr.pinnedHeadSha,
      }).catch(async (error) => {
        await releaseMergeGrant(db, pr.tenantId, pr.grantId);
        throw error;
      });
      if (!result.ok) {
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
