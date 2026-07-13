/**
 * resolveDefaultRepoForTask — the repo a task's agent should code against. Shared
 * by the browser claim path (/api/agent-runtime/claim), the headless agentHost
 * dispatch-detail path, the cloud run loop, finalize (PR), CI auto-fix, and the
 * PRD commit — so EVERY surface resolves the same repo for a task (DRY: one source
 * of truth, no divergence between where the agent commits and where the PR opens).
 *
 * Precedence (via the pure {@link resolveRepoForTask}): explicit pin
 * (`tasks.explicit_repo_id`) → inferred by the repo's matchHints vs the task →
 * single default. Falls back to the legacy default-or-most-recent pick only when
 * the resolver makes no decision, so a currently-working single-repo project never
 * regresses.
 *
 * Returns the non-secret coordinates only; the git token is resolved separately,
 * server-side, via resolveRepoCredential at the moment of a git/PR operation.
 */
import { and, desc, eq } from 'drizzle-orm';
import { tasks, projectRepositories } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import { resolveRepoForTask } from './resolveRepo';

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
    .select({ projectId: tasks.projectId, title: tasks.title, description: tasks.description, explicitRepoId: tasks.explicitRepoId })
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
      matchHints: projectRepositories.matchHints,
    })
    .from(projectRepositories)
    .where(and(eq(projectRepositories.projectId, task.projectId), eq(projectRepositories.tenantId, tenantId)))
    .orderBy(desc(projectRepositories.createdAt));
  if (repos.length === 0) return null;

  // explicit pin → inferred-by-hints → single default (pure, fail-closed on
  // ambiguity). Title+description feeds keyword/glob matching so a pin/hint on the
  // task text resolves automatically.
  const decided = resolveRepoForTask(
    { explicitRepoId: task.explicitRepoId ?? undefined, description: `${task.title} ${task.description ?? ''}`.trim() },
    repos.map((r) => ({ id: r.id, isDefault: r.isDefault, matchHints: r.matchHints })),
  );
  // No safe decision (no pin/hint match + no single default, or an ambiguous
  // inference) → preserve the legacy pick so an existing run never breaks.
  const chosen = (decided && repos.find((r) => r.id === decided.repoId))
    ?? repos.find((r) => r.isDefault)
    ?? repos[0]!;
  return {
    repoId: chosen.id,
    provider: chosen.provider,
    owner: chosen.owner,
    repo: chosen.repo,
    defaultBranch: chosen.defaultBranch,
  };
}
