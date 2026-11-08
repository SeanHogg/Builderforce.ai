import { useCallback, useEffect, useRef, useState } from 'react';
import {
  boardsApi,
  type Board,
  type BoardTicketOwner,
  type CloudRunAllowance,
  type Swimlane,
  type SwimlaneAgent,
} from '@/lib/builderforceApi';
import { useErrorMessage } from '@/i18n/useErrorMessage';
export interface BoardConfig {
  board: Board | null;
  lanes: Swimlane[];
  /** Agent assignments keyed by swimlane id. */
  agentsByLane: Record<string, SwimlaneAgent[]>;
  /** Hosts that OWN open tickets per lane (`via: 'ticket'`) — not the same as staffing. */
  ownersByLane: Record<string, BoardTicketOwner[]>;
  /**
   * The WORKSPACE's cloud-run allowance, carried on the same request that loads
   * the boards (DISP-R3). Null when the meter could not be read — which is not
   * "over allowance" and must not render as one.
   */
  cloudRunAllowance: CloudRunAllowance | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  /** Refetch ONLY the live rosters (lane agents + ticket owners) — what a realtime push needs. */
  reloadRosters: () => Promise<void>;
}

/**
 * Loads a project's board, swimlanes, and per-lane agent assignments. Shared by
 * the board-config slide-out (editing) and the task board (displaying which
 * agents are configured per lane). Pass `enabled = false` to defer fetching.
 */
export function useBoardConfig(
  projectId: number | null | undefined,
  enabled = true,
): BoardConfig {
  const errorMessage = useErrorMessage();
  const [board, setBoard] = useState<Board | null>(null);
  const [lanes, setLanes] = useState<Swimlane[]>([]);
  const [agentsByLane, setAgentsByLane] = useState<Record<string, SwimlaneAgent[]>>({});
  const [ownersByLane, setOwnersByLane] = useState<Record<string, BoardTicketOwner[]>>({});
  const [cloudRunAllowance, setCloudRunAllowance] = useState<CloudRunAllowance | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const boardIdRef = useRef<string | null>(null);

  const reload = useCallback(async () => {
    if (projectId == null) {
      boardIdRef.current = null;
      setBoard(null);
      setLanes([]);
      setAgentsByLane({});
      setOwnersByLane({});
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // The allowance rides the SAME request the boards do — a workspace-level
      // condition should not cost a second round trip to display.
      const { boards, cloudRunAllowance: allowance } = await boardsApi.listWithAllowance();
      setCloudRunAllowance(allowance);
      const mine = boards.find((b) => b.projectId === projectId) ?? null;
      setBoard(mine);
      if (mine) {
        const [laneRows, byLane, owners] = await Promise.all([
          boardsApi.swimlanes.list(mine.id),
          boardsApi.laneAgents(mine.id),
          // Ticket owners are a different fact from staffing; a failure here must not
          // blank the staffed chips.
          boardsApi.ticketOwners(mine.id).catch(() => ({} as Record<string, BoardTicketOwner[]>)),
        ]);
        boardIdRef.current = mine.id;
        setLanes([...laneRows].sort((a, b) => a.position - b.position));
        setAgentsByLane(byLane);
        setOwnersByLane(owners);
      } else {
        boardIdRef.current = null;
        setLanes([]);
        setAgentsByLane({});
        setOwnersByLane({});
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [projectId, errorMessage]);

  const reloadRosters = useCallback(async () => {
    const boardId = boardIdRef.current;
    if (!boardId) return;
    try {
      const [byLane, owners] = await Promise.all([
        boardsApi.laneAgents(boardId),
        boardsApi.ticketOwners(boardId).catch(() => ({} as Record<string, BoardTicketOwner[]>)),
      ]);
      setAgentsByLane(byLane);
      setOwnersByLane(owners);
    } catch { /* a missed reconcile heals on the next push; keep the chips on screen */ }
  }, []);

  useEffect(() => {
    if (enabled) reload();
  }, [enabled, reload]);

  return { board, lanes, agentsByLane, ownersByLane, cloudRunAllowance, loading, error, reload, reloadRosters };
}
