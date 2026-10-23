/**
 * The cloud run's FINISH GATES — what a `finish` must clear before the run may end.
 *
 * Split out of `cloudAgentEngine.ts`'s `onFinish` hook (which now calls this) so the
 * gates have one home and a NAMED verdict: the verifier cascade (cost PRD D1) needs to
 * know not just that a finish was refused but WHY — a red CI or a stub is the model's
 * failure and earns a stronger model; CI still running is nobody's failure and must not.
 *
 * In order, each yielding a block message that forces the agent to finish again once
 * it has corrected the run (null = ship):
 *   0. live delegated children (an owner never ends with children still working);
 *   1. the required reviewer verdict;
 *   2. the completeness self-review (no code deliverable — once);
 *   3. the changed-file source/config policy (`verifyWrittenFiles`);
 *   4. branch CI (red and pending block up to a cap);
 *   5. honesty (a claimed check that could not have run — once);
 *   6. anti-stub (placeholder code, up to a cap);
 *   7. a structural evidence record for the completion claim.
 *
 * The counters persist across durable ticks through {@link finishGateSnapshot}; a
 * counter kept loop-local resets every tick and its cap is never reached.
 */
import type { Db } from '../../../infrastructure/database/connection';
import type { TicketRepoContext } from '../../repos/commitFileAsPendingChange';
import { verifyWrittenFiles } from '../../repos/verifyWrittenFiles';
import { pollBranchCi, ciFinishDecision } from '../../ci/pollCommitCiStatus';
import { scanWrittenForPlaceholders } from '../../repos/scanForPlaceholders';
import { recordCodeCompletionClaim } from '../../provenance/finishClaimService';
import { MAX_PLACEHOLDER_FINISH_BLOCKS, assertsUnrunVerification, hasNoCodeDeliverable } from '../cloudAgentTools';
import { absorbChildWrites, liveChildrenFinishBlock } from '../cloudChildRuns';
import { recordCloudToolEvent } from '../cloudToolEvents';
import type { CloudRunRef } from './cloudRunModelPolicy';

export type RequiredReviewSignoff = { roleKey: string; laneKey?: string };

/** Accept evidence only for the exact accountability slot that caused this run. */
export function matchesRequiredReviewSignoff(
  required: RequiredReviewSignoff | undefined,
  toolName: string,
  args: Record<string, unknown>,
  succeeded: boolean,
): boolean {
  if (!required || !succeeded || toolName !== 'builtin_kanban_signoff') return false;
  const roleKey = typeof args.roleKey === 'string' ? args.roleKey.trim() : '';
  const laneKey = typeof args.laneKey === 'string' ? args.laneKey.trim() : undefined;
  return roleKey === required.roleKey && laneKey === required.laneKey;
}

export function missingReviewVerdictMessage(required: RequiredReviewSignoff): string {
  const lane = required.laneKey ? ` and laneKey='${required.laneKey}'` : '';
  return `Cannot finish this reviewer assignment until you call builtin_kanban_signoff with roleKey='${required.roleKey}'${lane} and an explicit approved or changes_requested verdict. A narrative summary is not acceptance evidence.`;
}

/** The gate counters a run carries. `ciVerified` / `finishBlockedOnce` are per tick, as they always were. */
export interface FinishGateState {
  noDeliverableBlocked: boolean;
  reviewVerdictRecorded: boolean;
  placeholderBlocks: number;
  ciPendingBlocks: number;
  ciFailureBlocks: number;
  ciVerified: boolean;
  finishBlockedOnce: boolean;
}

/** The persisted half of {@link FinishGateState} (fields of `CloudLoopState`). */
export type FinishGateSnapshot = Pick<FinishGateState, 'noDeliverableBlocked' | 'reviewVerdictRecorded' | 'placeholderBlocks' | 'ciPendingBlocks' | 'ciFailureBlocks'>;

/** Resume the counters, or start them. A sub-agent's deliverable gate starts spent: its
 *  OWNER is held to it for the whole tree. */
