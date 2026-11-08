/**
 * pullRequestSecurityStep — the post-PR security step (PRD 08 §10), run once an agent has opened a
 * pull request and BEFORE any auto-merge decision:
 *
 *   0. read the PR's head commit from the provider       (every scan row is keyed on it)
 *   1. read the changed files once                       (prSecurityScan.collectChangedFiles)
 *   2. SAST + secret + SCA scan                          (prSecurityScan)        -> vulnerability_scans/_findings
 *   3. security review as the assigned security agent    (prSecurityReview)      -> findings, category SECURITY
 *   4. CRITICAL findings open incidents                  (criticalFindingIncidents)
 *   5. automated SOC 2 evidence - ONLY if all four scans completed untruncated   (governance/automatedSocEvidence)
 *   6. the merge verdict                                 (prSecurityGate -> evaluateSecurityGate)
 *
 * Returns the verdict the caller must honour. NEVER THROWS and FAILS CLOSED: if the step itself
 * breaks, or the head commit cannot be read, the verdict is a block whose reason says so - an
 * auto-merge must not proceed on the strength of a scan that did not happen. (A scan that ran but was
 * skipped, failed, truncated or timed out is also a block: that is `evaluateSecurityGate`'s rule, not
 * this function's, so every other caller of the gate applies it identically.)
 */
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { cloudAgentActor, SYSTEM_ACTOR, type ActorIdentity } from '../activity/activityLog';
import { recordAutomatedEvidence } from '../governance/automatedSocEvidence';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import type { RepoReadContext } from '../repos/readRepoContents';
import { resolveHeadSha } from '../repos/resolvePrHeadSha';
import { openIncidentsForCriticalFindings } from './criticalFindingIncidents';
import { loadGateInputs } from './prSecurityGate';
import { collectChangedFiles, runPullRequestScan } from './prSecurityScan';
import {
  evaluateSecurityGate, gateReason, incompleteScanReasons, pinVerdict, type GateReason, type PinnedVerdict,
} from './securityMergeGate';

export interface PullRequestSecurityStepArgs {
  tenantId: number;
  segmentId: string | null;
  pullRequestId: string;
  prNumber: number | null;
  prUrl: string | null;
  /** The agent run that opened the PR (executions.id), when there is one. */
  executionId: number | null;
  cloudAgentRef?: string;
  agentLabel: string;
  /** Provider read context for the PR branch (`ref` = the head branch). */
  read: RepoReadContext;
  base: string;
}

export interface PullRequestSecurityStepResult {
  /** Carries the head commit it was reached for: an allow always has one, and the merge pins to it. */
  verdict: PinnedVerdict;
  scanStatuses: Array<{ scanType: string; status: string }>;
  incidentsOpened: number;
}

const blocked = (reason: GateReason): PullRequestSecurityStepResult => ({
  verdict: { allow: false, reasons: [reason], headSha: null }, scanStatuses: [], incidentsOpened: 0,
});

export async function runPullRequestSecurityStep(
  env: Env, db: Db, args: PullRequestSecurityStepArgs,
): Promise<PullRequestSecurityStepResult> {
  const actor: ActorIdentity = args.cloudAgentRef ? cloudAgentActor(args.cloudAgentRef, args.agentLabel) : SYSTEM_ACTOR;
  try {
    const head = await resolveHeadSha(args.read, { number: args.prNumber, branch: args.read.ref });
    if (!head.ok) return blocked(gateReason('no_head', `the PR head commit could not be read (${head.reason}), so it was not scanned`, { detail: head.reason }));

    const repoRef = `${args.read.owner}/${args.read.repo}`;
    const scope = {
      tenantId: args.tenantId,
      segmentId: args.segmentId,
      pullRequestId: args.pullRequestId,
      executionId: args.executionId,
      repoRef,
      ref: args.read.ref,
      triggeredBy: args.cloudAgentRef ? `agent:${args.cloudAgentRef}` : 'system',
      headSha: head.sha,
    };
    // Read AT the verified commit, so the rows keyed on head.sha hold exactly that commit's results.
    const collected = await collectChangedFiles(args.read, args.base, head.sha);
    const scan = await runPullRequestScan(env, db, actor, scope, collected);
    // LOADED ON USE. The review pulls in the whole LLM gateway graph (SecurityReviewService ->
    // tenantProxy -> routing ...). Every module that can merge a PR imports this step, and none of
    // them should pay for - or be able to deadlock on - that graph at import time; it is only needed
    // on the one path that actually runs a review.
    const { runPullRequestSecurityReview } = await import('./prSecurityReview');
    const review = await runPullRequestSecurityReview(env, db, actor, scope, collected);

    const segmentId = scan.segmentId ?? review.segmentId ?? args.segmentId;
    const scanIds = [...scan.scans.map((s) => s.scanId), review.scanId];
    let incidentsOpened = 0;
    if (segmentId) {
      incidentsOpened = await openIncidentsForCriticalFindings(env, db, actor, {
        tenantId: args.tenantId, segmentId, where: args.prUrl, repoRef,
      }, scanIds);
    }

    // The verdict - and the SOC 2 evidence that rides on it - reads what was actually RECORDED.
    const inputs = await loadGateInputs(db, args.tenantId, args.pullRequestId, head.sha);
    const verdict = pinVerdict(evaluateSecurityGate(inputs), head.sha);
    if (incompleteScanReasons(inputs).length === 0) {
      const provenance = `run ${args.executionId ?? 'n/a'}; PR ${args.prUrl ?? `#${args.prNumber ?? '?'}`}; commit ${head.sha.slice(0, 12)}`;
      await recordAutomatedEvidence(env, db, {
        tenantId: args.tenantId, segmentId, kind: 'scan', sourceId: `${args.pullRequestId}@${head.sha}`, url: args.prUrl,
        note: `${provenance}; scans: ${scan.scans.map((s) => `${s.scanType}=${s.status}(${s.scanId})`).join(', ')}`,
      });
      await recordAutomatedEvidence(env, db, {
        tenantId: args.tenantId, segmentId, kind: 'review', sourceId: `${args.pullRequestId}@${head.sha}`, url: args.prUrl,
        note: `${provenance}; review=${review.status}(${review.scanId}), ${review.findings} finding(s)`,
      });
    }

    return {
      verdict,
      scanStatuses: [...scan.scans.map((s) => ({ scanType: s.scanType, status: s.status })), { scanType: 'REVIEW', status: review.status }],
      incidentsOpened,
    };
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/security/pullRequestSecurityStep.ts', operation: 'runPullRequestSecurityStep',
      context: { tenantId: args.tenantId, pullRequestId: args.pullRequestId },
    });
    return blocked(gateReason('step_failed', 'the security scan step failed to run, so this change was not verified'));
  }
}
