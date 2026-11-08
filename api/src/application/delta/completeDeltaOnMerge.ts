/**
 * Complete a delta ticket when the PULL REQUEST carrying its change is merged.
 *
 * `tickets.from_delta` opens its ticket in `in_review` and its tool description tells
 * the model the ticket "completes automatically once merged and deployed". Two paths
 * can make that true, and only one of them existed. When the RUN ITSELF pushes to the
 * base branch it holds first-hand evidence the work landed, and `completeShippedTickets`
 * closes the ticket then and there. When the run instead leaves the change on a branch,
 * the merge happens later, in a pull request the run never sees — and nothing closed the
 * ticket at all. Those sat at 50% on the board permanently.
 *
 * ── WHY THIS IS A JOIN AND NOT A SEARCH ──────────────────────────────────────
 * The obvious implementation matches the delta's recorded `files[]` against the PR's
 * changed files. That is the implementation to avoid: overlapping files are the NORM on
 * an active repo, so a fuzzy match silently completes somebody else's ticket — strictly
 * worse than leaving one open, because a wrongly-closed ticket is invisible while an
 * open one is merely stale.
 *
 * So every candidate here comes from an EXACT identity, and each is then checked against
 * three independent conditions before anything is written:
 *
 *   1. the ticket is in this repo's project, in this tenant;
 *   2. it is in `in_review` — the lane `from_delta` opens into, and the only lane a
 *      merge is entitled to move a ticket out of;
 *   3. a `work_deltas` row points at it — i.e. it IS a delta ticket. An ordinary
 *      ticket's lifecycle belongs to its Coordinator; a merge does not get to finish it.
 *
 * A candidate failing any one of them is left alone and the reason is returned, so a
 * webhook that decided to do nothing says why rather than looking like it did not fire.
 *
 * Completion itself goes through {@link completeTaskOnMerge} — the single shared path the
 * human "Approve & Merge" route, the manager sweep and the green-CI webhook already use,
 * so this cannot drift from them on lane ordinals, DORA metrics or actor attribution.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { projectRepositories, pullRequests, tasks, workDeltas } from '../../infrastructure/database/schema';
import { TaskStatus } from '../../domain/shared/types';
import { resolveRepoLink } from '../contributors/activityIngest';
import { closeTicketAutomatically } from '../manager/reviewGateAuthority';
import { ticketIdsOnBranch } from './deltaBranchMatch';

/** The merged pull request, in the shape a provider webhook can supply. */
export interface MergedPullRequestRef {
  /** `owner/repo` — resolved to a tenant + project by the shared repo link. */
  repoFullName: string;
  /** The PR number, when the provider gives one. The exact join. */
  number: number | null;
  /** The PR's head branch. The fallback join, and only for OUR OWN conventions. */
  branchName: string | null;
  provider?: string;
  /** The repo's default branch as the provider's payload states it. Preferred over the
   *  stored `project_repositories.default_branch`; main/master remain the fallback. */
  defaultBranch?: string | null;
}

export interface DeltaMergeOutcome {
  /** Task ids actually moved to done. */
  completed: number[];
  /** Matched tickets left in review because the board's review lane needs a person and
   *  the workspace has not let the manager close reviewed tickets (1153). */
  heldForReview?: number[];
  /** Why nothing was completed — a webhook that no-ops must be able to say so. */
  reason?: string;
}

/**
 * The ticket id encoded in a branch name, for the two conventions BuilderForce itself
 * creates: `builderforce/task-<id>` (the platform's finalize path) and `ticket/<id>` or
 * `ticket/<id>-some-slug` (the `git_commit` tool's ticket branch).
 *
 * Deliberately strict. A human's `fix/login-bug` or `release/2026-09` must not resolve to
 * a ticket, and neither must `feature/123-whatever` — a leading number in an unrecognised
 * namespace is a coincidence, not an identity. PURE, so the conventions are pinned by
 * tests rather than by whichever payload was in front of the author.
 */
