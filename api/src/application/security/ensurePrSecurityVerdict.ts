/**
 * ensurePrSecurityVerdict - the merge verdict for a PR whose scans may not exist yet for its CURRENT
 * head commit, scanning it first when they do not (PRD 08 §10).
 *
 * The gate is keyed on the head commit, so a push that did not come through a cloud run's finalize
 * (a human push, the manager's "update branch", an auto-fix commit) leaves the PR with no scan rows
 * and a blocked verdict. Something has to re-scan it or it is stuck forever; the merge paths that look
 * at the PR anyway are that something. They still apply the SAME gate: this module only makes sure the
 * evidence the gate asks for exists, then asks it.
 *
 * WHERE THE SCAN RUNS depends on who is asking (`mode`):
 *   - `inline`  the merge SWEEP, when its budget affords the step (a model review of up to 25s): runs the
 *               step itself and merges in the same pass if the verdict comes back clean;
 *   - `defer`   the human merge route and a sweep short on budget: SCHEDULES the step past the response
 *               (`deferPastResponse`, i.e. `ctx.waitUntil`) and returns a block that says so. When the
 *               scheduled step finishes it calls `afterScan`, the caller's own re-evaluation;
 *   - `check`   never scans: evaluates what is recorded. Used by `afterScan` itself, so a scan that
 *               ends blocked cannot reschedule itself forever.
 * With no invocation to defer to (a non-Worker caller, a test) nothing is scheduled and the block says
 * the next merge sweep will scan it - which is true: the sweep finds every open PR.
 *
 * It does NOT retry on every pass: a scan still running (fresh) is left alone, and one that failed or
 * was skipped is retried only after {@link RESCAN_AFTER_MS}, so a broken scanner costs one attempt per
 * window, not one per tick.
 *
 * Every result is a {@link PinnedVerdict}: an allow always carries the head commit it was reached for,
 * so the merge call pins to it (`expectedHeadSha`) and the provider refuses the merge if the head moved.
 */
import { and, eq } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { pullRequests } from '../../infrastructure/database/schema';
import { integrationCredentialSecret } from '../integrations/integrationCredentialSecret';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { isResolveError, resolveRepoCredential } from '../repos/resolveRepoCredential';
import { deferPastResponse } from '../shared/requestScope';
import { loadGateInputs, resolvePullRequestHead, securityGateAtHead } from './prSecurityGate';
import { runPullRequestSecurityStep, type PullRequestSecurityStepResult } from './pullRequestSecurityStep';
import { gateReason, pinVerdict, REQUIRED_SCAN_TYPES, type GateScanRow, type PinnedVerdict } from './securityMergeGate';

/** A `failed` / `skipped` scan is retried after this long, so a broken scanner costs one attempt per window. */
export const RESCAN_AFTER_MS = 15 * 60 * 1000;
/**
 * A `running` row older than this is a crashed or abandoned scan (a deferred step that never finished, an
 * evicted Worker): stale and rescannable. A scan really takes seconds - the review is capped at 25s - so
 * five minutes is far past any live one, and short enough that a PR is not held a quarter of an hour by a
 * scan that died.
 */
export const RUNNING_STALE_AFTER_MS = 5 * 60 * 1000;

/** How much of the pass a sweep must have left to run the step (a review of up to 25s) inline. */
export const INLINE_STEP_MIN_REMAINING_MS = 30_000;

export type EnsureMode = 'inline' | 'defer' | 'check';
export interface EnsureOptions {
  mode?: EnsureMode;
  /** Called after a DEFERRED step finishes: the caller's own merge evaluation (it must use mode `check`). */
  afterScan?: () => Promise<void>;
}

/**
 * Whether the scans recorded for the current head warrant (re)running the step. PURE.
 * Missing rows: yes. A fresh `running` row: no (someone is on it). A stale `running` row (a crashed
 * scan) or a `failed` / `skipped` row older than the window: yes. A completed row, even a truncated
 * one, is final for this commit - scanning again would see the same cap.
 */
