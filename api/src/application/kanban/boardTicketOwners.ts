/**
 * BOARD TICKET OWNERS — the agent hosts that OWN open tickets on a board.
 *
 * `agent_assignments` (scope staffing: who is STAFFED on a lane/project) and
 * `tasks.assigned_agent_host_id` (who OWNS this ticket) are different facts and stay
 * separate. The board's agent roster used to come only from the first, so a host that
 * owned tickets without being staffed there vanished from the board and was never scoped
 * to it. This is the read that surfaces them — marked `via: 'ticket'` so the UI can tell
 * an owner from a staffed agent — in ONE batched query (never per lane / per ticket).
 *
 * Terminal lanes and archived tickets are excluded: a finished ticket's owner is history.
 */
import { and, count, eq, isNotNull } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { agentHosts, boards, swimlanes, tasks } from '../../infrastructure/database/schema';

/** How a roster entry reached the board: staffed (agent_assignments) vs owns a ticket. */
export type BoardAgentVia = 'assignment' | 'ticket';

export interface BoardTicketOwner {
  hostId: number;
  name: string;
  /** Open tickets this host owns in the lane. */
  ticketCount: number;
  via: 'ticket';
}

/** Owners of non-terminal tickets, keyed by swimlane id. */
export async function listBoardTicketOwners(
  db: Db,
  tenantId: number,
  boardId: string,
): Promise<Record<string, BoardTicketOwner[]>> {
  const rows = await db
    .select({
      laneId: swimlanes.id,
      hostId: agentHosts.id,
      name: agentHosts.name,
      ticketCount: count(),
    })
    .from(tasks)
    .innerJoin(boards, eq(boards.projectId, tasks.projectId))
    .innerJoin(swimlanes, and(eq(swimlanes.boardId, boards.id), eq(swimlanes.key, tasks.status)))
    .innerJoin(agentHosts, eq(agentHosts.id, tasks.assignedAgentHostId))
    .where(and(
      eq(boards.id, boardId),
      eq(boards.tenantId, tenantId),
      eq(agentHosts.tenantId, tenantId),
      eq(swimlanes.isTerminal, false),
      eq(tasks.archived, false),
      isNotNull(tasks.assignedAgentHostId),
    ))
    .groupBy(swimlanes.id, agentHosts.id, agentHosts.name);

  const byLane: Record<string, BoardTicketOwner[]> = {};
  for (const r of rows) {
    (byLane[r.laneId] ??= []).push({ hostId: r.hostId, name: r.name, ticketCount: Number(r.ticketCount), via: 'ticket' });
  }
  return byLane;
}

/**
 * Drop, per lane, the hosts already STAFFED on that lane (a remote-runtime assignment whose
 * `target` is the host id): they already render as a staffed chip, and an owner chip is
 * only for owners that are NOT staffed there.
 */
export function excludeStaffedOwners(
  ownersByLane: Record<string, BoardTicketOwner[]>,
  staffedByLane: Record<string, ReadonlyArray<{ runtime: string | null; target: string | null }>>,
): Record<string, BoardTicketOwner[]> {
  const out: Record<string, BoardTicketOwner[]> = {};
  for (const [laneId, owners] of Object.entries(ownersByLane)) {
    const staffed = new Set(
      (staffedByLane[laneId] ?? []).filter((a) => a.runtime === 'remote' && a.target).map((a) => a.target),
    );
    const rest = owners.filter((o) => !staffed.has(String(o.hostId)));
    if (rest.length) out[laneId] = rest;
  }
  return out;
}
