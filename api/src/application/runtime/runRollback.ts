/**
 * runRollback — the undo story for an autonomous cloud run.
 *
 * A cloud run's only durable artifacts are git artifacts: a `builderforce/task-<id>`
 * branch it commits to as it goes, and (on success) a pull request. Before this
 * module a failed or cancelled run left both behind forever, and a completed run
 * could not be undone at all.
 *
 * Three entry points, ONE rulebook:
 *   • {@link recordRunRollbackSnapshot} — at finalize, snapshot what the run changed
 *     (branch/base, written paths, commit shas, PR) into `execution_rollbacks`.
 *   • {@link teardownRunBranch} — a run ended failed/cancelled with no PR: sweep the
 *     branch, if and only if it is provably safe to.
 *   • {@link revertRun} — a human undoes a completed run: close the PR and delete
 *     the branch, if and only if it is provably safe to. If the run's PR already
 *     MERGED there is nothing on a branch left to undo, so this escalates to
 *     {@link revertMergedWork}, which opens a pull request reversing the merge —
 *     never a force-push and never a direct write to the base branch.
 *
 * Both destructive paths gather evidence with {@link gatherTeardownFacts} and hand
 * it to the SINGLE pure decision function {@link decideBranchTeardown}. The safety
 * rules exist in exactly one place; neither path is allowed its own copy.
 *
 * Everything here is best-effort on the TELEMETRY and hard-refusing on the ACTION:
 * a failure to record an audit row never blocks, and a failure to prove safety
 * always blocks.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { executionRollbacks, executions, pullRequests, tasks } from '../../infrastructure/database/schema';
import {
  closePullRequest, deleteBranch, listBranchCommits,
  type ListBranchCommitsResult,
} from '../repos/branchLifecycle';
import { revertMergedPullRequest, revertBranchName } from '../repos/revertMergedPullRequest';
import { listBranchDiff } from '../repos/readRepoContents';
import { markPullRequestClosedById } from '../repos/recordPullRequestRow';
import { resolveTicketRepoContext, type TicketRepoContext } from '../repos/commitFileAsPendingChange';
import { recordActivity, cloudAgentActor, type ActorIdentity } from '../activity/activityLog';
import { recordCloudToolEvent } from './cloudToolEvents';
import {
  decideBranchTeardown, runCommitMarker,
  type TeardownDecision, type TeardownMode, type TeardownRefusal,
} from './branchTeardownDecision';

/** What a run recorded about its own repository side-effects. */
export interface RunRollbackUndoPayload {
  /** Every path the run wrote — `CloudLoopState.writtenPaths`. */
  writtenPaths: string[];
  /** Commit shas the branch carried when the run finished, when observable. */
  commitShas: string[];
  /** The PR the run opened, if any. */
  prNumber: number | null;
  prUrl: string | null;
  /** Repo addressing, snapshotted so a revert does not depend on the task's
   *  current binding still pointing at the same repo. */
  owner: string;
  repo: string;
  host: string | null;
  /** The label the run reported under — carried into the activity summary. */
  agentLabel: string | null;
}

// ── snapshot ──────────────────────────────────────────────────────────────────

/**
 * Snapshot a finished run's repository side-effects so it can be reverted later.
 * Called from the single cloud finalize chokepoint. Best-effort: a missing snapshot
 * only means the run is not revertable, which is exactly the pre-existing behaviour
 * and never a reason to fail the run.
 */
