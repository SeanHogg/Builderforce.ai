/**
 * runRollback — the undo story for an autonomous cloud run: the SNAPSHOT and what the
 * destructive paths share.
 *
 * A cloud run's only durable artifacts are git artifacts: a `builderforce/task-<id>`
 * branch it commits to as it goes, and (on success) a pull request. Before this
 * subsystem a failed or cancelled run left both behind forever, and a completed run
 * could not be undone at all.
 *
 * Three entry points, ONE rulebook, three modules:
 *   • {@link recordRunRollbackSnapshot} (here) — at finalize, snapshot what the run changed
 *     (branch/base, written paths, commit shas, PR) into `execution_rollbacks`.
 *   • `teardownRunBranch` (`runBranchTeardown.ts`) — a run ended CANCELLED with no PR: sweep
 *     the branch when the shared decision allows it. A FAILED run's branch is NOT swept — see
 *     the ROADMAP Consolidated Gap Register entry "A FAILED cloud run's branch residue is never
 *     swept" (run-branch sweeps).
 *   • `revertRun` (`runRevert.ts`) — a human undoes a completed run: close the PR and delete
 *     the branch, if and only if it is provably safe to; a MERGED PR escalates to a pull
 *     request reversing the merge — never a force-push, never a direct write to the base.
 *
 * Both destructive paths gather evidence with `gatherTeardownFacts` and hand it to the
 * SINGLE pure decision function `decideBranchTeardown`. The safety rules exist in exactly
 * one place; neither path is allowed its own copy. Both report through
 * {@link emitRollbackEvent} (here).
 *
 * Everything is best-effort on the TELEMETRY and hard-refusing on the ACTION: a failure to
 * record an audit row never blocks, and a failure to prove safety always blocks.
 */
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { executionRollbacks } from '../../infrastructure/database/schema';
import { listBranchCommits, type BranchCommit } from '../repos/branchLifecycle';
import type { TicketRepoContext } from '../repos/commitFileAsPendingChange';
import { recordActivity, type ActorIdentity } from '../activity/activityLog';
import { recordCloudToolEvent } from './cloudToolEvents';

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
    /**
     * Handed the complete branch listing (only when it is `ok` and NOT truncated), so a
     * caller that needs the same commits — the run's commit attribution — reuses this one
     * provider listing instead of paying for a second.
     */
    onListed?: (commits: BranchCommit[]) => void;
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
    if (listed?.ok && !listed.truncated) args.onListed?.(listed.commits);

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

// ── observability (shared by both destructive paths) ──────────────────────────

/** Emit BOTH channels for a teardown/revert outcome: the tool-audit timeline (so
 *  it appears beside the run's other tool events) and `activity_log` (so it is in
 *  the tenant's one audit store — cloud runs historically wrote almost nothing
 *  there, and a destructive action is the last thing that should be invisible). */
export interface RollbackEventBase {
  tenantId: number;
  segmentId: string | null;
  projectId: number | null;
  taskId: number;
  executionId: number;
  cloudAgentRef?: string;
  actor: ActorIdentity;
  verb: 'run.teardown' | 'run.revert';
}

export async function emitRollbackEvent(
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
