'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { subscribeRunStore, getGlobalRunState, type GlobalRunState } from '@seanhogg/builderforce-brain-embedded';
import { runtimeApi, type AttentionResponse, type AttentionState } from '@/lib/builderforceApi';
import { useRealtimeRoom } from '@/lib/embed/useRealtimeRoom';

const EMPTY: AttentionResponse = { tasks: {}, chats: {}, chatUnread: {}, counts: { running: 0, awaiting: 0, unread: 0 }, manager: { lastRunAt: null, recentlyActive: false } };

/** A stable key of the two live-chat lists, so a subscriber only re-renders when
 *  the SET of live chats changes — not on every streaming token (each of which
 *  also emits a run-store change). */
function runStateKey(s: GlobalRunState): string {
  return `${[...s.running].sort((a, b) => a - b).join(',')}|${[...s.awaiting].sort((a, b) => a - b).join(',')}`;
}

/**
 * Subscribe to which chats the CLIENT-SIDE Brain loop is running / paused on. The
 * agent loop lives module-level (a run survives a chat switch), but it streams
 * straight to the gateway — so the server-side attention endpoint never sees it.
 * {@link useAttention} merges this in so a chat that keeps executing after you
 * open a new one still lights up. Debounced to the set of live chats.
 */
function useLocalRuns(): GlobalRunState {
  const [state, setState] = useState<GlobalRunState>(getGlobalRunState);
  useEffect(() => {
    const recompute = () =>
      setState((prev) => {
        const next = getGlobalRunState();
        return runStateKey(prev) === runStateKey(next) ? prev : next;
      });
    recompute();
    return subscribeRunStore(recompute);
  }, []);
  return state;
}

/** The most attention-worthy of several states — a needed answer beats a running
 *  loop, which beats idle. Shared so server + local states merge one way. */
function strongestState(...states: Array<AttentionState | undefined>): AttentionState | undefined {
  if (states.includes('awaiting_input')) return 'awaiting_input';
  if (states.includes('running')) return 'running';
  return undefined;
}

/**
 * Reconcile cadence — a BACKSTOP behind the project room's WebSocket push (see
 * {@link useRealtimeRoom}). A little quicker while something is live, lazy when
 * idle, mirroring {@link useBoardLiveRuns} so every live surface polls alike.
 */
const FAST_MS = 8000;
const IDLE_MS = 30000;

/**
 * The ONE web hook for cross-surface "what's live / what needs me" state. Reads
 * `GET /api/runtime/attention` (per-task + per-Brain-chat `running` /
 * `awaiting_input`) so the chat list, the FloatingBrain badge, and any ticket
 * list all render the SAME signal — a session's status follows it everywhere the
 * user multitasks, and switching chats never changes whether the agent keeps
 * executing server-side.
 *
 * Kept fresh by the project room WebSocket push (real-time) with an adaptive
 * poll as a dropped-frame backstop. Pass `projectId` to scope + enable the room
 * subscription; omit it for a tenant-wide (all projects) view.
 */
export function useAttention(projectId?: number, enabled = true): AttentionResponse & { refresh: () => void } {
  const [data, setData] = useState<AttentionResponse>(EMPTY);

  // Freshest projectId in a ref so the poll loop reads it without re-subscribing.
  const pidRef = useRef(projectId);
  pidRef.current = projectId;

  const load = useCallback(async (): Promise<boolean> => {
    try {
      const res = await runtimeApi.attention(pidRef.current);
      setData(res);
      return res.counts.running + res.counts.awaiting > 0;
    } catch {
      // A transient blip keeps the last good data and retries next tick.
      return false;
    }
  }, []);

  const refresh = useCallback(() => { void load(); }, [load]);

  useEffect(() => {
    if (!enabled) { setData(EMPTY); return; }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (cancelled) return;
      const active = await load();
      if (cancelled) return;
      timer = setTimeout(tick, active ? FAST_MS : IDLE_MS);
    };
    void tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [enabled, projectId, load]);

  // Real-time backstop: the project room pushes `changed` after any mutation —
  // an agent run advancing, or a human answering a question — so the indicator
  // updates the instant server state changes, not on the next poll.
  useRealtimeRoom(enabled && projectId != null ? `/api/projects/${projectId}/stream` : null, refresh);

  // Overlay the client-side Brain loop's live chats onto the server map, so a chat
  // running purely in the browser (which the server can't see) lights up the same
  // as a cloud / on-prem run. A chat already in the server map keeps its counted
  // state (we only strengthen its per-chat dot); a purely-local chat is added to
  // both the map and the counts, so the FloatingBrain badge + row dots agree.
  const local = useLocalRuns();
  return useMemo(() => {
    if (!enabled || (local.running.length === 0 && local.awaiting.length === 0)) {
      return { ...data, refresh };
    }
    const chats = { ...data.chats };
    let addRunning = 0;
    let addAwaiting = 0;
    const apply = (id: number, state: AttentionState) => {
      const existing = chats[id];
      const next = strongestState(existing?.state, state)!;
      if (!existing) {
        if (next === 'awaiting_input') addAwaiting += 1; else addRunning += 1;
      }
      chats[id] = { ...existing, state: next };
    };
    for (const id of local.running) apply(id, 'running');
    for (const id of local.awaiting) apply(id, 'awaiting_input');
    return {
      tasks: data.tasks,
      chats,
      chatUnread: data.chatUnread,
      counts: { running: data.counts.running + addRunning, awaiting: data.counts.awaiting + addAwaiting, unread: data.counts.unread },
      manager: data.manager,
      refresh,
    };
  }, [enabled, data, local, refresh]);
}
