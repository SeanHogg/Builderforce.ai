/**
 * The board reads a client POLLS — a board's lanes, its ticket runs and its agent
 * dispatches — behind the read-through cache, so an idle board costs no Neon statement.
 *
 *   • lanes      — slow-changing configuration, keyed per board and dropped by the lane
 *                  writers via {@link invalidateBoardLanesCache} (they already call the
 *                  ordinals invalidators in `laneOrdinals.ts`, which now chain to it);
 *   • tickets /  — live lifecycle state, keyed on ONE per-tenant token
 *     dispatches   ({@link bumpBoardLive}) that every writer of `ticket_runs` /
 *                  `agent_dispatches` bumps (the coordinator store, the runtime claim
 *                  callbacks, the park-age sweep). The KV TTL is the backstop for a
 *                  writer that bypasses it.
 *
 * Each read folds the board-exists check into its main statement: a tenant-scoped join
 * returning rows proves the board is the tenant's, and only an EMPTY result pays a second
 * statement to tell "no tickets yet" from "no such board".
 */

import { and, asc, eq } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { agentDispatches, boards, swimlanes, ticketRuns } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { bumpVersion, versionToken } from '../../infrastructure/cache/versionToken';
import { LIST_ROW_CAP } from '../../domain/shared/boundedInt';
import { laneAgentAssignments } from './laneAgentAssignments';

const LANES_CACHE = { kvTtlSeconds: 300, l1TtlMs: 10_000 };
const LIVE_CACHE = { kvTtlSeconds: 120, l1TtlMs: 3_000 };

const lanesKey = (tenantId: number, boardId: string): string => `board-lanes:${tenantId}:${boardId}`;
const liveVersionKey = (tenantId: number): string => `board-live-version:${tenantId}`;

/** Orphan a board's cached lane list. Call from every lane writer. */
export async function invalidateBoardLanesCache(env: Env | undefined, tenantId: number, boardId: string): Promise<void> {
  await invalidateCached(env, lanesKey(tenantId, boardId));
}

/** A ticket run or an agent dispatch of this tenant changed. `env` defaults to the ambient request scope. */
export function bumpBoardLive(tenantId: number, env?: Env): Promise<void> {
  return bumpVersion(liveVersionKey(tenantId), 'bumpBoardLive', env);
}

async function boardExists(db: Db, tenantId: number, boardId: string): Promise<boolean> {
  const [board] = await db.select({ id: boards.id }).from(boards).where(and(eq(boards.id, boardId), eq(boards.tenantId, tenantId)));
  return Boolean(board);
}

/** The board's lanes in display order, or null when the board is not the tenant's. One statement. */
export function readBoardLanes(env: Env, db: Db, tenantId: number, boardId: string) {
  return getOrSetCached(env, lanesKey(tenantId, boardId), async () => {
    const rows = await db
      .select({ lane: swimlanes })
      .from(boards)
      .leftJoin(swimlanes, and(eq(swimlanes.boardId, boards.id), eq(swimlanes.tenantId, tenantId)))
      .where(and(eq(boards.id, boardId), eq(boards.tenantId, tenantId)))
      .orderBy(asc(swimlanes.position))
      .limit(LIST_ROW_CAP);
    if (rows.length === 0) return null;
    return rows.flatMap((r) => (r.lane ? [r.lane] : []));
  }, LANES_CACHE);
}

async function liveRead<T>(
  env: Env, db: Db, name: string, tenantId: number, boardId: string,
  load: () => Promise<T[]>,
): Promise<T[] | null> {
  const token = await versionToken(env, liveVersionKey(tenantId));
  return getOrSetCached(env, `board-${name}:${tenantId}:${boardId}:v${token}`, async () => {
    const rows = await load();
    if (rows.length > 0) return rows;
    return (await boardExists(db, tenantId, boardId)) ? rows : null;
  }, LIVE_CACHE);
}

/**
 * The board's ticket runs, oldest first, or null for an unknown board. The columns are the
 * run's state; `stage_history` (an unbounded JSON log nothing on the board reads) stays out.
 */
export function readBoardTickets(env: Env, db: Db, tenantId: number, boardId: string) {
  return liveRead(env, db, 'tickets', tenantId, boardId, () => db
    .select({
      id: ticketRuns.id,
      tenantId: ticketRuns.tenantId,
      segmentId: ticketRuns.segmentId,
      boardId: ticketRuns.boardId,
      taskId: ticketRuns.taskId,
      currentSwimlaneId: ticketRuns.currentSwimlaneId,
      lifecycle: ticketRuns.lifecycle,
      currentWorkflowId: ticketRuns.currentWorkflowId,
      awaitingWorkflowId: ticketRuns.awaitingWorkflowId,
      branchName: ticketRuns.branchName,
      error: ticketRuns.error,
      createdAt: ticketRuns.createdAt,
      updatedAt: ticketRuns.updatedAt,
    })
    .from(ticketRuns)
    .where(and(eq(ticketRuns.boardId, boardId), eq(ticketRuns.tenantId, tenantId)))
    .orderBy(asc(ticketRuns.createdAt))
    .limit(LIST_ROW_CAP));
}

/** Live per-agent dispatch status across the board's tickets, or null for an unknown board. */
export function readBoardDispatches(env: Env, db: Db, tenantId: number, boardId: string) {
  return liveRead(env, db, 'dispatches', tenantId, boardId, () => db
    .select({
      id: agentDispatches.id,
      ticketRunId: agentDispatches.ticketRunId,
      taskId: agentDispatches.taskId,
      swimlaneId: agentDispatches.swimlaneId,
      assignmentId: agentDispatches.assignmentId,
      status: agentDispatches.status,
      role: agentDispatches.role,
      name: laneAgentAssignments.name,
      stageSeq: agentDispatches.stageSeq,
      position: agentDispatches.position,
      updatedAt: agentDispatches.updatedAt,
    })
    .from(agentDispatches)
    .innerJoin(ticketRuns, and(eq(agentDispatches.ticketRunId, ticketRuns.id), eq(ticketRuns.tenantId, tenantId)))
    .leftJoin(laneAgentAssignments, eq(agentDispatches.assignmentId, laneAgentAssignments.id))
    .where(and(eq(ticketRuns.boardId, boardId), eq(agentDispatches.tenantId, tenantId)))
    .orderBy(asc(agentDispatches.ticketRunId), asc(agentDispatches.stageSeq), asc(agentDispatches.position))
    .limit(LIST_ROW_CAP));
}
