import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { boardsApi, type BoardDispatch } from '@/lib/builderforceApi';
import { createLiveRunsReader, type TaskRun } from '@/lib/liveRunsApi';
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
  /** The newest run per (task, agent) for the board's project — one chip each. */
  executions: TaskRun[];
  /** Per-agent dispatch status for the board's swimlanes (empty when no board). */
  dispatches: BoardDispatch[];
  /** Force an immediate refetch — call right after a status PATCH so a drag-triggered auto-run shows at once. */
  refresh: () => void;
}

/**
 * Live board run state: the board's per-(task, agent) latest runs + its per-agent
 * dispatches, kept fresh by a self-adjusting poll so a card's agent chips advance
 * pending→running→done without a manual reload, and a drag-triggered auto-run
 * appears immediately (the caller invokes {@link BoardLiveRuns.refresh} after the
 * status PATCH resolves).
 *
 * The runs come from the ONE live-runs read (`lib/liveRunsApi`), scoped to the
 * board's project and version-gated: while no run in the workspace has changed
 * state, a tick costs one tiny `unchanged` answer — no list, no database read.
 *
 * Real-time updates arrive over the project room WebSocket (TaskMgmtContent
 * subscribes via {@link useRealtimeRoom} and calls {@link BoardLiveRuns.refresh}
 * on every push). This poll is only a reconcile BACKSTOP for a dropped socket
 * frame — cross-isolate WS is lossy on Workers, exactly why {@link useExecutionStream}
 * also keeps a reconcile poll. It runs slow (see FAST_MS/IDLE_MS) so the push,
 * not the poll, is what makes the board feel live.
 */
export function useBoardLiveRuns(boardId: string | undefined, enabled: boolean, projectId?: number): BoardLiveRuns {
  const [executions, setExecutions] = useState<TaskRun[]>([]);
  const [dispatches, setDispatches] = useState<BoardDispatch[]>([]);

  // One version-gated reader per project scope (a project switch starts a fresh one).
  const reader = useMemo(() => createLiveRunsReader({ taskRuns: projectId ?? 'all' }), [projectId]);

  // Keep the freshest board id and reader in refs so the poll loop (set up once per
  // enable/board change) reads the current values without re-subscribing. Synced in
  // an effect (never during render), declared BEFORE the poll so it runs first.
  const boardRef = useRef(boardId);
  const readerRef = useRef(reader);
  useEffect(() => {
    boardRef.current = boardId;
    readerRef.current = reader;
  });

  // Whether anything is still active — picks the backstop cadence.
  const [active, setActive] = useState(false);
  const lastLoad = useRef<{ at: number; boardId: string | undefined }>({ at: 0, boardId: undefined });

  // One fetch of both feeds, settled independently: a failing feed keeps its last
  // good data (a transient blip must not blank the board) while the other still
  // lands, and the next tick retries it. Never rejects — `refresh` fires it bare.
  const load = useCallback(async (): Promise<void> => {
    const bId = boardRef.current;
    lastLoad.current = { at: Date.now(), boardId: bId };
    const [runs, disp] = await Promise.allSettled([
      readerRef.current.read(),
      bId ? boardsApi.dispatches(bId) : Promise.resolve(null),
    ]);
    let nowActive = false;
    if (runs.status === 'fulfilled') {
      setExecutions(runs.value.taskRuns);
      nowActive = runs.value.taskRuns.some((e) => ACTIVE.has(e.status));
    }
    if (disp.status === 'fulfilled' && disp.value) {
      setDispatches(disp.value);
      nowActive = nowActive || disp.value.some((d) => ACTIVE.has(d.status));
    }
    setActive(nowActive);
  }, []);

  const refresh = useCallback(() => { void load(); }, [load]);

  // Disabling clears the board's run state. Adjusted during render on the
  // enabled -> disabled transition (React's "reset state when a prop changes"
  // pattern) rather than in an effect, so the stale runs never paint first.
  const [wasEnabled, setWasEnabled] = useState(enabled);
  if (wasEnabled !== enabled) {
    setWasEnabled(enabled);
    if (!enabled) {
      setExecutions([]);
      setDispatches([]);
      setActive(false);
    }
  }
  // ...and forgets the last load, so re-enabling never skips its first tick.
  useEffect(() => {
    if (!enabled) lastLoad.current = { at: 0, boardId: undefined };
  }, [enabled]);

  const intervalMs = active ? FAST_MS : IDLE_MS;
  usePolledResource(async () => {
    // A WS push (or the caller's post-PATCH refresh) just loaded — this tick
    // would only repeat it. (A board switch always loads.)
    const last = lastLoad.current;
    if (last.boardId === boardRef.current && Date.now() - last.at < intervalMs / 2) return;
    await load();
  }, { intervalMs, enabled, restartKey: `${boardId ?? ''}:${projectId ?? 'all'}` });

  return { executions, dispatches, refresh };
}
