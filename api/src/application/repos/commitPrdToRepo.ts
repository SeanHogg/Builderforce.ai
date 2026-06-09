/**
 * commitPrdAsPendingChange — land an agent-authored PRD as a real pending change
 * on the TASK'S TICKET BRANCH (the same `builderforce/task-<id>` branch the agent's
 * code files commit to), so the PRD and the code it produces share ONE branch and
 * ONE pull request. It deliberately does NOT open its own PR — the single PR is
 * opened once at run finalize, covering `PRD.md` + every file. Runs via the provider
 * REST API so it works from the cloud (Worker) path with no local git. GitHub-only;
 * degrades gracefully.
 */
import type { Db } from '../../infrastructure/database/connection';
import { resolveDefaultRepoForTask } from './resolveDefaultRepo';
import { resolveRepoCredential, isResolveError } from './resolveRepoCredential';
import { commitFileToRepo } from './commitFileToRepo';
import { ticketBranchName } from './commitFileAsPendingChange';

export type CommitPrdResult =
  | { ok: true; branch: string }
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
  // Same branch as the agent's code files — so PRD + code share one branch + one PR.
  const branch = ticketBranchName(taskId);

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

  // No PR is opened here: the single run-level PR (opened at finalize) covers
  // PRD.md + every file the agent writes on this same branch.
  return { ok: true, branch };
}