export function initialFinishGateState(resume: Partial<FinishGateSnapshot> | undefined, isChild: boolean): FinishGateState {
  return {
    noDeliverableBlocked: resume?.noDeliverableBlocked ?? isChild,
    reviewVerdictRecorded: resume?.reviewVerdictRecorded ?? false,
    placeholderBlocks: resume?.placeholderBlocks ?? 0,
    ciPendingBlocks: resume?.ciPendingBlocks ?? 0,
    ciFailureBlocks: resume?.ciFailureBlocks ?? 0,
    ciVerified: false,
    finishBlockedOnce: false,
  };
}

export function finishGateSnapshot(g: FinishGateState): FinishGateSnapshot {
  return {
    noDeliverableBlocked: g.noDeliverableBlocked,
    reviewVerdictRecorded: g.reviewVerdictRecorded,
    placeholderBlocks: g.placeholderBlocks,
    ciPendingBlocks: g.ciPendingBlocks,
    ciFailureBlocks: g.ciFailureBlocks,
  };
}

export type FinishBlockReason =
  | 'children_running' | 'review_verdict_missing' | 'no_deliverable' | 'source_quality'
  | 'branch_ci' | 'branch_ci_pending' | 'honesty' | 'placeholders' | 'claim_evidence';

export interface FinishGateVerdict {
  block: string | null;
  reason?: FinishBlockReason;
}

/** Blocks that are not the MODEL's failure — waiting on CI, or on its own children. */
export function isInconclusiveFinishBlock(reason: FinishBlockReason | undefined): boolean {
  return reason === 'branch_ci_pending' || reason === 'children_running';
}

export interface FinishGateArgs {
  db: Db;
  evt: CloudRunRef;
  repoCtx: TicketRepoContext | null;
  writtenPaths: Set<string>;
  requiredSignoff: RequiredReviewSignoff | undefined;
  /** The run is a node of a delegation tree (has children to wait for / absorb). */
  delegated: boolean;
  summary: string;
  output: string;
  gates: FinishGateState;
  /** The run just performed its verification action: move the policy into `verify`. */
  enterVerify: () => void;
}

const blocked = async (a: FinishGateArgs, reason: FinishBlockReason, block: string, detail: Record<string, unknown>, result: string): Promise<FinishGateVerdict> => {
  await recordCloudToolEvent(a.db, { ...a.evt, toolName: 'finish.blocked', category: 'tool', detail: { reason, ...detail }, result });
  return { block, reason };
};

/** Run every gate; the first that blocks wins. Validation is AUTOMATIC here: a model that
 *  rushes straight to `finish` cannot skip it. */
