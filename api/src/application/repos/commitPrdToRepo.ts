/**
 * commitPrdAsPendingChange — land an agent-authored PRD as a real pending change
 * on a dedicated branch of the task's repo, then open a PR for it.
 *
 * This is how the PRD becomes a visible git pending change (not just a DB row):
 * a `builderforce/task-<id>-prd` branch is created with `PRD.md` committed to it
 * and a PR opened. Runs entirely via the provider REST API, so it works from the
 * cloud (Worker) path with no local git. GitHub-only; degrades gracefully.
 */
import type { Db } from '../../infrastructure/database/connection';
import { resolveDefaultRepoForTask } from './resolveDefaultRepo';
import { resolveRepoCredential, isResolveError } from './resolveRepoCredential';
import { commitFileToRepo } from './commitFileToRepo';
import { createPullRequest } from './createPullRequest';

export type CommitPrdResult =
  | { ok: true; branch: string; prUrl: string | null; prNumber: number | null }
  | { ok: false; reason: string };

export async function commitPrdAsPendingChange(
  db: Db,
  secret: string,
  tenantId: number,
  taskId: number,
  taskTitle: string,
  prd: string,
  agentLabel: string,
): Promise<CommitPrdResult> {
  const repoRef = await resolveDefaultRepoForTask(db, tenantId, taskId);
  if (!repoRef) return { ok: false, reason: 'no repo bound to this task' };

  const resolved = await resolveRepoCredential(db, secret, tenantId, repoRef.repoId);
  if (isResolveError(resolved)) return { ok: false, reason: resolved.error };

  const base = (resolved.repo.defaultBranch ?? 'main').trim();
  const branch = `builderforce/task-${taskId}-prd`;

  const commit = await commitFileToRepo({
    provider: resolved.repo.provider,
    host: resolved.repo.host,
    owner: resolved.repo.owner,
    repo: resolved.repo.repo,
    token: resolved.token,
    branch,
    base,
    path: 'PRD.md',
    content: prd,
    message: `PRD for task #${taskId}: ${taskTitle} (drafted by ${agentLabel})`,
  });
  if (!commit.ok) return { ok: false, reason: commit.reason };

  // Open a PR so the PRD shows as a reviewable pending change (idempotent on retry).
  const pr = await createPullRequest({
    provider: resolved.repo.provider,
    host: resolved.repo.host,
    owner: resolved.repo.owner,
    repo: resolved.repo.repo,
    token: resolved.token,
    head: branch,
    base,
    title: `PRD: ${taskTitle}`,
    body: `WIP Product Requirements Document for task #${taskId}, drafted by ${agentLabel}. Edit on the \`${branch}\` branch; downstream agents append their updates here.`,
  });

  return {
    ok: true,
    branch,
    prUrl: pr.ok ? pr.url : null,
    prNumber: pr.ok ? pr.number : null,
  };
}
