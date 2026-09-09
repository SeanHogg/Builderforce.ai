/**
 * ticketPendingChangesPort — gather the facts {@link decideTicketPendingChanges}
 * judges, for one ticket or for a bounded set of them.
 *
 * Split from the decision on purpose: the rule is pure and exhaustively tested
 * without a provider, and everything that can fail slowly — a repo resolve, a
 * credential decrypt, a provider round trip — lives here behind a cache.
 *
 * ── HOW THE N+1 IS AVOIDED ───────────────────────────────────────────────────────
 * The naive shape is one provider call per ticket, which is precisely the loop that
 * exhausted a VSIX session's context by hand. Three things keep the real cost small:
 *
 *   1. ONE batched `pull_requests` read for the whole set — never per ticket.
 *   2. A DB-only PREFILTER. A ticket with no branch, or whose PR is `merged`,
 *      is decided by rules 1 and 2 of the decision function without any network at
 *      all. On this repo that takes 100+ branches down to ~14 candidates.
 *   3. Candidates are resolved with BOUNDED concurrency and each answer is cached.
 *
 * ── WHY A TTL AND NOT A VERSION TOKEN ────────────────────────────────────────────
 * The canonical pattern here is `getCacheVersion` + bump-on-write, which is right
 * when WE are the only writer. A git branch is not that: a human pushing from their
 * laptop, a force-push, or a merge performed on the provider's web UI all move the
 * branch without any write of ours to hang a bump on, so a version token would pin a
 * stale answer indefinitely and there would be no event that ever cleared it. A
 * short TTL is the honest bound on freshness for state we do not own. The window is
 * deliberately small because the expensive, wrong answer is "this ticket is clean".
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { pullRequests } from '../../infrastructure/database/schema';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { listBranchCommits } from '../repos/branchLifecycle';
import { resolveTicketRepoContext } from '../repos/commitFileAsPendingChange';
import { normalizeTaskPrState, type TaskProgressPrState } from './taskProgressBreakdown';
import { decideTicketPendingChanges, type TicketPendingChanges } from './ticketPendingChanges';

/**
 * How long a branch comparison is trusted. Short, because the costly error is a
 * false "clean": five minutes bounds how long a ticket can misreport its delivery
 * state, while still collapsing a board render (and a model's fan-out over the same
 * board) into one provider call per branch.
 */
const BRANCH_STATE_TTL_SECONDS = 300;

/**
 * Provider calls in flight at once. The work is IO-bound so some parallelism pays,
 * but a Worker request must not open 100 sockets at a provider that rate-limits —
 * and a batch is capped at {@link MAX_TICKETS_PER_BATCH} anyway.
 */
const MAX_CONCURRENT_BRANCH_READS = 6;

/**
 * Tickets one batch will inspect. A caller asking about more than this is asking a
 * different question (a portfolio sweep, not a board read) and should page. The cap
 * is on CANDIDATES, so a project with a thousand clean tickets still answers fully.
 */
export const MAX_TICKETS_PER_BATCH = 40;

/** The minimum a caller must know about a ticket to ask this question. */
export interface TicketDeliveryRef {
  taskId: number;
  /** `tasks.gitBranch`. Null/absent falls back to the conventional ticket branch. */
  gitBranch?: string | null;
}

/** One ticket's answer, keyed back to its id. */
export interface TicketPendingChangesResult extends TicketPendingChanges {
  taskId: number;
}

/** Run `worker` over `items` with at most `limit` in flight. Order is not preserved;
 *  every caller here keys results by taskId rather than by position. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results.push(await worker(items[index]!));
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * The recorded PR state for every task in `taskIds`, as ONE query.
 *
 * A task can carry more than one `pull_requests` row over its life (a reopened
 * ticket gets a second PR). `tasks.get` resolves that by taking the most recently
 * updated row, and this must not disagree with it, so the same rule is applied here
 * — last write wins — rather than inventing a second notion of "the" PR.
 */
async function readPrStates(
  db: Db,
  tenantId: number,
  taskIds: readonly number[],
): Promise<Map<number, TaskProgressPrState>> {
  const states = new Map<number, TaskProgressPrState>();
  if (taskIds.length === 0) return states;

  const rows = await db
    .select({
      taskId: pullRequests.taskId,
      status: pullRequests.status,
      updatedAt: pullRequests.updatedAt,
    })
    .from(pullRequests)
    .where(and(
      eq(pullRequests.tenantId, tenantId),
      inArray(pullRequests.taskId, [...taskIds]),
    ));

  const newest = new Map<number, Date>();
  for (const row of rows) {
    if (row.taskId == null) continue;
    const seen = newest.get(row.taskId);
    if (seen && seen >= row.updatedAt) continue;
    newest.set(row.taskId, row.updatedAt);
    states.set(row.taskId, normalizeTaskPrState(row.status));
  }
  return states;
}

