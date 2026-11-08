/**
 * The facts `routeLaneEntry` needs to pick an engine for a lane - the canonical board, its lanes and the runtimes staffed on each -
 * behind the read-through cache, keyed per PROJECT (the router's input) so a sweep routing hundreds of tickets reads one project's
 * board once, not once per ticket.
 *
 * Cache on read, invalidate on write: every lane writer already calls `invalidateSwimlaneOrdinals` (laneOrdinals.ts), and every lane
 * staffing writer already calls `publishLaneStaffingChanged` (boardChangePublisher.ts); both drop this entry through
 * {@link invalidateLaneRouting}; board update / delete / re-pin do too (boardWrites.ts, findOrCreateBoard.ts). The short TTL is the
 * backstop for a writer that bypasses them.
 *
 * The key carries the tenant (`lane-routing:<tenantId>:<projectId>`), so one tenant's read can never be served another's entry; the
 * entry still carries its own `tenantId` as a belt-and-braces check.
 */
import { eq } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { swimlanes } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { findCanonicalBoard } from './canonicalBoard';
import { forLanes, laneAgentAssignments } from './laneAgentAssignments';
import type { LaneShape } from './laneCoordinatorEntry';

export interface RoutingLane extends LaneShape {
  id: string;
  key: string;
  gate: string | null;
  isTerminal: boolean;
  /** The runtime of each agent staffed on the lane. */
  runtimes: Array<string | null>;
}

export interface LaneRouting {
  tenantId: number;
  boardId: string;
  /** A lifecycle-managed board is driven by the manager state machine, never the coordinator (laneCoordinatorEntry.ts). */
  lifecycleManaged: boolean;
  lanes: RoutingLane[];
}

const CACHE = { kvTtlSeconds: 60, l1TtlMs: 10_000 };
const routingKey = (tenantId: number, projectId: number): string => `lane-routing:${tenantId}:${projectId}`;

/** Drop a project's cached routing facts. Call from every lane, lane-staffing and board writer. */
export async function invalidateLaneRouting(env: Env | undefined, tenantId: number, projectId: number): Promise<void> {
  await invalidateCached(env, routingKey(tenantId, projectId));
}

/** The project's canonical board with its lanes and per-lane runtimes (3 statements on a miss, none on a hit); null when it has no board. */
export async function readLaneRouting(env: Env, db: Db, tenantId: number, projectId: number): Promise<LaneRouting | null> {
  const cached = await getOrSetCached<LaneRouting | null>(env, routingKey(tenantId, projectId), async () => {
    const board = await findCanonicalBoard(db, projectId, tenantId);
    if (!board) return null;
    const lanes = await db
      .select({
        id: swimlanes.id, key: swimlanes.key, gate: swimlanes.gate, isTerminal: swimlanes.isTerminal,
        successPolicy: swimlanes.successPolicy, successThreshold: swimlanes.successThreshold,
        actionType: swimlanes.actionType, executionMode: swimlanes.executionMode,
      })
      .from(swimlanes)
      .where(eq(swimlanes.boardId, board.id));
    const staffed = lanes.length === 0 ? [] : await db
      .select({ laneId: laneAgentAssignments.scopeId, runtime: laneAgentAssignments.runtime })
      .from(laneAgentAssignments)
      // Tenant-scoped as well as lane-scoped: the lanes came from a tenant-scoped board read, but the isolation predicate belongs
      // on the query that reads a tenant-owned table.
      .where(scopedToTenant(laneAgentAssignments, tenantId, forLanes(lanes.map((l) => l.id))));
    const runtimesByLane = new Map<string, Array<string | null>>();
    for (const row of staffed) runtimesByLane.set(String(row.laneId), [...(runtimesByLane.get(String(row.laneId)) ?? []), row.runtime]);
    return { tenantId, boardId: board.id, lifecycleManaged: board.lifecycleManaged === true, lanes: lanes.map((l) => ({ ...l, runtimes: runtimesByLane.get(l.id) ?? [] })) };
  }, CACHE);
  return cached && cached.tenantId === tenantId ? cached : null;
}
