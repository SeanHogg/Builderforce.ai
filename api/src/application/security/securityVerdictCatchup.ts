/**
 * securityVerdictCatchup - the `security-verdict-catchup` sweep: closes the liveness gap in merge-on-green.
 *
 * Merge-on-green is event-driven: the CI webhook asks the security gate, and when the head has no complete
 * verdict yet it SCHEDULES the scan and relies on that scheduled task to merge afterwards. A scheduled task
 * can be lost (an evicted Worker, a deploy mid-flight) and CI will not fire again on its own, so a green PR
 * could wait forever. This sweep is the safety net:
 *
 *   for open PRs of a task whose CI is green and whose LATEST head has no complete security verdict (or only
 *   a stale `running` one) -> run the step (`securityVerdictEnsuringScan`, which only scans when
 *   `needsRescan` says so) -> and if the verdict now allows and CI is green on THAT head, run `mergeOnGreen`
 *   in `check` mode (the same merge path the webhook uses; it re-judges the recorded verdict and pins the merge).
 *
 * Capped per run and budget-aware (a scan can take ~25s), oldest first so nothing starves. A no-op unless the
 * deployment merges on green CI at all (`cloudMergeOnGreenCi`).
 */
import { and, asc, eq, gt, isNotNull } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { pullRequests } from '../../infrastructure/database/schema';
import { mergeOnGreen } from '../ci/mergeOnGreen';
import { integrationCredentialSecret } from '../integrations/integrationCredentialSecret';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { createPassBudget, type PassBudget } from '../manager/passBudget';
import { taskHasLiveRun } from '../runtime/liveExecutionStatus';
import { cloudMergeOnGreenCi } from '../repos/mergeBranchToBase';
import { pollPrCiHead } from '../repos/pollPrCiStatus';
import { INLINE_STEP_MIN_REMAINING_MS, securityVerdictEnsuringScan } from './ensurePrSecurityVerdict';
import { DAY_MS } from '../../domain/shared/time';

/** PRs examined per run: each may cost a scan + a model review, so the sweep is deliberately small. */
export const CATCHUP_MAX_PER_RUN = 5;
/** Only recent PRs: an old open PR is a human's to look at, not a sweep's to keep re-scanning. */
export const CATCHUP_LOOKBACK_DAYS = 7;
/** Wall-clock the sweep allows itself; it stops taking PRs once less than a full step (30s) is left. */
export const CATCHUP_BUDGET_MS = 90_000;

export interface CatchupResult { considered: number; merged: number; stoppedForBudget: boolean }

export async function runSecurityVerdictCatchup(
  env: Env, db: Db,
  budget: Pick<PassBudget, 'canAfford'> = createPassBudget(Date.now(), CATCHUP_BUDGET_MS, 0),
  now: Date = new Date(),
): Promise<CatchupResult> {
  const result: CatchupResult = { considered: 0, merged: 0, stoppedForBudget: false };
  if (!cloudMergeOnGreenCi(env)) return result;

  const candidates = await db
    .select({
      id: pullRequests.id, tenantId: pullRequests.tenantId, taskId: pullRequests.taskId, branchName: pullRequests.branchName,
      number: pullRequests.number, repoId: pullRequests.repoId, buildStatus: pullRequests.buildStatus, updatedAt: pullRequests.updatedAt,
    })
    .from(pullRequests)
    .where(and(
      eq(pullRequests.status, 'open'),
      eq(pullRequests.buildStatus, 'success'),
      isNotNull(pullRequests.taskId),
      gt(pullRequests.updatedAt, new Date(now.getTime() - CATCHUP_LOOKBACK_DAYS * DAY_MS)),
    ))
    .orderBy(asc(pullRequests.updatedAt))
    .limit(CATCHUP_MAX_PER_RUN * 4);

  const secret = integrationCredentialSecret(env);
  for (const pr of candidates) {
    if (result.considered >= CATCHUP_MAX_PER_RUN) break;
    if (!budget.canAfford(INLINE_STEP_MIN_REMAINING_MS)) { result.stoppedForBudget = true; break; }
    if (pr.taskId == null) continue;
    try {
      // A task with a live run is still being written: no scan or merge for it yet.
      if (await taskHasLiveRun(db, pr.tenantId, pr.taskId)) continue;
      // Scans the latest head if (and only if) it has no complete verdict or only a stale `running` one.
      const verdict = await securityVerdictEnsuringScan(db, env, pr.tenantId, pr.id, { mode: 'inline' });
      result.considered += 1;
      if (!verdict.allow) continue;
      // Merge only on the commit CI is green on: the verdict's head and CI's head must be one commit.
      const ci = await pollPrCiHead(env, db, pr.tenantId, pr);
      if (!ci?.green || !ci.headSha || ci.headSha.toLowerCase() !== verdict.headSha.toLowerCase()) continue;
      const merged = await mergeOnGreen(db, env, secret, {
        tenantId: pr.tenantId, taskId: pr.taskId, execId: null, branch: pr.branchName, eventSha: ci.headSha,
      }, 'check');
      if (merged) result.merged += 1;
    } catch (error) {
      reportCaughtError(error, { source: 'application/security/securityVerdictCatchup.ts', operation: 'catchup', context: { pullRequestId: pr.id } });
    }
  }
  return result;
}
