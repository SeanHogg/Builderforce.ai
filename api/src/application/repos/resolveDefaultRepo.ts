/**
 * resolveDefaultRepoForTask — the repo a task's agent should code against: the
 * task's project default repo (or the most recently added one). Shared by the
 * browser claim path (/api/agent-runtime/claim) and the headless agentHost
 * dispatch-detail path so both resolve the target repo identically (DRY).
 *
 * Returns the non-secret coordinates only; the git token is resolved separately,
 * server-side, via resolveRepoCredential at the moment of a git/PR operation.
 */
import { and, desc, eq } from 'drizzle-orm';
import { tasks, projectRepositories } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';

export interface DefaultRepoRef {
  repoId: string;
  provider: string;
  owner: string;
  repo: string;
  defaultBranch: string | null;
}

export async function resolveDefaultRepoForTask(
  db: Db,
  tenantId: number,
  taskId: number | null,
): Promise<DefaultRepoRef | null> {
  if (taskId == null) return null;
  const [task] = await db
    .select({ projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (!task) return null;

  const repos = await db
    .select({
      id: projectRepositories.id,
      isDefault: projectRepositories.isDefault,
      provider: projectRepositories.provider,
      owner: projectRepositories.owner,
      repo: projectRepositories.repo,
      defaultBranch: projectRepositories.defaultBranch,
    })
    .from(projectRepositories)
    .where(and(eq(projectRepositories.projectId, task.projectId), eq(projectRepositories.tenantId, tenantId)))
    .orderBy(desc(projectRepositories.createdAt));
  if (repos.length === 0) return null;

  const chosen = repos.find((r) => r.isDefault) ?? repos[0]!;
  return {
    repoId: chosen.id,
    provider: chosen.provider,
    owner: chosen.owner,
    repo: chosen.repo,
    defaultBranch: chosen.defaultBranch,
  };
}
