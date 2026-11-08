/**
 * Match a merged PR's HEAD BRANCH to the delta tickets whose work lives on it.
 *
 * `completeDeltaTicketsOnMerge` joins a merged PR to a ticket by the PR row's `task_id`
 * or by a branch name this platform minted (`builderforce/task-<id>`, `ticket/<id>`).
 * A delta whose run left its change on ANY OTHER branch, merged by a PR that names no
 * ticket, matched neither and sat in review forever.
 *
 * The platform already records which branch a ticket's work is on, in three places that
 * are each an exact identity (not a fuzzy file overlap): `tasks.git_branch`, the
 * `repo_branches` rows an agent created for the ticket, and the per-ticket
 * `task_repo_bindings.branch`. This looks the merged head branch up in all three in ONE
 * query, scoped to the tenant + project AND THE MERGED REPOSITORY, and returns the ticket
 * ids. The caller still requires each to be a delta ticket in `in_review`.
 *
 * ── A BRANCH NAME IS ONLY UNIQUE WITHIN ONE REPOSITORY ────────────────────────────────
 * A multi-repo project can have `feature/x` in two repos. `repo_branches` and
 * `task_repo_bindings` carry the repo, so they are matched on it. `tasks.git_branch` does
 * not, so it counts only when the ticket is bound to the merged repo, or has no bindings at
 * all and the merged repo is the project's default (the single-repo case).
 *
 * A base or long-lived branch is never a ticket's branch: matching `main` (or `develop`,
 * `release/*`, any repo's default) would let one merge into an integration branch complete
 * every ticket whose recorded branch happened to be that one.
 */

import { and, eq, inArray, notInArray, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { repoBranches, taskRepoBindings, tasks } from '../../infrastructure/database/schema';

/** Conventional bases; the repo's real default branch is added by the caller. */
const FALLBACK_BASES: ReadonlySet<string> = new Set(['main', 'master']);

/** Integration / release branches that are long-lived by convention, never one ticket's work. */
const LONG_LIVED_NAMES: ReadonlySet<string> = new Set(['develop', 'development', 'staging', 'production', 'trunk']);
const LONG_LIVED_PREFIX = /^(release|releases|hotfix|support)\/./;

/** `refs/heads/x` / whitespace stripped; null for an empty name. PURE. */
export function normalizeBranch(branch: string | null | undefined): string | null {
  const trimmed = (branch ?? '').trim().replace(/^refs\/heads\//, '');
  return trimmed || null;
}

/** Is this a long-lived integration/release branch (develop, release/*, …)? PURE. */
export function isLongLivedBranch(branch: string): boolean {
  return LONG_LIVED_NAMES.has(branch) || LONG_LIVED_PREFIX.test(branch);
}

/**
 * Is this branch a base (main/master, a repo default, or a long-lived branch) rather than a
 * work branch? `defaultBranch` may be one default or the defaults of every repo. PURE.
 */
export function isBaseBranch(branch: string, defaultBranch?: string | readonly string[] | null): boolean {
  if (FALLBACK_BASES.has(branch) || isLongLivedBranch(branch)) return true;
  if (!defaultBranch) return false;
  return typeof defaultBranch === 'string' ? branch === defaultBranch : defaultBranch.includes(branch);
}

/** The merged PR's repository, as `project_repositories` knows it. */
export interface BranchRepoScope {
  /** `project_repositories.id` of the merged repo. */
  repoId: string;
  /** True when this is the project's default (or only) repo — see the module header. */
  isProjectDefault: boolean;
  /** Default branches of EVERY repo in the project; none of them is a ticket's work branch. */
  allDefaultBranches: readonly string[];
}

/**
 * Ticket ids in the project whose recorded working branch IS `branch` in the merged repo.
 * One round trip. Returns [] for an empty, base or long-lived branch.
 */
export async function ticketIdsOnBranch(
  db: Db,
  tenantId: number,
  projectId: number,
  branch: string | null | undefined,
  defaultBranch: string | null | undefined,
  scope: BranchRepoScope,
): Promise<number[]> {
  const name = normalizeBranch(branch);
  if (!name || isBaseBranch(name, [...scope.allDefaultBranches, ...(defaultBranch ? [defaultBranch] : [])])) return [];

  const boundToMergedRepo = db.select({ id: taskRepoBindings.taskId }).from(taskRepoBindings)
    .where(and(eq(taskRepoBindings.tenantId, tenantId), eq(taskRepoBindings.repoId, scope.repoId)));
  const anyBinding = db.select({ id: taskRepoBindings.taskId }).from(taskRepoBindings)
    .where(eq(taskRepoBindings.tenantId, tenantId));
  // `tasks.git_branch` carries no repo: it speaks for the merged repo only when the ticket is
  // bound to it, or is unbound in the project's default repo.
  const gitBranchInRepo: SQL | undefined = or(
    inArray(tasks.id, boundToMergedRepo),
    scope.isProjectDefault ? notInArray(tasks.id, anyBinding) : sql`false`,
  );

  const rows = await db
    .selectDistinct({ id: tasks.id })
    .from(tasks)
    .where(and(
      eq(tasks.tenantId, tenantId),
      eq(tasks.projectId, projectId),
      or(
        and(eq(tasks.gitBranch, name), gitBranchInRepo),
        inArray(
          tasks.id,
          db.select({ id: repoBranches.taskId }).from(repoBranches)
            .where(and(
              eq(repoBranches.tenantId, tenantId), eq(repoBranches.repoId, scope.repoId), eq(repoBranches.name, name),
            )),
        ),
        inArray(
          tasks.id,
          db.select({ id: taskRepoBindings.taskId }).from(taskRepoBindings)
            .where(and(
              eq(taskRepoBindings.tenantId, tenantId), eq(taskRepoBindings.repoId, scope.repoId),
              eq(taskRepoBindings.branch, name),
            )),
        ),
      ),
    ));
  return rows.map((r) => r.id);
}