export async function recordRunRollbackSnapshot(
  db: Db,
  args: {
    tenantId: number;
    executionId: number;
    taskId: number;
    repoCtx: TicketRepoContext;
    writtenPaths: string[];
    prNumber: number | null;
    prUrl: string | null;
    prRowId: string | null;
    agentLabel: string;
  },
): Promise<string | null> {
  if (args.writtenPaths.length === 0) return null;
  try {
    // Capture the branch's commit shas now, while we know they are exactly the
    // run's. This is what later lets a revert prove the branch has not moved.
    const listed = await listBranchCommits({
      provider: args.repoCtx.provider, host: args.repoCtx.host, owner: args.repoCtx.owner,
      repo: args.repoCtx.repo, token: args.repoCtx.token,
      base: args.repoCtx.base, branch: args.repoCtx.branch,
    }).catch(() => null);
    const commitShas = listed?.ok && !listed.truncated ? listed.commits.map((c) => c.sha).filter(Boolean) : [];

    const payload: RunRollbackUndoPayload = {
      writtenPaths: args.writtenPaths,
      commitShas,
      prNumber: args.prNumber,
      prUrl: args.prUrl,
      owner: args.repoCtx.owner,
      repo: args.repoCtx.repo,
      host: args.repoCtx.host,
      agentLabel: args.agentLabel,
    };
    const [row] = await db.insert(executionRollbacks).values({
      tenantId: args.tenantId,
      segmentId: args.repoCtx.segmentId,
      projectId: args.repoCtx.projectId,
      taskId: args.taskId,
      executionId: args.executionId,
      repoId: args.repoCtx.repoId,
      provider: args.repoCtx.provider,
      branchName: args.repoCtx.branch,
      baseBranch: args.repoCtx.base,
      prRowId: args.prRowId,
      undoPayload: payload,
      status: 'active',
    }).returning({ id: executionRollbacks.id });
    return row?.id ?? null;
  } catch {
    return null; // best-effort — never break a finalize over the undo log
  }
}

// ── evidence gathering (shared by both destructive paths) ─────────────────────

/**
 * Gather the facts {@link decideBranchTeardown} needs and return its verdict.
 * The ONLY route to a destructive action in this module — neither caller is
 * permitted to assemble its own facts or apply its own rules.
 */
export async function gatherTeardownFacts(
  db: Db,
  args: {
    mode: TeardownMode;
    tenantId: number;
    taskId: number;
    repoCtx: TicketRepoContext;
    writtenPaths: string[];
    commitShas: string[];
  },
): Promise<{ decision: TeardownDecision; prRow: { id: string; number: number | null; status: string } | null }> {
  const { repoCtx } = args;
  const target = {
    provider: repoCtx.provider, host: repoCtx.host, owner: repoCtx.owner,
    repo: repoCtx.repo, token: repoCtx.token,
  };

  // The PR recorded for this task, newest first — including merged/closed ones,
  // because "already merged" is itself a refusal condition and must be visible.
  const [prRow] = await db
    .select({ id: pullRequests.id, number: pullRequests.number, status: pullRequests.status })
    .from(pullRequests)
    .where(and(eq(pullRequests.tenantId, args.tenantId), eq(pullRequests.taskId, args.taskId)))
    .orderBy(desc(pullRequests.createdAt))
    .limit(1);

  const commits: ListBranchCommitsResult = await listBranchCommits({
    ...target, base: repoCtx.base, branch: repoCtx.branch,
  }).catch((e: unknown) => ({
    ok: false as const,
    code: 'provider_error' as const,
    reason: e instanceof Error ? e.message : 'commit listing threw',
  }));

  // The file-level diff is only consulted by the revert rules, so don't pay for it
  // on the automatic teardown sweep (which runs on every failed run).
  let changedPaths: string[] | null = null;
  if (args.mode === 'revert') {
    const diff = await listBranchDiff({ ...target, ref: repoCtx.branch }, repoCtx.base, repoCtx.branch).catch(() => null);
    changedPaths = diff?.ok && !diff.truncated ? diff.files.map((f) => f.path) : null;
  }

  const decision = decideBranchTeardown({
    mode: args.mode,
    branch: repoCtx.branch,
    defaultBranch: repoCtx.base,
    commits,
    pullRequest: prRow ? { number: prRow.number, status: prRow.status } : null,
    changedPaths,
    run: { writtenPaths: args.writtenPaths, commitShas: args.commitShas },
    runCommitMarker: runCommitMarker(args.taskId),
  });

  return { decision, prRow: prRow ?? null };
}

// ── observability ─────────────────────────────────────────────────────────────

