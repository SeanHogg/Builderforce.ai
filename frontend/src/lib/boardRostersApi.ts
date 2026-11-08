/** Client for a board's LIVE rosters: lane staffing and ticket owners, each in one request. */
import { apiRequest } from './apiClient';
import type { SwimlaneAgent } from './builderforceApi';

/**
 * An agent host that OWNS open tickets in a lane (`tasks.assigned_agent_host_id`) -
 * a different fact from lane staffing ({@link SwimlaneAgent}). `via: 'ticket'` is what
 * tells the board to render it as an owner, not a staffed agent.
 */
export interface BoardTicketOwner {
  hostId: number;
  name: string;
  ticketCount: number;
  via: 'ticket';
}

export const boardRostersApi = {
  /** Hosts owning open tickets on the board, keyed by swimlane id (one batched query). */
  ticketOwners: (boardId: string): Promise<Record<string, BoardTicketOwner[]>> =>
    apiRequest<{ ownersByLane: Record<string, BoardTicketOwner[]> }>(`/api/boards/${boardId}/ticket-owners`).then((r) => r.ownersByLane ?? {}),

  /**
   * Owners are a different fact from staffing: a failure to read them must not blank the staffed
   * chips, so it degrades to "no owners" - and is logged, never swallowed.
   */
  ticketOwnersOrEmpty: (boardId: string): Promise<Record<string, BoardTicketOwner[]>> =>
    boardRostersApi.ticketOwners(boardId).catch((error: unknown) => {
      console.warn('[board] ticket owners failed to load; showing staffed agents only', error);
      return {};
    }),

  /** Every lane's staffed agents, keyed by swimlane id, in one request. */
  laneAgents: (boardId: string): Promise<Record<string, SwimlaneAgent[]>> =>
    apiRequest<{ agentsByLane: Record<string, SwimlaneAgent[]> }>(`/api/boards/${boardId}/lane-agents`).then((r) => r.agentsByLane ?? {}),
};
