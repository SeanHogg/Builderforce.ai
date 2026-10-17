import { useCallback, useEffect, useRef, useState } from 'react';
import { runtimeApi, boardsApi, type Execution, type BoardDispatch } from '@/lib/builderforceApi';
import { usePolledResource } from '@/hooks/usePolledResource';

/** Execution/dispatch statuses that mean an agent is still working (or queued). */
const ACTIVE = new Set(['pending', 'submitted', 'running', 'claimed']);
/**
 * Reconcile cadence. This poll is a BACKSTOP behind the project room's WebSocket
 * push (see TaskMgmtContent) — the push delivers real-time updates; this only
 * catches a dropped/missed socket frame (cross-isolate WS is lossy on Workers).
 * So it runs slow: a little quicker while a run is in-flight, lazy when idle,
 * never while the tab is hidden, and a tick is skipped when a push-driven
 * refresh already loaded within the last interval.
 */
const FAST_MS = 15000;
const IDLE_MS = 60000;

export interface BoardLiveRuns {
  /** Recent executions across the tenant (newest first); filtered to board tasks by the caller. */
  executions: Execution[];
  /** Per-agent dispatch status for the board's swimlanes (empty when no board). */
  dispatches: BoardDispatch[];
  /** Force an immediate refetch — call right after a status PATCH so a drag-triggered auto-run shows at once. */
  refresh: () => void;
}

/**
 * Live board run state: recent executions + the board's per-agent dispatches,
 * kept fresh by a self-adjusting poll so a card's agent chips advance
 * pending→running→done without a manual reload, and a drag-triggered auto-run
 * appears immediately (the caller invokes {@link BoardLiveRuns.refresh} after the
 * status PATCH resolves).
 *
 * Real-time updates arrive over the project room WebSocket (TaskMgmtContent
 * subscribes via {@link useRealtimeRoom} and calls {@link BoardLiveRuns.refresh}
 * on every push). This poll is only a reconcile BACKSTOP for a dropped socket
 * frame — cross-isolate WS is lossy on Workers, exactly why {@link useExecutionStream}
 * also keeps a reconcile poll. It runs slow (see FAST_MS/IDLE_MS) so the push,
 * not the poll, is what makes the board feel live.
 */
export function useBoardLiveRuns(boardId: string | undefined, enabled: boolean): BoardLiveRuns {
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [dispatches, setDispatches] = useState<BoardDispatch[]>([]);

  // Keep the freshest board id in a ref so the poll loop (set up once per
  // enable/board change) reads the current value without re-subscribing.
  const boardRef = useRef(boardId);
  boardRef.current = boardId;

  // Whether anything is still active — picks the backstop cadence.
  const [active, setActive] = useState(false);
  const lastLoad = useRef<{ at: number; boardId: string | undefined }>({ at: 0, boardId: undefined });

  // One fetch of both feeds. Failures are swallowed (keep last good data and
  // retry on the next tick) — a transient blip must not blank the board.
  const load = useCallback(async (): Promise<void> => {
    const bId = boardRef.current;
    lastLoad.current = { at: Date.now(), boardId: bId };
    const [execs, disp] = await Promise.all([
      runtimeApi.listRecent().catch(() => null),
      bId ? boardsApi.dispatches(bId).catch(() => null) : Promise.resolve(null),
    ]);
    let nowActive = false;
    if (execs) {
      setExecutions(execs);
      nowActive = nowActive || execs.some((e) => ACTIVE.has(e.status));
    }
    if (disp) {
      setDispatches(disp);
      nowActive = nowActive || disp.some((d) => ACTIVE.has(d.status));
    }
    setActive(nowActive);
  }, []);

  const refresh = useCallback(() => { void load(); }, [load]);

  useEffect(() => {
    if (enabled) return;
    setExecutions([]);
    setDispatches([]);
    setActive(false);
    lastLoad.current = { at: 0, boardId: undefined };
  }, [enabled]);

  const intervalMs = active ? FAST_MS : IDLE_MS;
  usePolledResource(async () => {
    // A WS push (or the caller's post-PATCH refresh) just loaded — this tick
    // would only repeat it. (A board switch always loads.)
    const last = lastLoad.current;
    if (last.boardId === boardRef.current && Date.now() - last.at < intervalMs / 2) return;
    await load();
  }, { intervalMs, enabled, restartKey: boardId ?? null });

  return { executions, dispatches, refresh };
}
