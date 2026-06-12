/**
 * Ticket-branch file commits for the cloud agent tool loop.
 *
 * The cloud (Worker) execution path has no local git, so when its agent loop
 * calls `write_file`, the file is committed to the ticket's branch via the
 * provider REST API — the same mechanism that lands an agent-authored `PRD.md`
 * ([commitPrdAsPendingChange](./commitPrdToRepo.ts)). This module factors out the
 * shared per-run resolution (repo + decrypted credential + branch/base) so the
 * loop resolves it ONCE and reuses it for every file the agent writes, instead of
 * re-decrypting the token per tool call.
 */
import type { Db } from '../../infrastructure/database/connection';
import { resolveDefaultRepoForTask } from './resolveDefaultRepo';
import { resolveRepoCredential, isResolveError } from './resolveRepoCredential';
import { commitFileToRepo, deleteFileFromRepo, type CommitFileResult, type DeleteFileResult } from './commitFileToRepo';

/**
 * The single ticket branch a run's changes land on. The PRD, every agent-written
 * file, and the finalize PR all reference THIS one branch, so a task's PRD + code
 * live on one branch and in one PR (not a separate `-prd` branch/PR). One source of
 * truth so the PRD-commit path and the file-commit path never diverge.
 */
export function ticketBranchName(taskId: number): string {
  return `builderforce/task-${taskId}`;
}

/** Everything needed to commit files to a ticket's branch, resolved once per run. */
export interface TicketRepoContext {
  provider: string;
  host: string | null;
  owner: string;
  repo: string;
  token: string;
  /** Branch the agent's changes land on. */
  branch: string;
  /** Base branch the ticket branch forks from. */
  base: string;
  /** project_repositories.id — carried so the run can record a pull_requests row. */
  repoId: string;
  /** Repo's segment (nullable) for tenant/segment scoping of recorded rows. */
  segmentId: string | null;
  /** Repo's project — the pull_requests row's projectId. */
  projectId: number;
}

export type ResolveTicketRepoResult =
  | { ok: true; ctx: TicketRepoContext }
  | { ok: false; reason: string };

/**
 * Resolve the ticket's repo + credential + branch once for a run. Returns a
 * typed error (never throws) so the loop can tell the model "no repo bound" and
 * fall back to returning the deliverable inline.
 */
export async function resolveTicketRepoContext(
  db: Db,
  secret: string,
  tenantId: number,
  taskId: number,
): Promise<ResolveTicketRepoResult> {
  const repoRef = await resolveDefaultRepoForTask(db, tenantId, taskId);
  if (!repoRef) return { ok: false, reason: 'no repo bound to this task' };

  const resolved = await resolveRepoCredential(db, secret, tenantId, repoRef.repoId);
  if (isResolveError(resolved)) return { ok: false, reason: resolved.error };

  return {
    ok: true,
    ctx: {
      provider: resolved.repo.provider,
      host: resolved.repo.host,
      owner: resolved.repo.owner,
      repo: resolved.repo.repo,
      token: resolved.token,
      base: (resolved.repo.defaultBranch ?? 'main').trim(),
      branch: ticketBranchName(taskId),
      repoId: resolved.repo.id,
      segmentId: resolved.repo.segmentId,
      projectId: resolved.repo.projectId,
    },
  };
}

/** Commit one agent-authored file onto the ticket branch (create branch if new). */
export function commitAgentFile(
  ctx: TicketRepoContext,
  path: string,
  content: string,
  message: string,
): Promise<CommitFileResult> {
  return commitFileToRepo({
    provider: ctx.provider,
    host: ctx.host,
    owner: ctx.owner,
    repo: ctx.repo,
    token: ctx.token,
    branch: ctx.branch,
    base: ctx.base,
    path,
    content,
    message,
  });
}

/** Remove one file from the ticket branch (clean up a dead/stub file). */
export function deleteAgentFile(
  ctx: TicketRepoContext,
  path: string,
  message: string,
): Promise<DeleteFileResult> {
  return deleteFileFromRepo({
    provider: ctx.provider,
    host: ctx.host,
    owner: ctx.owner,
    repo: ctx.repo,
    token: ctx.token,
    branch: ctx.branch,
    path,
    message,
  });
}