export function needsRescan(scansAtHead: readonly GateScanRow[], now: Date = new Date()): boolean {
  for (const type of REQUIRED_SCAN_TYPES) {
    const rows = scansAtHead.filter((s) => s.scanType === type);
    if (rows.length === 0) return true;
    if (rows.some((r) => r.status === 'completed')) continue;
    const newest = Math.max(...rows.map((r) => r.updatedAt?.getTime() ?? 0));
    const window = rows.every((r) => r.status === 'running') ? RUNNING_STALE_AFTER_MS : RESCAN_AFTER_MS;
    if (now.getTime() - newest >= window) return true;
  }
  return false;
}

/** Run the step for a recorded PR (credentials, branch and base from its row). Null when it cannot be set up. */
async function runStepForPullRequest(
  db: Db, env: Env, tenantId: number, pullRequestId: string,
): Promise<PullRequestSecurityStepResult | null> {
  const [pr] = await db
    .select({
      repoId: pullRequests.repoId, branchName: pullRequests.branchName, baseBranch: pullRequests.baseBranch,
      number: pullRequests.number, url: pullRequests.url, segmentId: pullRequests.segmentId,
    })
    .from(pullRequests)
    .where(and(eq(pullRequests.id, pullRequestId), eq(pullRequests.tenantId, tenantId)))
    .limit(1);
  if (!pr?.repoId || !pr.branchName) return null;
  const resolved = await resolveRepoCredential(db, integrationCredentialSecret(env), tenantId, pr.repoId);
  if (isResolveError(resolved)) return null;
  return runPullRequestSecurityStep(env, db, {
    tenantId, segmentId: pr.segmentId, pullRequestId, prNumber: pr.number, prUrl: pr.url, executionId: null,
    agentLabel: 'merge gate',
    read: {
      provider: resolved.repo.provider, host: resolved.repo.host, owner: resolved.repo.owner,
      repo: resolved.repo.repo, token: resolved.token, ref: pr.branchName,
    },
    base: pr.baseBranch ?? resolved.repo.defaultBranch ?? 'main',
  });
}

export async function securityVerdictEnsuringScan(
  db: Db, env: Env, tenantId: number, pullRequestId: string, options: EnsureOptions = {},
): Promise<PinnedVerdict> {
  const mode = options.mode ?? 'inline';
  const head = await resolvePullRequestHead(db, env, tenantId, pullRequestId);
  if (!head.ok) return pinVerdict(await securityGateAtHead(db, tenantId, pullRequestId, null), null);

  const inputs = await loadGateInputs(db, tenantId, pullRequestId, head.sha);
  const verdict = pinVerdict(await securityGateAtHead(db, tenantId, pullRequestId, head.sha), head.sha);
  if (verdict.allow || mode === 'check' || !needsRescan(inputs.scans.filter((s) => s.headSha === head.sha))) return verdict;

  if (mode === 'defer') {
    const scheduled = deferPastResponse((async () => {
      try {
        await runStepForPullRequest(db, env, tenantId, pullRequestId);
        await options.afterScan?.();
      } catch (error) {
        reportCaughtError(error, { source: 'application/security/ensurePrSecurityVerdict.ts', operation: 'deferredSecurityStep', context: { tenantId, pullRequestId } });
      }
    })());
    // Never allow on the strength of a scan that has only been SCHEDULED.
    return {
      allow: false,
      reasons: [...(verdict.allow ? [] : verdict.reasons), scheduled
        ? gateReason('scan_scheduled', 'a security scan of this commit has been scheduled; the merge is attempted when it completes')
        : gateReason('scan_unscheduled', 'this commit has not been scanned and a scan could not be scheduled here; the next merge sweep will scan it')],
      headSha: head.sha,
    };
  }

  const step = await runStepForPullRequest(db, env, tenantId, pullRequestId);
  return step ? step.verdict : verdict;
}
