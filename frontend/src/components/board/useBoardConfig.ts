'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  boardsApi,
  type Board,
  type Swimlane,
  type SwimlaneAgent,
} from '@/lib/builderforceApi';

export interface BoardConfig {
  board: Board | null;
  lanes: Swimlane[];
  /** Agent assignments keyed by swimlane id. */
  agentsByLane: Record<string, SwimlaneAgent[]>;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/** Normalise a swimlane key / status / label for loose matching. */
export function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
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
  const [board, setBoard] = useState<Board | null>(null);
  const [lanes, setLanes] = useState<Swimlane[]>([]);
  const [agentsByLane, setAgentsByLane] = useState<Record<string, SwimlaneAgent[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (projectId == null) {
      setBoard(null);
      setLanes([]);
      setAgentsByLane({});
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const boards = await boardsApi.list();
      const mine = boards.find((b) => b.projectId === projectId) ?? null;
      setBoard(mine);
      if (mine) {
        const laneList = (await boardsApi.swimlanes.list(mine.id)).sort((a, b) => a.position - b.position);
        setLanes(laneList);
        const entries = await Promise.all(
          laneList.map(async (l) => [l.id, await boardsApi.agents.list(mine.id, l.id)] as const),
        );
        setAgentsByLane(Object.fromEntries(entries));
      } else {
        setLanes([]);
        setAgentsByLane({});
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load board');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (enabled) reload();
  }, [enabled, reload]);

  return { board, lanes, agentsByLane, loading, error, reload };
}