export function taskIdFromBranch(branch: string | null | undefined): number | null {
  if (!branch) return null;
  const trimmed = branch.trim().replace(/^refs\/heads\//, '');
  const match = /^(?:builderforce\/task-|ticket\/)(\d+)(?:-.*)?$/.exec(trimmed);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * The delta tickets, among `candidateIds`, that this merge is entitled to complete:
 * in the given tenant + project, sitting in `in_review`, and named by a `work_deltas`
 * row. One query, so a PR carrying several candidate ids costs one round trip.
 */
async function eligibleDeltaTickets(
  db: Db,
  tenantId: number,
  projectId: number,
  candidateIds: number[],
): Promise<number[]> {
  if (candidateIds.length === 0) return [];
  const rows = await db
    .selectDistinct({ id: tasks.id })
    .from(tasks)
    .innerJoin(workDeltas, eq(workDeltas.taskId, tasks.id))
    .where(
      and(
        inArray(tasks.id, candidateIds),
        eq(tasks.tenantId, tenantId),
        eq(tasks.projectId, projectId),
        eq(tasks.status, TaskStatus.IN_REVIEW),
        eq(workDeltas.tenantId, tenantId),
      ),
    );
  return rows.map((r) => r.id);
}

/**
 * The merged repo's `project_repositories` row (its id and stored default branch) plus every
 * sibling repo's default branch, in ONE query. `repo` is null when the project has no row for
 * `repoFullName` — then no branch can be attributed to a repository and branch matching is
 * skipped (fail closed).
 */
async function projectRepoScope(
  db: Db, tenantId: number, projectId: number, repoFullName: string,
): Promise<{ repo: { id: string; defaultBranch: string | null; isProjectDefault: boolean } | null; allDefaultBranches: string[] }> {
  const [owner, repo, ...rest] = repoFullName.split('/');
  const rows = await db
    .select({
      id: projectRepositories.id, owner: projectRepositories.owner, repo: projectRepositories.repo,
      defaultBranch: projectRepositories.defaultBranch, isDefault: projectRepositories.isDefault,
    })
    .from(projectRepositories)
    .where(and(eq(projectRepositories.tenantId, tenantId), eq(projectRepositories.projectId, projectId)));
  const merged = owner && repo && !rest.length
    ? rows.find((r) => r.owner === owner && r.repo === repo)
    : undefined;
  return {
    repo: merged
      ? {
        id: merged.id,
        defaultBranch: merged.defaultBranch?.trim() || null,
        isProjectDefault: merged.isDefault || rows.length === 1,
      }
      : null,
    allDefaultBranches: rows.flatMap((r) => (r.defaultBranch?.trim() ? [r.defaultBranch.trim()] : [])),
  };
}

/**
 * Candidate ticket ids for a merged PR, most trustworthy first: the `task_id` this
 * platform already recorded against the PR row, then the id its branch name encodes,
 * then the tickets whose recorded working branch IS the head branch. All exact
 * identities — see the module header for why nothing softer is used.
 */
async function candidateTaskIds(
  db: Db,
  tenantId: number,
  projectId: number,
  pr: MergedPullRequestRef,
): Promise<{ ids: number[]; ambiguousBranchTickets: number[] }> {
  const ids = new Set<number>();

  if (pr.number != null) {
    const rows = await db
      .select({ taskId: pullRequests.taskId })
      .from(pullRequests)
      .where(
        and(
          eq(pullRequests.tenantId, tenantId),
          eq(pullRequests.projectId, projectId),
          eq(pullRequests.number, pr.number),
          eq(pullRequests.provider, pr.provider ?? 'github'),
        ),
      );
    for (const row of rows) if (row.taskId != null) ids.add(row.taskId);
  }

  const fromBranch = taskIdFromBranch(pr.branchName);
  if (fromBranch != null) ids.add(fromBranch);

  // A delta whose run left its change on ANY other branch, merged by a PR that names no
  // ticket: join the head branch to the branch the platform recorded for the ticket.
  //
  // SCOPED TO THE MERGED REPOSITORY (a branch name is only unique within one repo), never a
  // base / default / long-lived branch, and never when MORE THAN ONE ticket records it: the
  // merge cannot say which of them it shipped, and a wrongly-closed ticket is invisible
  // while an open one is merely stale.
  const scope = await projectRepoScope(db, tenantId, projectId, pr.repoFullName);
  let ambiguousBranchTickets: number[] = [];
  if (scope.repo) {
    const defaultBranch = pr.defaultBranch?.trim() || scope.repo.defaultBranch;
    const onBranch = await ticketIdsOnBranch(db, tenantId, projectId, pr.branchName, defaultBranch, {
      repoId: scope.repo.id, isProjectDefault: scope.repo.isProjectDefault, allDefaultBranches: scope.allDefaultBranches,
    });
    if (onBranch.length === 1) ids.add(onBranch[0]!);
    else if (onBranch.length > 1) {
      ambiguousBranchTickets = onBranch;
      console.warn(
        `[delta-merge] ${pr.repoFullName} branch '${pr.branchName}' is recorded by ${onBranch.length} tickets `
        + `(${onBranch.join(', ')}); completing none of them by branch`,
      );
    }
  }

  return { ids: [...ids], ambiguousBranchTickets };
}

/**
 * Close the delta tickets a merged pull request shipped. Best-effort and fail-closed:
 * anything it cannot establish leaves every ticket exactly where it was, with a reason.
 */
export async function completeDeltaTicketsOnMerge(
  env: Env,
  db: Db,
  pr: MergedPullRequestRef,
): Promise<DeltaMergeOutcome> {
  const link = await resolveRepoLink(db, pr.repoFullName);
  if (!link) return { completed: [], reason: `no project linked to repo '${pr.repoFullName}'` };
  // The repo link can name a tenant without a project (a connected repo not yet
  // attached to one). Project scope is one of the three conditions a candidate has to
  // clear, so without it there is nothing to check against and nothing is touched.
  const projectId = link.projectId;
  if (projectId == null) {
    return { completed: [], reason: `repo '${pr.repoFullName}' is linked to a tenant but not to a project` };
  }

  const { ids: candidates, ambiguousBranchTickets } = await candidateTaskIds(db, link.tenantId, projectId, pr);
  if (candidates.length === 0) {
    if (ambiguousBranchTickets.length > 0) {
      return { completed: [], reason: `the merged head branch '${pr.branchName}' is recorded by ${ambiguousBranchTickets.length} tickets (${ambiguousBranchTickets.join(', ')}), so the merge cannot say which it shipped; none was completed` };
    }
    return { completed: [], reason: 'the merged pull request names no ticket (no recorded task_id, and its branch is neither a ticket branch nor any ticket\'s recorded working branch)' };
  }

  const eligible = await eligibleDeltaTickets(db, link.tenantId, projectId, candidates);
  if (eligible.length === 0) {
    return { completed: [], reason: 'no delta ticket awaiting review matched the merged pull request' };
  }

  const completed: number[] = [];
  const heldForReview: number[] = [];
  for (const taskId of eligible) {
    // No actor: a merge webhook has no user, and the completion path falls back to the
    // agent whose run produced the work rather than stamping it anonymous. THROUGH THE
    // REVIEW GATE (1153): a merge is automation, so a human-gated review lane holds unless
    // the workspace lets the manager close reviewed tickets.
    const close = await closeTicketAutomatically(env, db, { tenantId: link.tenantId, taskId, source: 'delta_merge' });
    (close.closed ? completed : heldForReview).push(taskId);
  }
  if (heldForReview.length === 0) return { completed };
  return {
    completed,
    heldForReview,
    ...(completed.length === 0
      ? { reason: 'the merge is recorded; the matched delta ticket waits in review because this board\'s review lane needs a person and the workspace has not let the manager close reviewed tickets' }
      : {}),
  };
}
