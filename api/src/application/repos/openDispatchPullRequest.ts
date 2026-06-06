/**
 * openDispatchPullRequest — open a PR for a coding dispatch and record it.
 *
 * Shared by BOTH executors so the close-the-loop behaviour is identical:
 *  - the browser worker calls it via the tenant-JWT /api/agent-runtime route, and
 *  - a headless agentHost calls it via the host-authed /api/agent-hosts route.
 *
 * It resolves the dispatch's default repo, opens the PR server-side with the
 * decrypted credential (the token never leaves the server), records the PR, and
 * writes it back onto the task so the kanban card surfaces it.
 */
import { and, eq } from 'drizzle-orm';
import { agentDispatches, tasks, pullRequests } from '../../infrastructure/database/schema';
import { resolveDefaultRepoForTask } from './resolveDefaultRepo';
import { resolveRepoCredential, isResolveError } from './resolveRepoCredential';
import { createPullRequest } from './createPullRequest';
import type { Db } from '../../infrastructure/database/connection';

export interface OpenDispatchPrInput {
  branch: string;
  base?: string;
  title?: string;
  body?: string;
}

export type OpenDispatchPrResult =
  | { ok: true; url: string; number: number }
  | { ok: false; status: 400 | 404 | 409 | 501 | 502; error: string };

export async function openDispatchPullRequest(
  db: Db,
  secret: string,
  tenantId: number,
  dispatchId: string,
  input: OpenDispatchPrInput,
): Promise<OpenDispatchPrResult> {
  if (!input.branch || typeof input.branch !== 'string') {
    return { ok: false, status: 400, error: 'branch is required' };
  }

  const [dispatch] = await db
    .select({ id: agentDispatches.id, taskId: agentDispatches.taskId, role: agentDispatches.role })
    .from(agentDispatches)
    .where(and(eq(agentDispatches.id, dispatchId), eq(agentDispatches.tenantId, tenantId)))
    .limit(1);
  if (!dispatch) return { ok: false, status: 404, error: 'Dispatch not found' };

  const repoRef = await resolveDefaultRepoForTask(db, tenantId, dispatch.taskId);
  if (!repoRef) return { ok: false, status: 409, error: 'No repo bound to this dispatch task' };

  const resolved = await resolveRepoCredential(db, secret, tenantId, repoRef.repoId);
  if (isResolveError(resolved)) return { ok: false, status: resolved.status, error: resolved.error };

  const base = (input.base ?? resolved.repo.defaultBranch ?? 'main').trim();
  const title = (input.title ?? '').trim() || `Agent changes for ${dispatch.role} (#${dispatch.taskId ?? '—'})`;
  const prBody = (input.body ?? '').trim() || `Automated changes for dispatch ${dispatchId}.`;

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

  const now = new Date();
  await db.insert(pullRequests).values({
    tenantId,
    segmentId: resolved.repo.segmentId,
    projectId: resolved.repo.projectId,
    repoId: resolved.repo.id,
    taskId: dispatch.taskId,
    provider: resolved.repo.provider,
    number: pr.number,
    url: pr.url,
    branchName: input.branch.trim(),
    baseBranch: base,
    status: 'open',
    createdAt: now,
    updatedAt: now,
  });
  if (dispatch.taskId != null) {
    await db
      .update(tasks)
      .set({ githubPrUrl: pr.url, githubPrNumber: pr.number, updatedAt: now })
      .where(eq(tasks.id, dispatch.taskId));
  }

  return { ok: true, url: pr.url, number: pr.number };
}
