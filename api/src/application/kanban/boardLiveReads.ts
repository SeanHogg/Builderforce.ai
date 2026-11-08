/**
 * The board's LIVE roster reads — what it refetches on every realtime push:
 *  - ticket owners per lane (hosts owning open tickets; see boardTicketOwners.ts)
 *  - lane agents for EVERY lane in one query (replaces one request per lane)
 *
 * Both are cached per board under the project's live token
 * (`infrastructure/cache/boardLiveCache.ts`), which `broadcastProjectChanged` bumps — so
 * the push that tells the client to refetch has already orphaned the cached answer.
 * Each returns null when the board is not in the tenant.
 */
import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { boards, swimlanes } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { readBoardLive } from '../../infrastructure/cache/boardLiveCache';
import { laneAgentAssignments, laneJoinOn } from '../swimlane/laneAgentAssignments';
import { excludeStaffedOwners, listBoardTicketOwners, type BoardTicketOwner } from './boardTicketOwners';

async function projectIdOf(db: Db, tenantId: number, boardId: string): Promise<number | null> {
  const [row] = await db
    .select({ projectId: boards.projectId })
    .from(boards)
    .where(scopedToTenant(boards, tenantId, eq(boards.id, boardId)))
    .limit(1);
  return row?.projectId ?? null;
}

export async function readBoardTicketOwners(
  db: Db, env: Env | undefined, tenantId: number, boardId: string,
): Promise<Record<string, BoardTicketOwner[]> | null> {
  const projectId = await projectIdOf(db, tenantId, boardId);
  if (projectId == null) return null;
  return readBoardLive(env, tenantId, projectId, `owners:${boardId}`, async () => {
    // Staffed hosts already show as staffed chips: the owner read excludes them (both rosters computed here, once).
    const [owners, staffed] = await Promise.all([listBoardTicketOwners(db, tenantId, boardId), listBoardLaneAgents(db, tenantId, boardId)]);
    return excludeStaffedOwners(owners, staffed);
  });
}

type LaneAgentRow = typeof laneAgentAssignments.$inferSelect;

/** Lane staffing for every lane of the board, keyed by swimlane id — ONE query. */
export async function listBoardLaneAgents(
  db: Db, tenantId: number, boardId: string,
): Promise<Record<string, LaneAgentRow[]>> {
  const rows = await db
    .select({ assignment: laneAgentAssignments })
    .from(laneAgentAssignments)
    .innerJoin(swimlanes, laneJoinOn(swimlanes.id))
    .where(and(eq(swimlanes.boardId, boardId), eq(laneAgentAssignments.tenantId, tenantId), eq(swimlanes.tenantId, tenantId)))
    .orderBy(asc(laneAgentAssignments.position));
  const byLane: Record<string, LaneAgentRow[]> = {};
  for (const { assignment } of rows) (byLane[assignment.scopeId as string] ??= []).push(assignment);
  return byLane;
}

export async function readBoardLaneAgents(
  db: Db, env: Env | undefined, tenantId: number, boardId: string,
): Promise<Record<string, LaneAgentRow[]> | null> {
  const projectId = await projectIdOf(db, tenantId, boardId);
  if (projectId == null) return null;
  return readBoardLive(env, tenantId, projectId, `lane-agents:${boardId}`, () => listBoardLaneAgents(db, tenantId, boardId));
}

/** One lane's staffed agents, served from the same cached board read (same rows the per-lane endpoint used to return); null when the board is not in the tenant. */
export async function readLaneAgents(
  db: Db, env: Env | undefined, tenantId: number, boardId: string, laneId: string,
): Promise<LaneAgentRow[] | null> {
  const byLane = await readBoardLaneAgents(db, env, tenantId, boardId);
  return byLane ? (byLane[laneId] ?? []) : null;
}
