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
import { commitFileToRepo, type CommitFileResult } from './commitFileToRepo';

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
      branch: `builderforce/task-${taskId}`,
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