export async function evaluateFinishGates(a: FinishGateArgs): Promise<FinishGateVerdict> {
  const { db, evt, repoCtx, writtenPaths, requiredSignoff, summary, gates } = a;
  const { tenantId, executionId } = evt;
  if (a.delegated) {
    const childBlock = await liveChildrenFinishBlock(db, tenantId, executionId);
    if (childBlock) return { block: childBlock, reason: 'children_running' };
    // The children committed from their own runs; the pull request is the whole tree's.
    await absorbChildWrites(db, tenantId, executionId, repoCtx, writtenPaths);
  }
  const wrote = !!repoCtx && writtenPaths.size > 0;
  const verification = repoCtx && wrote ? await verifyWrittenFiles({ ...repoCtx, ref: repoCtx.branch }, writtenPaths) : null;
  // Branch CI is polled once static validation is clean; its decision is applied in
  // order below so a green/none result still falls through to honesty + anti-stub.
  let ci: ReturnType<typeof ciFinishDecision> | null = null;
  let ciPending = false;
  if (repoCtx && wrote && verification?.ok !== false) {
    ci = ciFinishDecision(await pollBranchCi(repoCtx), { pendingBlocks: gates.ciPendingBlocks, failureBlocks: gates.ciFailureBlocks });
    // A pending block is the one that spent a pending allowance.
    ciPending = ci.pendingBlocks > gates.ciPendingBlocks;
    gates.ciPendingBlocks = ci.pendingBlocks;
    gates.ciFailureBlocks = ci.failureBlocks;
    if (ci.ciVerified) gates.ciVerified = true;
  }
  // The run has just PERFORMED its verification action, so every turn a block below
  // forces is asked as `verify`. Idempotent, so a second blocked finish is a no-op.
  if (wrote) a.enterVerify();

  if (requiredSignoff && !gates.reviewVerdictRecorded) {
    const block = missingReviewVerdictMessage(requiredSignoff);
    return blocked(a, 'review_verdict_missing', block, { ...requiredSignoff }, block);
  }
  if (repoCtx && !gates.noDeliverableBlocked && hasNoCodeDeliverable(writtenPaths)) {
    // A code-bound run is finishing with NO code deliverable: block ONCE and make it
    // self-review the requirements. A legitimate no-op run finishes on the retry.
    gates.noDeliverableBlocked = true;
    return blocked(a, 'no_deliverable',
      'Before finishing: you have not committed any code changes for this task — only the PRD (or nothing) is on the branch. Re-read the task requirements and verify EACH is actually implemented. If work remains, use search_code/read_file to find the right place and write_file to implement it, then finish. If — and only if — this task genuinely requires no code change, call finish again and state explicitly why no change was needed.',
      {}, 'Blocked finish: no code deliverable — self-review required');
  }
  if (verification && !verification.ok) {
    const block =
      `Cannot finish — changed-file validation found ${verification.errors.length} issue(s). `
      + 'Repair every issue, then finish again. This is a shell-free source policy, not a claim that the full project type-check ran.\n'
      + verification.errors.map((e) => `- ${e.path}${e.line ? `:${e.line}` : ''}${e.ruleId ? ` [${e.ruleId}]` : ''}: ${e.message}`).join('\n');
    return blocked(a, 'source_quality', block, { errors: verification.errors }, `Blocked finish: ${verification.errors.length} source/config quality issue(s)`);
  }
  if (ci?.block) {
    // Branch commit status / check-runs are this executor's build/type-check/test.
    const v = await blocked(a, 'branch_ci', ci.block, { pendingBlocks: gates.ciPendingBlocks, failureBlocks: gates.ciFailureBlocks }, ci.block.slice(0, 300));
    return ciPending ? { ...v, reason: 'branch_ci_pending' } : v;
  }
  if (summary && !gates.finishBlockedOnce && !gates.ciVerified && assertsUnrunVerification(summary)) {
    // The summary claims a check passed, but nothing was (or could be) run. Block once.
    gates.finishBlockedOnce = true;
    return {
      block: 'You stated that a build/type-check/lint/test passed or is resolved, but this executor cannot run a local shell and in-run CI did not report success. Call run_checks (it polls branch CI) or finish again with a summary that does NOT claim a check passed.',
      reason: 'honesty',
    };
  }
  if (repoCtx && wrote && gates.placeholderBlocks < MAX_PLACEHOLDER_FINISH_BLOCKS) {
    // Refuse to ship placeholder/scaffold code: implement it for real or delete it.
    const scan = await scanWrittenForPlaceholders({ ...repoCtx, ref: repoCtx.branch }, writtenPaths);
    if (scan.flagged.length) {
      gates.placeholderBlocks += 1;
      return blocked(a, 'placeholders',
        `Cannot finish — ${scan.flagged.length} committed file(s) still contain placeholder/stub code instead of a real implementation. `
        + 'Replace each stub with a working implementation that uses the existing infrastructure (search_code for it first), or if a file is dead code that should not ship in this PR, remove it with delete_file. Then call finish again.\n'
        + scan.flagged.map((f) => `- ${f.path}: ${f.markers.join('; ')}`).join('\n'),
        { files: scan.flagged }, `Blocked finish: ${scan.flagged.map((f) => f.path).join(', ')}`);
    }
  }
  if (wrote) {
    const claim = await recordCodeCompletionClaim(db, {
      tenantId, executionId,
      statement: summary || a.output || `Completed changes to ${[...writtenPaths].join(', ')}`,
    });
    if (!claim.ok) {
      return { block: `Cannot finish — no structural evidence record supports this completion claim (${claim.error}). Retry the successful write or verification, then finish again.`, reason: 'claim_evidence' };
    }
  }
  return { block: null };
}
