/**
 * ticketBuildStatus — "is the build red on this ticket?", for a whole board at once.
 *
 * ── ONE QUERY, NOT ONE PER CARD ──────────────────────────────────────────────────
 * The board renders hundreds of cards from a single `GET /api/tasks`, so the badge this
 * feeds has to arrive with that list. A per-card read would be an N+1 on the most-loaded
 * read path the product has; this is one indexed scan of `pull_requests` over the ids the
 * list already resolved, ordered newest-first so the domain's "the open PR speaks for the
 * ticket" rule (see `domain/task/buildStatus.ts`) can be applied in memory.
 *
 * ── WHY IT IS NOT CACHED ─────────────────────────────────────────────────────────
 * It is not an endpoint. It is a projection folded into a read that is already cached (or
 * deliberately not) by its own route, and it carries the FRESHEST fact on the card: a red
 * build is written by a CI webhook seconds after a push, and a badge that lags its own
 * ticket list would be worse than no badge. Caching it separately would also give one card
 * two different ages of truth in the same render.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { pullRequests } from '../../infrastructure/database/schema';
import {
  deriveBuildStatusFromRows, type TicketBuildStatus,
} from '../../domain/task/buildStatus';

/**
 * Per-ticket build verdicts for `taskIds`, in one query.
 *
 * Tickets with no pull request are ABSENT from the map rather than present as `unknown` —
 * the caller's default is the same either way, and an absent key keeps the payload small
 * on a board where most cards have no branch at all.
 *
 * Best-effort: a failure returns an empty map, so the board still renders (without
 * badges) rather than 500ing on a projection.
 */
export async function loadTicketBuildStatuses(
  db: Db,
  tenantId: number,
  taskIds: readonly number[],
): Promise<Map<number, TicketBuildStatus>> {
  if (taskIds.length === 0) return new Map();
  try {
    const rows = await db
      .select({
        taskId: pullRequests.taskId,
        status: pullRequests.status,
        buildStatus: pullRequests.buildStatus,
      })
      .from(pullRequests)
      .where(and(
        eq(pullRequests.tenantId, tenantId),
        inArray(pullRequests.taskId, [...taskIds]),
      ))
      // NEWEST FIRST is load-bearing: it is the fallback the domain rule uses when a
      // ticket has no open pull request left.
      .orderBy(desc(pullRequests.updatedAt));

    const byTask = new Map<number, { status: string | null; buildStatus: string | null }[]>();
    for (const r of rows) {
      if (r.taskId == null) continue;
      const list = byTask.get(r.taskId);
      if (list) list.push(r);
      else byTask.set(r.taskId, [r]);
    }
    const out = new Map<number, TicketBuildStatus>();
    for (const [taskId, list] of byTask) {
      const verdict = deriveBuildStatusFromRows(list);
      // `unknown` is the caller's default; sending it would be a byte per card for nothing.
      if (verdict !== 'unknown') out.set(taskId, verdict);
    }
    return out;
  } catch {
    return new Map();
  }
}
