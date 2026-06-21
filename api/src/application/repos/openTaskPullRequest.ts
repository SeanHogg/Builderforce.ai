/**
 * openTaskPullRequest — open a PR for a task's accumulated workspace changes and
 * record it. Called when a task is marked Done: the agent host has pushed the
 * ticket branch through the git-proxy, and the API opens the PR server-side with
 * the decrypted credential (the token never leaves the server), records it, and
 * writes the PR back onto the task so the kanban card surfaces it.
 *
 * This is the shared core; {@link openDispatchPullRequest} delegates to it after
 * resolving a dispatch → task.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { tasks } from '../../infrastructure/database/schema';
import { resolveDefaultRepoForTask } from './resolveDefaultRepo';
import { resolveRepoCredential, isResolveError } from './resolveRepoCredential';
import { createPullRequest } from './createPullRequest';
import { mergeBranchToBase, cloudAutoMergeRequiresGreen, cloudAutoMergeEnabled } from './mergeBranchToBase';
import { recordPullRequestRow } from './recordPullRequestRow';
import type { Db } from '../../infrastructure/database/connection';

export interface OpenTaskPrInput {
  branch: string;
  base?: string;
  title?: string;
  body?: string;
}

export type OpenTaskPrResult =
  | { ok: true; url: string; number: number; merged: boolean; mergeError?: string }
  /** Another finalize path already claimed (or completed) this task's PR — no PR
   *  opened by THIS call. Not an error: the single-PR invariant held. */
  | { ok: false; status: 409; error: string; claimLost: true }
  | { ok: false; status: 400 | 404 | 409 | 501 | 502; error: string };

/**
 * Atomically claim the right to open this task's PR. Returns true for exactly one
 * concurrent caller (the row is updated only WHERE no claim and no URL yet); a
 * later/loser caller gets false and must NOT call the provider. The claim is
 * released by {@link releaseTaskPrClaim} if the subsequent create fails.
 */
export async function claimTaskPrOpen(db: Db, tenantId: number, taskId: number): Promise<boolean> {
  const now = new Date();
  const claimed = await db
    .update(tasks)
    .set({ prOpeningAt: now })
    .where(and(
      eq(tasks.id, taskId),
      eq(tasks.tenantId, tenantId),
      isNull(tasks.prOpeningAt),
      isNull(tasks.githubPrUrl),
    ))
    .returning({ id: tasks.id });
  return claimed.length > 0;
}

/** Release a claim taken by {@link claimTaskPrOpen} when the PR-create failed, so a
 *  retry can re-claim. No-op once `github_pr_url` is set (success is permanent). */
async function releaseTaskPrClaim(db: Db, tenantId: number, taskId: number): Promise<void> {
  await db
    .update(tasks)
    .set({ prOpeningAt: null })
    .where(and(eq(tasks.id, taskId), eq(tasks.tenantId, tenantId), isNull(tasks.githubPrUrl)))
    .catch(() => { /* best-effort — a stale claim only blocks an auto-retry, never data */ });
}

export async function openTaskPullRequest(
  db: Db,
  secret: string,
  tenantId: number,
  taskId: number,
  input: OpenTaskPrInput,
  /** Pass the worker env so the "merge only on green CI" gate is honored. When
   *  omitted, the default full-auto-merge policy applies (immediate merge). */
  env?: unknown,
): Promise<OpenTaskPrResult> {
  if (!input.branch || typeof input.branch !== 'string') {
    return { ok: false, status: 400, error: 'branch is required' };
  }

  const repoRef = await resolveDefaultRepoForTask(db, tenantId, taskId);
  if (!repoRef) return { ok: false, status: 409, error: 'No repo bound to this task' };

  const resolved = await resolveRepoCredential(db, secret, tenantId, repoRef.repoId);
  if (isResolveError(resolved)) return { ok: false, status: resolved.status, error: resolved.error };

  const base = (input.base ?? resolved.repo.defaultBranch ?? 'main').trim();
  const title = (input.title ?? '').trim() || `BuilderForce changes for task #${taskId}`;
  const prBody = (input.body ?? '').trim() || `Automated changes for task #${taskId}.`;

  // Atomic single-PR claim (0140) — taken BEFORE the external create so two
  // concurrent finalize paths (inline run-end + human Done-drag) can't both open a
  // PR. The read-time `!githubPrUrl` guard in callers is now backed by this write.
  // A lost claim is NOT an error: the invariant held, another path is opening it.
  const claimed = await claimTaskPrOpen(db, tenantId, taskId);
  if (!claimed) {
    return { ok: false, status: 409, error: 'PR already being opened for this task', claimLost: true };
  }

  const pr = await createPullRequest({
    provider: resolved.repo.provider,
    host: resolved.repo.host,
    owner: resolved.repo.owner,
    repo: resolved.repo.repo,
    token: resolved.token,
    head: input.branch.trim(),
    base,
    title,
    body: prBody,
  });
  if (!pr.ok) {
    // Release the claim so a manual/automatic retry can re-attempt the create.
    await releaseTaskPrClaim(db, tenantId, taskId);
    return { ok: false, status: pr.code === 'unsupported' ? 501 : 502, error: pr.reason };
  }

  // Merge policy. DEFAULT (CLOUD_AUTOMERGE_ENABLED off): do NOT merge — leave the
  // PR open for in-product human approval. When auto-merge is enabled: merge the
  // ticket branch into the deploy branch now, unless the operator gates on green CI
  // (then defer to the CI-success webhook). Best-effort — a conflict/failure leaves
  // the PR open for manual resolution rather than blocking the finalize.
  const merge = !cloudAutoMergeEnabled(env)
    ? { ok: false as const, code: 'provider_error' as const, reason: 'deferred: awaiting in-product approval' }
    : cloudAutoMergeRequiresGreen(env)
    ? { ok: false as const, code: 'provider_error' as const, reason: 'deferred: merge on green CI' }
    : await mergeBranchToBase({
        provider: resolved.repo.provider,
        host: resolved.repo.host,
        owner: resolved.repo.owner,
        repo: resolved.repo.repo,
        token: resolved.token,
        base,
        head: input.branch.trim(),
        message: `${title} (BuilderForce auto-merge)`,
      });

  const now = new Date();
  await recordPullRequestRow(db, {
    tenantId,
    segmentId: resolved.repo.segmentId,
    projectId: resolved.repo.projectId,
    repoId: resolved.repo.id,
    taskId,
    provider: resolved.repo.provider,
    number: pr.number,
    url: pr.url,
    branchName: input.branch.trim(),
    baseBranch: base,
    status: merge.ok ? 'merged' : 'open',
  });
  await db
    .update(tasks)
    .set({ githubPrUrl: pr.url, githubPrNumber: pr.number, gitBranch: input.branch.trim(), updatedAt: now })
    .where(eq(tasks.id, taskId));

  return { ok: true, url: pr.url, number: pr.number, merged: merge.ok, mergeError: merge.ok ? undefined : merge.reason };
}
