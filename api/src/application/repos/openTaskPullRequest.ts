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
import { eq } from 'drizzle-orm';
import { tasks, pullRequests } from '../../infrastructure/database/schema';
import { resolveDefaultRepoForTask } from './resolveDefaultRepo';
import { resolveRepoCredential, isResolveError } from './resolveRepoCredential';
import { createPullRequest } from './createPullRequest';
import { mergeBranchToBase } from './mergeBranchToBase';
import type { Db } from '../../infrastructure/database/connection';

export interface OpenTaskPrInput {
  branch: string;
  base?: string;
  title?: string;
  body?: string;
}

export type OpenTaskPrResult =
  | { ok: true; url: string; number: number; merged: boolean; mergeError?: string }
  | { ok: false; status: 400 | 404 | 409 | 501 | 502; error: string };

export async function openTaskPullRequest(
  db: Db,
  secret: string,
  tenantId: number,
  taskId: number,
  input: OpenTaskPrInput,
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
    return { ok: false, status: pr.code === 'unsupported' ? 501 : 502, error: pr.reason };
  }

  // Full auto-merge + deploy: merge the ticket branch into the deploy branch so
  // the push to base triggers CI/deploy. Best-effort — a conflict/failure leaves
  // the PR open for manual resolution rather than blocking the finalize.
  const merge = await mergeBranchToBase({
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
  await db.insert(pullRequests).values({
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
    createdAt: now,
    updatedAt: now,
  });
  await db
    .update(tasks)
    .set({ githubPrUrl: pr.url, githubPrNumber: pr.number, gitBranch: input.branch.trim(), updatedAt: now })
    .where(eq(tasks.id, taskId));

  return { ok: true, url: pr.url, number: pr.number, merged: merge.ok, mergeError: merge.ok ? undefined : merge.reason };
}
