/**
 * laneOrdinals — the cached "where does this lane sit on its board" map.
 *
 * One read-through cache per project: lane key → {position, isTerminal, isParking}.
 * The ticket-lifecycle recorder derives a move's DIRECTION from it (a lower position
 * is a redo), the ticket-context read derives %-complete from it (lane N of M), and
 * the board is slow-changing — so both read one cached layout instead of re-joining
 * boards + swimlanes on every ticket PATCH.
 *
 * A cache that is never invalidated is a lie for its whole TTL. Every lane WRITER
 * (seed, create, rename, template apply, delete — REST and Brain tool alike) calls
 * one of the two invalidators below; a writer that only knows the board id uses
 * {@link invalidateBoardLaneOrdinals}, which resolves the owning project so the
 * writer does not have to know how the cache is keyed.
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { boards, swimlanes } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';

export type LaneInfo = {
  position: number;
  isTerminal: boolean;
  /** PARKED — off the delivery path (`swimlanes.is_parking`, migration 1080). Optional so
   *  a caller building an OrdinalMap by hand (tests, a non-board status) need not know
   *  about it; absent reads as "not parked". */
  isParking?: boolean;
};
export type OrdinalMap = Record<string, LaneInfo>;

function ordinalsCacheKey(projectId: number): string {
  return `swimlane-ordinals:project:${projectId}`;
}

/** Per-project lane-key → {position, isTerminal} map, cached (board layout is
 *  slow-changing). Empty object when the project has no board yet (free-form
 *  status with no swimlane → direction undeterminable, recorded as null). */
export async function loadLaneOrdinals(env: Env, db: Db, projectId: number): Promise<OrdinalMap> {
  return getOrSetCached(env, ordinalsCacheKey(projectId), async () => {
    const rows = await db
      .select({
        key: swimlanes.key, position: swimlanes.position,
        isTerminal: swimlanes.isTerminal, isParking: swimlanes.isParking,
      })
      .from(swimlanes)
      .innerJoin(boards, eq(boards.id, swimlanes.boardId))
      .where(eq(boards.projectId, projectId));
    const map: OrdinalMap = {};
    for (const r of rows) map[r.key] = { position: r.position, isTerminal: r.isTerminal, isParking: r.isParking };
    return map;
  });
}

/** Call when a project's swimlanes change so the cached ordinal map re-loads. */
export async function invalidateSwimlaneOrdinals(env: Env | undefined, projectId: number): Promise<void> {
  // The cache helper reads `env?.AUTH_CACHE_KV` and treats a missing binding as
  // "nothing to invalidate" (the Brain tool context carries no Worker env), so the
  // bridge is one assertion here — the same one `hiring/pipeline.invalidatePipeline` makes.
  await invalidateCached(env as Env, ordinalsCacheKey(projectId));
}

/**
 * The same invalidation for a writer that holds the BOARD id — every lane route and
 * the Brain's swimlane tools. Resolves the owning project; a board with no project
 * has no cached map to drop.
 */
export async function invalidateBoardLaneOrdinals(env: Env | undefined, db: Db, boardId: string): Promise<void> {
  const [board] = await db
    .select({ projectId: boards.projectId })
    .from(boards)
    .where(eq(boards.id, boardId))
    .limit(1);
  if (board?.projectId != null) await invalidateSwimlaneOrdinals(env, board.projectId);
}