/**
 * Compare one ticket's branch against its base, through the cache.
 *
 * Returns a verdict for EVERY input — a ticket with no repo bound, an unreadable
 * credential or an unsupported provider comes back `unknown` with the reason
 * attached, never as an exception and never as `none`.
 */
async function readOne(
  env: Env,
  db: Db,
  secret: string,
  tenantId: number,
  ref: TicketDeliveryRef,
  prState: TaskProgressPrState,
): Promise<TicketPendingChangesResult> {
  const resolved = await resolveTicketRepoContext(db, secret, tenantId, ref.taskId).catch(
    (error: unknown) => ({ ok: false as const, reason: error instanceof Error ? error.message : 'repo resolve failed' }),
  );
  if (!resolved.ok) {
    return {
      taskId: ref.taskId,
      ...decideTicketPendingChanges({
        branch: ref.gitBranch ?? null,
        defaultBranch: null,
        prState,
        // No repo to compare against is not a clean branch — it is an unknown one.
        commits: { ok: false, code: 'unsupported', reason: resolved.reason },
      }),
    };
  }

  const ctx = resolved.ctx;
  const commits = await getOrSetCached(
    env,
    `ticket_branch_ahead:${tenantId}:${ctx.repoId}:${ctx.base}:${ctx.branch}`,
    () => listBranchCommits({
      provider: ctx.provider,
      host: ctx.host,
      owner: ctx.owner,
      repo: ctx.repo,
      token: ctx.token,
      base: ctx.base,
      branch: ctx.branch,
    }),
    { kvTtlSeconds: BRANCH_STATE_TTL_SECONDS },
  );

  return {
    taskId: ref.taskId,
    ...decideTicketPendingChanges({
      branch: ctx.branch,
      defaultBranch: ctx.base,
      prState,
      commits,
    }),
  };
}

/**
 * Answer "does this ticket have unlanded code?" for a set of tickets.
 *
 * Every input id appears exactly once in the output. Tickets past
 * {@link MAX_TICKETS_PER_BATCH} candidates are answered `unknown` with a reason
 * naming the cap, rather than silently dropped — a missing row would read as
 * "clean" to any caller that indexes by id.
 */
export async function readPendingChangesForTickets(
  env: Env,
  db: Db,
  secret: string,
  tenantId: number,
  refs: readonly TicketDeliveryRef[],
): Promise<Map<number, TicketPendingChangesResult>> {
  const out = new Map<number, TicketPendingChangesResult>();
  if (refs.length === 0) return out;

  const prStates = await readPrStates(db, tenantId, refs.map((r) => r.taskId));

  // Prefilter: everything the pure rule can settle from DB facts alone is settled
  // here, with no network. Only what is genuinely undecidable becomes a candidate.
  const candidates: TicketDeliveryRef[] = [];
  for (const ref of refs) {
    const prState = prStates.get(ref.taskId) ?? 'none';
    const branch = (ref.gitBranch ?? '').trim();
    if (!branch || prState === 'merged') {
      out.set(ref.taskId, {
        taskId: ref.taskId,
        ...decideTicketPendingChanges({ branch, defaultBranch: null, prState, commits: null }),
      });
      continue;
    }
    candidates.push(ref);
  }

  const inspected = candidates.slice(0, MAX_TICKETS_PER_BATCH);
  for (const ref of candidates.slice(MAX_TICKETS_PER_BATCH)) {
    out.set(ref.taskId, {
      taskId: ref.taskId,
      ...decideTicketPendingChanges({
        branch: ref.gitBranch ?? null,
        defaultBranch: null,
        prState: prStates.get(ref.taskId) ?? 'none',
        commits: {
          ok: false,
          code: 'provider_error',
          reason: `more than ${MAX_TICKETS_PER_BATCH} tickets needed a branch comparison in one request — narrow the query and ask again`,
        },
      }),
    });
  }

  const results = await mapWithConcurrency(inspected, MAX_CONCURRENT_BRANCH_READS, (ref) =>
    readOne(env, db, secret, tenantId, ref, prStates.get(ref.taskId) ?? 'none'));
  for (const result of results) out.set(result.taskId, result);

  return out;
}

/** One ticket's delivery state. Thin wrapper over the batch so both paths share
 *  exactly one implementation (and one cache key shape). */
export async function readTicketPendingChanges(
  env: Env,
  db: Db,
  secret: string,
  tenantId: number,
  ref: TicketDeliveryRef,
): Promise<TicketPendingChanges> {
  const batch = await readPendingChangesForTickets(env, db, secret, tenantId, [ref]);
  const found = batch.get(ref.taskId);
  if (found) {
    const { taskId: _taskId, ...rest } = found;
    return rest;
  }
  // Unreachable — the batch answers every input — but a missing row must never
  // degrade to a fabricated "clean" verdict.
  return decideTicketPendingChanges({
    branch: ref.gitBranch ?? null,
    defaultBranch: null,
    prState: 'none',
    commits: { ok: false, code: 'provider_error', reason: 'delivery state could not be resolved' },
  });
}