/** Emit BOTH channels for a teardown/revert outcome: the tool-audit timeline (so
 *  it appears beside the run's other tool events) and `activity_log` (so it is in
 *  the tenant's one audit store — cloud runs historically wrote almost nothing
 *  there, and a destructive action is the last thing that should be invisible). */
interface RollbackEventBase {
  tenantId: number;
  segmentId: string | null;
  projectId: number | null;
  taskId: number;
  executionId: number;
  cloudAgentRef?: string;
  actor: ActorIdentity;
  verb: 'run.teardown' | 'run.revert';
}

async function emitRollbackEvent(
  env: Env | undefined,
  db: Db,
  args: RollbackEventBase & { outcome: string; detail: Record<string, unknown> },
): Promise<void> {
  await recordCloudToolEvent(db, {
    tenantId: args.tenantId,
    cloudAgentRef: args.cloudAgentRef,
    executionId: args.executionId,
    toolName: args.verb,
    category: 'tool',
    detail: args.detail,
    result: args.outcome.slice(0, 300),
  });
  await recordActivity(env, db, {
    tenantId: args.tenantId,
    segmentId: args.segmentId,
    projectId: args.projectId,
    actor: args.actor,
    verb: args.verb,
    targetType: 'execution',
    targetId: args.executionId,
    targetLabel: `task #${args.taskId}`,
    summary: args.outcome.slice(0, 500),
    metadata: args.detail,
  });
}

// ── 1. terminal-state teardown ────────────────────────────────────────────────

export type TeardownOutcome =
  | { deleted: true; branch: string; commits: number }
  | { deleted: false; refusal: TeardownRefusal | 'delete_failed'; reason: string };

/**
 * Sweep the ticket branch of a run that ended FAILED or CANCELLED without opening
 * a PR. Called from the cloud finalize chokepoint.
 *
 * This is the conservative path by design: it deletes only when
 * {@link decideBranchTeardown} can prove the branch is nothing but this run's
 * abandoned output. Every other outcome leaves the branch in place and records
 * WHY, because residue is recoverable and a wrong delete is not.
 */
export async function teardownRunBranch(
  env: Env | undefined,
  db: Db,
  args: {
    tenantId: number;
    executionId: number;
    taskId: number;
    repoCtx: TicketRepoContext;
    writtenPaths: string[];
    cloudAgentRef?: string;
    agentLabel: string;
  },
): Promise<TeardownOutcome> {
  const { repoCtx } = args;
  const { decision } = await gatherTeardownFacts(db, {
    mode: 'teardown',
    tenantId: args.tenantId,
    taskId: args.taskId,
    repoCtx,
    writtenPaths: args.writtenPaths,
    // A teardown has no recorded sha set to compare against (the run did not reach
    // a snapshot); commit-message authorship is the guarantee here.
    commitShas: [],
  });

  const actor = cloudAgentActor(args.cloudAgentRef ?? 'cloud', args.agentLabel);
  const base = {
    tenantId: args.tenantId, segmentId: repoCtx.segmentId, projectId: repoCtx.projectId,
    taskId: args.taskId, executionId: args.executionId, cloudAgentRef: args.cloudAgentRef,
    actor, verb: 'run.teardown' as const,
  };

  if (!decision.safe) {
    await emitRollbackEvent(env, db, {
      ...base,
      outcome: `Branch \`${repoCtx.branch}\` kept — ${decision.reason}`,
      detail: { branch: repoCtx.branch, refusal: decision.refusal, reason: decision.reason },
    });
    return { deleted: false, refusal: decision.refusal, reason: decision.reason };
  }

  const del = await deleteBranch({
    provider: repoCtx.provider, host: repoCtx.host, owner: repoCtx.owner,
    repo: repoCtx.repo, token: repoCtx.token, branch: decision.branch,
  });
  if (!del.ok) {
    await emitRollbackEvent(env, db, {
      ...base,
      outcome: `Branch \`${decision.branch}\` kept — delete failed: ${del.reason}`,
      detail: { branch: decision.branch, code: del.code, reason: del.reason },
    });
    return { deleted: false, refusal: 'delete_failed', reason: del.reason };
  }

  await emitRollbackEvent(env, db, {
    ...base,
    outcome: `Deleted abandoned branch \`${decision.branch}\` (${decision.commits.length} commit(s), no PR)`,
    detail: { branch: decision.branch, commits: decision.commits.map((c) => c.sha.slice(0, 7)) },
  });
  // Drop the task's branch pin so a re-run starts clean instead of resolving to a
  // branch that no longer exists.
  await db.update(tasks).set({ gitBranch: null, updatedAt: new Date() })
    .where(eq(tasks.id, args.taskId)).catch(() => { /* best-effort */ });
  await db.update(executionRollbacks)
    .set({ status: 'torn_down', revertedAt: new Date() })
    .where(and(eq(executionRollbacks.executionId, args.executionId), eq(executionRollbacks.status, 'active')))
    .catch(() => { /* no snapshot for a run that produced no PR — expected */ });

  return { deleted: true, branch: decision.branch, commits: decision.commits.length };
}

