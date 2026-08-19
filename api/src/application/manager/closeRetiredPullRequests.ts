/**
 * closeRetiredPullRequests — the ACT on the pile the merge queue creates by design.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────
 * Retiring a pull request to a human is the correct end for a branch the manager cannot
 * merge: it converts an invisible livelock into visible work. The manager already RANKS
 * that pile by the business value of the ticket each PR would deliver, and already flags
 * the rows whose ticket is finished — those PRs are litter, because the work landed
 * another way and the branch is all that is left.
 *
 * Measured on project 11: the pile went 49 → 52 → 72 → 75 across two days against 381
 * open PRs. Its GENERATOR was fixed in 2026.7.198, which stops the growth and clears
 * none of the ones already there. A reader could see exactly which PRs mattered and
 * still had to close every one of them by hand, on the provider, one at a time.
 *
 * ── WHY "TICKET ALREADY DONE" IS THE ONLY BULK CRITERION ─────────────────────────
 * Bulk-closing pull requests is destructive and irreversible from the platform's side,
 * so the criterion has to be one a person would reach the same conclusion from without
 * opening the branch. "The ticket this PR was for is finished" is that: the deliverable
 * exists, the board has moved on, and nothing downstream is waiting on this branch. Any
 * other blocked PR — a conflict, a red build, a withheld merge — is a judgement about
 * unfinished work and belongs to a human one at a time. So this use case takes explicit
 * PR ids AND re-verifies the done-ness server-side; a stale client list cannot close a
 * PR whose ticket has since reopened.
 *
 * ── THE PROVIDER IS THE SOURCE OF TRUTH ──────────────────────────────────────────
 * Each close is a real provider call ({@link closePullRequest}, which covers GitHub /
 * GitLab / Bitbucket). Our row is only marked closed when the provider agreed, EXCEPT
 * for `not_found` — a PR the provider does not have is one our row is simply wrong
 * about, and leaving that row open would keep it in the pile forever. A PR the provider
 * reports as already MERGED is never touched and never mis-recorded: it is reconciled to
 * `merged`, because that is what it is.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { projectRepositories, pullRequests, tasks } from '../../infrastructure/database/schema';
import { closePullRequest } from '../repos/branchLifecycle';
import { markPullRequestClosedById, markPullRequestMergedById } from '../repos/recordPullRequestRow';
import { isResolveError, resolveRepoCredential } from '../repos/resolveRepoCredential';
import { recordManagerAction } from './managerActionJournal';
import { TaskStatus } from '../../domain/shared/types';

/** Journalled action type for a human-triggered bulk retirement close. Deliberately NOT
 *  one of `PR_ACTION_TYPES`: those are counted by the merge loop's ceilings and used to
 *  order its rotation, and a human's close is neither an attempt the manager made nor a
 *  reason to re-rank what it works next. */
export const PR_RETIRED_CLOSED_ACTION = 'pr_retired_closed';

/**
 * How many PRs one request may close. Each is a provider round-trip, and the Worker has
 * a hard subrequest ceiling — a request that tries to close the whole pile would be
 * evicted partway through with no record of how far it got. Twenty-five clears a
 * seventy-five-PR pile in three presses while staying comfortably inside the budget.
 */
export const MAX_BULK_CLOSE = 25;

export type CloseSkipReason =
  /** The PR row is not open — nothing to close. */
  | 'not_open'
  /** Its ticket is not finished, so this is a judgement call, not litter. */
  | 'ticket_not_done'
  /** No repo/credential to reach the provider with. */
  | 'no_credential'
  /** The provider says it is already merged — reconciled to `merged`, not closed. */
  | 'already_merged'
  /** The provider refused. */
  | 'provider_error';

export interface CloseRetiredResult {
  closed: number;
  /** PR row ids that were closed, for the caller's optimistic list update. */
  closedIds: string[];
  skipped: Array<{ id: string; number: number | null; reason: CloseSkipReason; detail?: string }>;
  /** True when the caller asked for more than {@link MAX_BULK_CLOSE} and the tail was
   *  not attempted. Surfaced, never silent — a partial bulk action that reports success
   *  is how a pile looks cleared and is not. */
  truncated: boolean;
}

/** Rows this use case needs, resolved in ONE query — never a lookup per PR. */
interface Candidate {
  id: string;
  number: number | null;
  provider: string;
  repoId: string | null;
  status: string;
  taskStatus: string | null;
}

/**
 * Close the retired pull requests whose ticket is already done.
 *
 * `prIds` is the caller's explicit selection; every one of them is re-verified here, so
 * this is never "close everything that currently looks closable" — a list the operator
 * saw ten minutes ago cannot close a PR that has become live since.
 */
