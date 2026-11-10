import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * runRevert — a human undoes a COMPLETED cloud run (`runRollback.ts` holds the snapshot this
 * reads and the shared event emitter; `runBranchTeardown.ts` the shared evidence gathering).
 *
 * {@link revertRun} closes the PR and deletes the branch, if and only if the shared decision
 * proves it safe. If the run's PR already MERGED there is nothing on a branch left to undo,
 * so it escalates to {@link revertMergedWork}, which opens a pull request reversing the
 * merge — never a force-push and never a direct write to the base branch.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { executionRollbacks, executions, tasks } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { closePullRequest, deleteBranch } from '../repos/branchLifecycle';
import { revertMergedPullRequest, revertBranchName } from '../repos/revertMergedPullRequest';
import { markPullRequestClosedById } from '../repos/recordPullRequestRow';
import { resolveTicketRepoContext, type TicketRepoContext } from '../repos/commitFileAsPendingChange';
import type { ActorIdentity } from '../activity/activityLog';
import type { TeardownRefusal } from './branchTeardownDecision';
import { emitRollbackEvent, type RollbackEventBase, type RunRollbackUndoPayload } from './runRollback';
import { gatherTeardownFacts } from './runBranchTeardown';

export type RevertOutcome =
  /** The work was still on a branch: PR closed (if open) and branch deleted. */
  | { reverted: true; mode: 'branch_delete'; branch: string; branchDeleted: boolean; prClosed: boolean; commits: number }
  /** The work had MERGED: a revert pull request now reverses it on the base. This
   *  is a proposal, not a completed undo — the base is unchanged until a human
   *  merges the revert PR, which is exactly the intended shape (see
   *  {@link revertMergedPullRequest}: never a force-push, never a push to base). */
  | {
      reverted: true; mode: 'revert_pr'; branch: string; branchDeleted: false; prClosed: false;
      commits: number; revertPrNumber: number; revertPrUrl: string;
    }
  | { reverted: false; refusal: TeardownRefusal | 'no_snapshot' | 'execution_gone' | 'already_reverted' | 'repo_unresolved' | 'delete_failed' | 'pr_close_failed' | 'merge_revert_failed'; reason: string };

/**
 * Revert a completed run: close the PR it opened and delete the branch it wrote.
 *
 * REFUSES — loudly, with the reason returned to the caller — when the world moved
 * underneath the run: the PR was merged, the branch advanced past what the run
 * recorded, foreign commits or foreign paths appeared, the evidence is unreadable,
 * or the provider cannot support the operation. A revert that silently discarded
 * someone else's work would be worse than having no revert at all.
 */