/**
 * Terminal-state teardown for a run that CRASHED — the path that has an execution
 * id and nothing else. Resolves the ticket's repo itself, then delegates to the
 * one {@link teardownRunBranch} above so the safety rules are applied identically
 * whether the run was cancelled cleanly or died mid-loop.
 *
 * A failed run recorded no `writtenPaths`; that is fine, because in `teardown`
 * mode the decision rests on commit AUTHORSHIP (every commit must carry this
 * task's marker), not on the path set.
 */
export async function teardownCrashedRunArtifacts(
  env: Env | undefined,
  db: Db,
  args: { executionId: number; secret: string },
): Promise<TeardownOutcome | null> {
  const [row] = await db
    .select({ tenantId: executions.tenantId, taskId: executions.taskId, cloudAgentRef: executions.cloudAgentRef })
    .from(executions)
    .where(eq(executions.id, args.executionId))
    .limit(1);
  if (!row) return null;

  const resolved = await resolveTicketRepoContext(db, args.secret, row.tenantId, row.taskId);
  if (!resolved.ok) return null; // no repo bound → no residue to sweep

  return teardownRunBranch(env, db, {
    tenantId: row.tenantId,
    executionId: args.executionId,
    taskId: row.taskId,
    repoCtx: resolved.ctx,
    writtenPaths: [],
    cloudAgentRef: row.cloudAgentRef ?? undefined,
    agentLabel: 'Cloud Agent',
  });
}

// ── 2. revert a completed run ─────────────────────────────────────────────────

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
      .where(eq(executionRollbacks.id, snapshot.id))
      .catch(() => { /* best-effort */ });
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
    if (prRow) await markPullRequestClosedById(db, prRow.id, args.tenantId).catch(() => { /* best-effort */ });
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
    .where(eq(executionRollbacks.id, snapshot.id));

  await db.update(tasks)
    .set({ gitBranch: null, githubPrUrl: null, githubPrNumber: null, updatedAt: new Date() })
    .where(eq(tasks.id, snapshot.taskId))
    .catch(() => { /* best-effort */ });

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

// ── 3. revert work that already MERGED ────────────────────────────────────────

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
      .where(eq(executionRollbacks.id, args.rollbackId))
      .catch(() => { /* best-effort */ });
    await emitRollbackEvent(env, db, {
      ...args.eventBase,
      outcome: `Revert refused — pull request #${prNumber} is merged and could not be reversed: ${result.reason}`,
      detail: { pr: prNumber, base: repoCtx.base, code: result.code, reason: result.reason },
    });
    return { reverted: false, refusal, reason: result.reason };
  }

  await db.update(executionRollbacks)
    .set({ status: 'revert_pr', refusalCode: null, refusalReason: null })
    .where(eq(executionRollbacks.id, args.rollbackId))
    .catch(() => { /* best-effort */ });

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
    branchDeleted: false, prClosed: false, commits: 0,
    revertPrNumber: result.number, revertPrUrl: result.url,
  };
}
