/**
 * The cloud run's FINISH GATES — a COMPOSITION, with no policy of its own (PRD 35 WS3).
 *
 * What a `finish` must clear (live children, the reviewer verdict, the completeness self-review,
 * the changed-file source policy, branch CI, honesty, anti-stub, the structural completion claim)
 * is the one agent's (`@builderforce/agent-run` `policy/finish`), and so are the counters a durable
 * run carries between ticks. This module is what the CLOUD brings to it: the couplings the gates
 * need, built from the cloud's own dependencies (the repo, the CI poll, the placeholder scan, the
 * claim ledger, the child runs, the timeline) — {@link cloudFinishPorts} — and the same-signature
 * entry the cloud's call sites and tests have always used, which runs the agent's gates through them.
 */
import {
  finishGateSnapshot, initialFinishGateState, isInconclusiveFinishBlock,
  matchesRequiredReviewSignoff, missingReviewVerdictMessage,
  type FinishBlockReason, type FinishGatePorts, type FinishGateSnapshot, type RequiredReviewSignoff,
} from '@builderforce/agent-run';
import type { FinishGateState } from '@builderforce/agent-run';
import type { Db } from '../../../infrastructure/database/connection';
import type { TicketRepoContext } from '../../repos/commitFileAsPendingChange';
import { verifyWrittenFiles } from '../../repos/verifyWrittenFiles';
import { createRepoReadMemo, type RepoFileReader } from '../../repos/repoReadMemo';
import type { WrittenFileHashes } from './writtenFileHashes';
import { pollBranchCi, ciFinishDecision } from '../../ci/pollCommitCiStatus';
import { scanWrittenForPlaceholders } from '../../repos/scanForPlaceholders';
import { recordCodeCompletionClaim } from '../../provenance/finishClaimService';
import { absorbChildWrites, liveChildrenFinishBlock } from '../cloudChildRuns';
import { recordCloudToolEvent } from '../cloudToolEvents';

/** Whose run the gates' timeline rows belong to. */
interface CloudRunEvt { tenantId: number; cloudAgentRef?: string; executionId: number }

export {
  finishGateSnapshot, initialFinishGateState, isInconclusiveFinishBlock, matchesRequiredReviewSignoff, missingReviewVerdictMessage,
};
export type { FinishBlockReason, FinishGateSnapshot, FinishGateState, RequiredReviewSignoff };

/** The couplings the agent's finish gates need, from the cloud's dependencies. */
export function cloudFinishPorts(a: {
  db: Db; evt: CloudRunEvt; repoCtx: TicketRepoContext | null; delegated: boolean;
  /** The run's per-file content hashes; a path a child rewrote is re-hashed from the branch. */
  writtenHashes?: WrittenFileHashes;
}): FinishGatePorts & { delegated: boolean } {
  const { db, evt, repoCtx } = a;
  const branch = repoCtx ? { ...repoCtx, ref: repoCtx.branch } : null;
  // One read per path for THIS attempt, shared by the child-write re-hash and the static validation (a later
  // attempt builds its own: the model edits between attempts).
  let branchRead: RepoFileReader | undefined;
  return {
    delegated: a.delegated,
    bound: repoCtx !== null,
    beginAttempt: () => { branchRead = branch ? createRepoReadMemo(branch) : undefined; },
    ...(branch && repoCtx ? {
      verify: (paths: readonly string[]) => verifyWrittenFiles(branch, new Set(paths), branchRead),
      pollBranchCi: async (counters: { pendingBlocks: number; failureBlocks: number }) => ciFinishDecision(await pollBranchCi(repoCtx), counters),
      scanPlaceholders: (paths: readonly string[]) => scanWrittenForPlaceholders(branch, new Set(paths)),
    } : {}),
    liveChildren: () => liveChildrenFinishBlock(db, evt.tenantId, evt.executionId),
    absorbChildWrites: (paths: Set<string>) => absorbChildWrites(db, evt.tenantId, evt.executionId, repoCtx, paths, a.writtenHashes, branchRead),
    recordClaim: (statement: string) => recordCodeCompletionClaim(db, { tenantId: evt.tenantId, executionId: evt.executionId, statement }),
    onBlocked: async (reason, _block, detail, result) => {
      await recordCloudToolEvent(db, { ...evt, toolName: 'finish.blocked', category: 'tool', detail: { reason, ...detail }, result });
    },
  };
}