export async function revertRun(
  env: Env | undefined,
  db: Db,
  args: { tenantId: number; executionId: number; actor: ActorIdentity; secret: string },
): Promise<RevertOutcome> {
  const [snapshot] = await db
    .select()
    .from(executionRollbacks)
    .where(and(eq(executionRollbacks.executionId, args.executionId), eq(executionRollbacks.tenantId, args.tenantId)))
    .orderBy(desc(executionRollbacks.createdAt))
    .limit(1);

  if (!snapshot) {
    return { reverted: false, refusal: 'no_snapshot', reason: 'This run recorded no repository changes, so there is nothing to revert.' };
  }
  if (snapshot.status !== 'active') {
    return { reverted: false, refusal: 'already_reverted', reason: `This run has already been ${snapshot.status === 'torn_down' ? 'torn down' : 'reverted'}.` };
  }
  // Mirrors the contributor-merge rule: refuse when a participant is gone rather
  // than acting on a half-known world.
  if (snapshot.executionId == null || snapshot.taskId == null) {
    return { reverted: false, refusal: 'execution_gone', reason: 'Cannot revert: the run or its ticket was deleted.' };
  }

  const [execution] = await db
    .select({ status: executions.status, cloudAgentRef: executions.cloudAgentRef })
    .from(executions)
    .where(and(eq(executions.id, args.executionId), eq(executions.tenantId, args.tenantId)))
    .limit(1);
  if (!execution) {
    return { reverted: false, refusal: 'execution_gone', reason: 'Cannot revert: the run no longer exists.' };
  }

  const payload = (snapshot.undoPayload ?? null) as RunRollbackUndoPayload | null;
  if (!payload) {
    return { reverted: false, refusal: 'no_snapshot', reason: 'The rollback record is missing its undo payload.' };
  }

  const resolved = await resolveTicketRepoContext(db, args.secret, args.tenantId, snapshot.taskId);
  if (!resolved.ok) {
    return { reverted: false, refusal: 'repo_unresolved', reason: `Cannot reach the repository: ${resolved.reason}` };
  }
  // Act on the SNAPSHOTTED branch/base, not on whatever the task points at now —
  // a re-run may have re-pinned `tasks.gitBranch` since. Only the credential and
  // addressing come from the live resolution.
  const repoCtx: TicketRepoContext = {
    ...resolved.ctx,
    branch: snapshot.branchName ?? resolved.ctx.branch,
    base: snapshot.baseBranch ?? resolved.ctx.base,
  };

  const { decision, prRow } = await gatherTeardownFacts(db, {
    mode: 'revert',
    tenantId: args.tenantId,
    taskId: snapshot.taskId,
    executionId: args.executionId,
    repoCtx,
    writtenPaths: payload.writtenPaths,
    commitShas: payload.commitShas,
  });

  const eventBase = {
    tenantId: args.tenantId, segmentId: snapshot.segmentId, projectId: snapshot.projectId,
    taskId: snapshot.taskId, executionId: args.executionId,
    cloudAgentRef: execution.cloudAgentRef ?? undefined,
    actor: args.actor, verb: 'run.revert' as const,
  };

  if (!decision.safe) {
    // A MERGED pull request is not the end of the story any more. Deleting the
    // branch would not undo work that is already on the base, so escalate to the
    // one path that can: open a pull request that reverses the merge. Every other
    // refusal still stands — this is the single exception, and only because the
    // escalation is itself non-destructive (a PR against base, never a push to it).
    if (decision.refusal === 'pull_request_merged' && prRow?.number != null) {
      return revertMergedWork(env, db, {
        rollbackId: snapshot.id, taskId: snapshot.taskId, repoCtx,
        prNumber: prRow.number, eventBase,
      });
    }
    await db.update(executionRollbacks)
      .set({ refusalCode: decision.refusal, refusalReason: decision.reason })
      .where(scopedToTenant(executionRollbacks, args.tenantId, eq(executionRollbacks.id, snapshot.id)))
      .catch((error) => reportCaughtError(error, { source: "application/runtime/runRevert.ts", operation: "revertRun", context: { logMessage: '[run-rollback] refusal persistence failed', details: { tenantId: args.tenantId, executionId: args.executionId, rollbackId: snapshot.id, error } } }));
    await emitRollbackEvent(env, db, {
      ...eventBase,
      outcome: `Revert refused — ${decision.reason}`,
      detail: { branch: repoCtx.branch, refusal: decision.refusal, reason: decision.reason },
    });
    return { reverted: false, refusal: decision.refusal, reason: decision.reason };
  }

  // Close the PR FIRST. Deleting the branch out from under an open PR would leave
  // a dangling review on a vanished ref; if the close fails we stop and change
  // nothing, so the run stays revertable once the cause is fixed.
  let prClosed = false;
  if (decision.closePrNumber != null) {
    const closed = await closePullRequest({
      provider: repoCtx.provider, host: repoCtx.host, owner: repoCtx.owner,
      repo: repoCtx.repo, token: repoCtx.token, number: decision.closePrNumber,
    });
    if (!closed.ok) {
      // The recorded row said "open" but the provider says it merged in the
      // meantime — same situation as the decision-level refusal above, so take
      // the same escalation rather than reporting a dead end.
      if (closed.code === 'already_merged') {
        return revertMergedWork(env, db, {
          rollbackId: snapshot.id, taskId: snapshot.taskId, repoCtx,
          prNumber: decision.closePrNumber, eventBase,
        });
      }
      const refusal = 'pr_close_failed';
      await emitRollbackEvent(env, db, {
        ...eventBase,
        outcome: `Revert refused — could not close pull request #${decision.closePrNumber}: ${closed.reason}`,
        detail: { pr: decision.closePrNumber, code: closed.code, reason: closed.reason },
      });
      return { reverted: false, refusal, reason: closed.reason };
    }
    prClosed = true;
    if (prRow) await markPullRequestClosedById(db, prRow.id, args.tenantId)
      .catch((error) => reportCaughtError(error, { source: "application/runtime/runRevert.ts", operation: "revertRun", context: { logMessage: '[run-rollback] PR close persistence failed', details: { tenantId: args.tenantId, executionId: args.executionId, prId: prRow.id, error } } }));
  }

  const del = await deleteBranch({
    provider: repoCtx.provider, host: repoCtx.host, owner: repoCtx.owner,
    repo: repoCtx.repo, token: repoCtx.token, branch: decision.branch,
  });
  if (!del.ok) {
    // The PR is already closed at this point; report the partial state honestly
    // rather than claiming a clean revert.
    await emitRollbackEvent(env, db, {
      ...eventBase,
      outcome: `Revert incomplete — pull request closed but branch \`${decision.branch}\` could not be deleted: ${del.reason}`,
      detail: { branch: decision.branch, prClosed, code: del.code, reason: del.reason },
    });
    return { reverted: false, refusal: 'delete_failed', reason: del.reason };
  }

  await db.update(executionRollbacks)
    .set({
      status: 'reverted',
      revertedAt: new Date(),
      revertedByUserId: args.actor.ref,
      refusalCode: null,
      refusalReason: null,
    })
    .where(scopedToTenant(executionRollbacks, args.tenantId, eq(executionRollbacks.id, snapshot.id)));

  await db.update(tasks)
    .set({ gitBranch: null, githubPrUrl: null, githubPrNumber: null, updatedAt: new Date() })
    .where(scopedToTenant(tasks, args.tenantId, eq(tasks.id, snapshot.taskId)))
    .catch((error) => reportCaughtError(error, { source: "application/runtime/runRevert.ts", operation: "revertRun", context: { logMessage: '[run-rollback] reverted task metadata reset failed', details: { tenantId: args.tenantId, executionId: args.executionId, taskId: snapshot.taskId, error } } }));

  await emitRollbackEvent(env, db, {
    ...eventBase,
    outcome: `Reverted run — ${prClosed ? `closed PR #${decision.closePrNumber}, ` : ''}deleted branch \`${decision.branch}\` (${decision.commits.length} commit(s), ${payload.writtenPaths.length} file(s))`,
    detail: {
      branch: decision.branch, prClosed, pr: decision.closePrNumber,
      commits: decision.commits.map((c) => c.sha.slice(0, 7)), paths: payload.writtenPaths,
    },
  });

  return { reverted: true, mode: 'branch_delete', branch: decision.branch, branchDeleted: del.deleted, prClosed, commits: decision.commits.length };
}

