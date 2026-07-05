'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { runtimeApi, type AttentionResponse } from '@/lib/builderforceApi';
import { useRealtimeRoom } from '@/lib/embed/useRealtimeRoom';

const EMPTY: AttentionResponse = { tasks: {}, chats: {}, counts: { running: 0, awaiting: 0 } };

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

  return { ...data, refresh };
}