export async function closeRetiredPullRequests(
  env: Env,
  db: Db,
  args: { tenantId: number; projectId: number; prIds: readonly string[]; actorId?: string | null },
): Promise<CloseRetiredResult> {
  const out: CloseRetiredResult = { closed: 0, closedIds: [], skipped: [], truncated: false };
  const requested = [...new Set(args.prIds.filter((id) => typeof id === 'string' && id.length > 0))];
  if (requested.length === 0) return out;

  const ids = requested.slice(0, MAX_BULK_CLOSE);
  out.truncated = requested.length > ids.length;

  const candidates: Candidate[] = await db
    .select({
      id: pullRequests.id,
      number: pullRequests.number,
      provider: pullRequests.provider,
      repoId: pullRequests.repoId,
      status: pullRequests.status,
      taskStatus: tasks.status,
    })
    .from(pullRequests)
    .leftJoin(tasks, eq(tasks.id, pullRequests.taskId))
    .where(and(
      eq(pullRequests.tenantId, args.tenantId),
      eq(pullRequests.projectId, args.projectId),
      inArray(pullRequests.id, ids),
    ));

  // One credential resolution per REPO, not per PR: a pile of twenty-five PRs is
  // typically one repository, and resolving per row would decrypt the same credential
  // twenty-five times inside a request that is already subrequest-bound.
  const credentialCache = new Map<string, Awaited<ReturnType<typeof resolveRepoCredential>>>();
  const secret = env.JWT_SECRET ?? '';

  for (const pr of candidates) {
    if (pr.status !== 'open' && pr.status !== 'draft') {
      out.skipped.push({ id: pr.id, number: pr.number, reason: 'not_open' });
      continue;
    }
    // RE-VERIFIED server-side. The client's flag is a hint about what to offer; this is
    // the gate. A ticket reopened since the list was rendered keeps its branch.
    if (pr.taskStatus !== TaskStatus.DONE) {
      out.skipped.push({ id: pr.id, number: pr.number, reason: 'ticket_not_done' });
      continue;
    }
    if (!pr.repoId || pr.number == null) {
      out.skipped.push({ id: pr.id, number: pr.number, reason: 'no_credential', detail: 'the PR row has no repository or provider number' });
      continue;
    }

    if (!credentialCache.has(pr.repoId)) {
      credentialCache.set(pr.repoId, await resolveRepoCredential(db, secret, args.tenantId, pr.repoId));
    }
    const resolved = credentialCache.get(pr.repoId)!;
    if (isResolveError(resolved)) {
      out.skipped.push({ id: pr.id, number: pr.number, reason: 'no_credential', detail: resolved.error });
      continue;
    }

    const result = await closePullRequest({
      provider: resolved.repo.provider,
      host: resolved.repo.host,
      owner: resolved.repo.owner,
      repo: resolved.repo.repo,
      token: resolved.token,
      number: pr.number,
    });

    if (result.ok) {
      await markPullRequestClosedById(db, pr.id, args.tenantId);
      out.closed += 1;
      out.closedIds.push(pr.id);
      continue;
    }
    if (result.code === 'already_merged') {
      // Not a failure — our row was wrong. Recording it as merged is what stops it
      // reappearing in the pile on the next read.
      await markPullRequestMergedById(db, pr.id, args.tenantId);
      out.skipped.push({ id: pr.id, number: pr.number, reason: 'already_merged' });
      continue;
    }
    if (result.code === 'not_found') {
      // The provider does not have this PR. Our row is stale, and leaving it open keeps
      // it in the pile forever — which is the same bookkeeping drift `reconcile_pr`
      // exists to correct, reached from the other direction.
      await markPullRequestClosedById(db, pr.id, args.tenantId);
      out.closed += 1;
      out.closedIds.push(pr.id);
      continue;
    }
    out.skipped.push({ id: pr.id, number: pr.number, reason: 'provider_error', detail: result.reason });
  }

  // Ids the caller asked for that matched no row in this project — reported rather than
  // silently dropped, so a count that does not add up is explicable.
  const seen = new Set(candidates.map((c) => c.id));
  for (const id of ids) {
    if (!seen.has(id)) out.skipped.push({ id, number: null, reason: 'not_open', detail: 'no such pull request in this project' });
  }

  if (out.closed > 0) {
    await recordManagerAction(db, {
      tenantId: args.tenantId,
      projectId: args.projectId,
      actionType: PR_RETIRED_CLOSED_ACTION,
      summary: `Closed ${out.closed} retired pull request${out.closed === 1 ? '' : 's'} whose ticket was already done.`,
      detail: { closed: out.closedIds, skipped: out.skipped, actorId: args.actorId ?? null },
    });
  }
  return out;
}

/** Repos referenced by a project's PR rows — used by the route to fail fast with a
 *  useful message when a project has no connected repository at all. */
export async function projectHasRepository(db: Db, tenantId: number, projectId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: projectRepositories.id })
    .from(projectRepositories)
    .where(and(eq(projectRepositories.tenantId, tenantId), eq(projectRepositories.projectId, projectId)))
    .limit(1);
  return !!row;
}
