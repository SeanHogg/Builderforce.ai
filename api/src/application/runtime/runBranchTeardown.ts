import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * runBranchTeardown — the evidence gathering both destructive rollback paths share, and the
 * terminal-state TEARDOWN of a cancelled run's branch (`runRollback.ts` holds the snapshot
 * and the shared event emitter; `runRevert.ts` the human revert).
 *
 * {@link gatherTeardownFacts} is the ONLY route to a destructive action: it gathers the
 * facts and hands them to the single pure `decideBranchTeardown`. Neither caller assembles
 * its own facts or applies its own rules.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { executionRollbacks, pullRequests, tasks } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { deleteBranch, listBranchCommits, type ListBranchCommitsResult } from '../repos/branchLifecycle';
import { listBranchDiff } from '../repos/readRepoContents';
import type { TicketRepoContext } from '../repos/commitFileAsPendingChange';
import { cloudAgentActor } from '../activity/activityLog';
import {
  decideBranchTeardown, runCommitMarker,
  type TeardownDecision, type TeardownMode, type TeardownRefusal,
} from './branchTeardownDecision';
import { emitRollbackEvent } from './runRollback';

// ── evidence gathering (shared by both destructive paths) ─────────────────────

/**
 * Gather the facts {@link decideBranchTeardown} needs and return its verdict.
 * The ONLY route to a destructive action — neither caller is permitted to assemble
 * its own facts or apply its own rules.
 */
export async function gatherTeardownFacts(
  db: Db,
  args: {
    mode: TeardownMode;
    tenantId: number;
    taskId: number;
    /** The run whose artifacts are at stake: authorship is matched per RUN (`runCommitMarker`). */
    executionId: number;
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
  // on the automatic teardown sweep (which runs on every cancelled run; see the ROADMAP gap entry on run-branch residue for its per-task-attribution hazard).
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
    // Per RUN: another run of this task, or a commit written before per-run subjects, is
    // foreign — a refusal, never a delete of work this run cannot prove is its own.
    runCommitMarker: runCommitMarker(args.taskId, args.executionId),
    // A REVERT of a run snapshotted before per-run subjects: its legacy per-task commits are
    // its own only when the run is entirely legacy and the snapshot recorded their exact shas
    // (the decision checks both).
    ...(args.mode === 'revert' ? { legacyRunCommitMarker: runCommitMarker(args.taskId) } : {}),
  });

  return { decision, prRow: prRow ?? null };
}

// ── terminal-state teardown ───────────────────────────────────────────────────

export type TeardownOutcome =
  | { deleted: true; branch: string; commits: number }
  | { deleted: false; refusal: TeardownRefusal | 'delete_failed'; reason: string };

/**
 * Sweep the ticket branch of a run that ended CANCELLED without opening
 * a PR. Called from the cloud finalize chokepoint.
 *
 * This is the conservative path by design: it deletes only when
 * {@link decideBranchTeardown} allows it. That decision's authorship rule (7) is per RUN
 * (`runCommitMarker(taskId, executionId)`, PRD 41 WS16): a branch carrying an earlier run's,
 * a live parent's, or a pre-per-run-subject commit reads as foreign and is kept. Every other
 * outcome leaves the branch in place and records WHY: residue is recoverable, a wrong delete is not.
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
    executionId: args.executionId,
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
    .where(scopedToTenant(tasks, args.tenantId, eq(tasks.id, args.taskId))).catch((error) => reportCaughtError(error, { source: "application/runtime/runBranchTeardown.ts", operation: "teardownRunBranch", context: { logMessage: '[run-rollback] task branch reset failed', details: { tenantId: args.tenantId, executionId: args.executionId, taskId: args.taskId, error } } }));
  await db.update(executionRollbacks)
    .set({ status: 'torn_down', revertedAt: new Date() })
    .where(scopedToTenant(executionRollbacks, args.tenantId, eq(executionRollbacks.executionId, args.executionId), eq(executionRollbacks.status, 'active')))
    .catch((error) => reportCaughtError(error, { source: "application/runtime/runBranchTeardown.ts", operation: "teardownRunBranch", context: { logMessage: '[run-rollback] teardown snapshot update failed', details: { tenantId: args.tenantId, executionId: args.executionId, error } } }));

  return { deleted: true, branch: decision.branch, commits: decision.commits.length };
}