/**
 * The merged-PR escalation: open a pull request that reverses the merge on the
 * base branch. Reached only from {@link revertRun}, and only for the
 * `pull_request_merged` case — every other refusal stays a refusal.
 *
 * The run's own branch is deliberately LEFT ALONE here. Its commits are on the base
 * now, so deleting it neither undoes them nor is provably safe, and the revert PR
 * (not a branch sweep) is the thing that carries the undo.
 *
 * The rollback row moves to `revert_pr` rather than `reverted`: nothing is undone
 * until a human merges that PR, and claiming otherwise would be the silent
 * dishonesty this whole subsystem is built to avoid. A provider that cannot do it
 * (Bitbucket) comes back as a structured refusal recorded on both channels.
 */
async function revertMergedWork(
  env: Env | undefined,
  db: Db,
  args: {
    rollbackId: string;
    taskId: number;
    repoCtx: TicketRepoContext;
    prNumber: number;
    eventBase: RollbackEventBase;
  },
): Promise<RevertOutcome> {
  const { repoCtx, prNumber } = args;
  const revertBranch = revertBranchName(args.taskId, prNumber);

  const result = await revertMergedPullRequest({
    provider: repoCtx.provider, host: repoCtx.host, owner: repoCtx.owner,
    repo: repoCtx.repo, token: repoCtx.token,
    number: prNumber,
    base: repoCtx.base,
    revertBranch,
    title: `Revert task #${args.taskId} (pull request #${prNumber})`,
    body:
      `Reverses the merge of pull request #${prNumber} for task #${args.taskId}.\n\n`
      + 'Opened by BuilderForce because the run this reverts had already merged, so its '
      + `commits are on \`${repoCtx.base}\`. Merging this pull request completes the revert; `
      + 'nothing has been undone until then.',
  });

  if (!result.ok) {
    // `unsupported` keeps the original, accurate refusal — the merge is still on
    // the base and this provider has no way to reverse it for us.
    const refusal = result.code === 'unsupported' ? 'pull_request_merged' : 'merge_revert_failed';
    await db.update(executionRollbacks)
      .set({ refusalCode: refusal, refusalReason: result.reason })
      .where(scopedToTenant(executionRollbacks, args.eventBase.tenantId, eq(executionRollbacks.id, args.rollbackId)))
      .catch((error) => reportCaughtError(error, { source: "application/runtime/runRevert.ts", operation: "revertMergedWork", context: { logMessage: '[run-rollback] merged-refusal persistence failed', details: { tenantId: args.eventBase.tenantId, rollbackId: args.rollbackId, error } } }));
    await emitRollbackEvent(env, db, {
      ...args.eventBase,
      outcome: `Revert refused — pull request #${prNumber} is merged and could not be reversed: ${result.reason}`,
      detail: { pr: prNumber, base: repoCtx.base, code: result.code, reason: result.reason },
    });
    return { reverted: false, refusal, reason: result.reason };
  }

  await db.update(executionRollbacks)
    .set({ status: 'revert_pr', refusalCode: null, refusalReason: null })
    .where(scopedToTenant(executionRollbacks, args.eventBase.tenantId, eq(executionRollbacks.id, args.rollbackId)))
    .catch((error) => reportCaughtError(error, { source: "application/runtime/runRevert.ts", operation: "revertMergedWork", context: { logMessage: '[run-rollback] revert-PR status persistence failed', details: { tenantId: args.eventBase.tenantId, rollbackId: args.rollbackId, error } } }));

  await emitRollbackEvent(env, db, {
    ...args.eventBase,
    outcome: `Opened revert pull request #${result.number} against \`${repoCtx.base}\` — reverses merged pull request #${prNumber} (merge ${result.revertedSha.slice(0, 7)})`,
    detail: {
      revertPr: result.number, revertPrUrl: result.url, revertBranch: result.branch,
      revertedSha: result.revertedSha, mergedPr: prNumber, base: repoCtx.base,
    },
  });

  return {
    reverted: true, mode: 'revert_pr', branch: result.branch,
    branchDeleted: false, prClosed: false,
    commits: 0,
    revertPrNumber: result.number, revertPrUrl: result.url,
  };
}
