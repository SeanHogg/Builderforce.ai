/**
 * cloudFinalizeSecurity - the security-gate wiring of `finalizeCloudRun` (PRD 08 §10), kept out of
 * `cloudFinalize.ts` so that file stays the landing sequence and not a second home for the gate.
 *
 * FAILS CLOSED: the verdict starts as a BLOCK and only the security step, run on a RECORDED pull request,
 * can change it. So a PR that failed to open (`pr.ok === false`), or that could not be recorded, can never
 * reach `mergeBranchToBase`: there is no verdict to merge on.
 */
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { TicketRepoContext } from '../repos/commitFileAsPendingChange';
import { describeSecurityBlock } from '../security/prSecurityGate';
import { runPullRequestSecurityStep } from '../security/pullRequestSecurityStep';
import { gateReason, type PinnedVerdict } from '../security/securityMergeGate';
import { recordCloudToolEvent } from './cloudToolEvents';

export interface RunGateArgs {
  tenantId: number;
  cloudAgentRef: string | undefined;
  executionId: number;
  agentLabel: string;
  repoCtx: TicketRepoContext;
  /** The PR create result: only an opened PR (`ok`) can be scanned. */
  pr: { ok: true; number: number; url: string } | { ok: false };
  /** The recorded `pull_requests` row the scans link to; null when it could not be recorded. */
  prRowId: string | null;
}

/** Run the post-PR security step for a finished run and journal its outcome. Never throws. */
export async function gateRunPullRequest(env: Env, db: Db, a: RunGateArgs): Promise<PinnedVerdict> {
  if (!a.pr.ok || !a.prRowId) {
    return { allow: false, reasons: [gateReason('no_pr_row', 'no PR row: the pull request was not opened or recorded, so nothing was scanned')], headSha: null };
  }
  const { repoCtx } = a;
  const step = await runPullRequestSecurityStep(env, db, {
    tenantId: a.tenantId, segmentId: repoCtx.segmentId, pullRequestId: a.prRowId, prNumber: a.pr.number, prUrl: a.pr.url,
    executionId: a.executionId, cloudAgentRef: a.cloudAgentRef, agentLabel: a.agentLabel,
    read: { provider: repoCtx.provider, host: repoCtx.host, owner: repoCtx.owner, repo: repoCtx.repo, token: repoCtx.token, ref: repoCtx.branch },
    base: repoCtx.base,
  });
  await recordCloudToolEvent(db, {
    tenantId: a.tenantId, cloudAgentRef: a.cloudAgentRef, executionId: a.executionId,
    toolName: 'security_scan', category: 'tool',
    detail: { scans: step.scanStatuses, incidentsOpened: step.incidentsOpened },
    result: (step.verdict.allow ? 'no open blocking security findings' : describeSecurityBlock(step.verdict)).slice(0, 300),
  });
  return step.verdict;
}

/** An immediate auto-merge held by the gate: journal it and return the note for the run summary. */
export async function recordMergeHeld(
  db: Db, a: Pick<RunGateArgs, 'tenantId' | 'cloudAgentRef' | 'executionId' | 'repoCtx'>,
  verdict: Extract<PinnedVerdict, { allow: false }>,
): Promise<string> {
  await recordCloudToolEvent(db, {
    tenantId: a.tenantId, cloudAgentRef: a.cloudAgentRef, executionId: a.executionId,
    toolName: 'merge_blocked_security', category: 'tool',
    detail: { base: a.repoCtx.base, head: a.repoCtx.branch, reasons: verdict.reasons },
    result: describeSecurityBlock(verdict).slice(0, 300),
  });
  return ` - NOT auto-merged: ${describeSecurityBlock(verdict)}`;
}
