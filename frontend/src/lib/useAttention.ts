import { useEffect, useMemo, useState } from 'react';
import { subscribeRunStore, getGlobalRunState, type GlobalRunState } from '@seanhogg/builderforce-brain-embedded';
import type { AttentionResponse, AttentionState } from '@/lib/builderforceApi';
import { useRealtimeRoom } from '@/lib/embed/useRealtimeRoom';
import { useSharedPoll } from '@/hooks/useSharedPoll';
import { attentionPoll } from './attentionPoller';

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
 * The ONE web hook for cross-surface "what's live / what needs me" state. Reads
 * `GET /api/runtime/attention` (per-task + per-Brain-chat `running` /
 * `awaiting_input`) so the chat list, the FloatingBrain badge, and any ticket
 * list all render the SAME signal — a session's status follows it everywhere the
 * user multitasks, and switching chats never changes whether the agent keeps
 * executing server-side.
 *
 * Kept fresh by the project room WebSocket push (real-time) with an adaptive
 * poll as a dropped-frame backstop — ONE poll per scope shared by every reader
 * (see lib/attentionPoller.ts), paused while the tab is hidden. Pass
 * `projectId` to scope + enable the room subscription; omit it for a tenant-wide (all projects) view.
 */
export function useAttention(projectId?: number, enabled = true): AttentionResponse & { refresh: () => void } {
  // ONE shared, ref-counted, visibility-gated poll per scope (lib/attentionPoller):
  // the badge, the TopBar indicator and the Brain panel all read the same loop, so
  // N readers cost one request per tick and a hidden tab costs none. Its explicit
  // refresh (the room push below, a caller after a write) KNOWS state moved, so it
  // skips the server cache; the timer ticks read the cached snapshot.
  const { value: data, refresh } = useSharedPoll(attentionPoll, projectId, enabled);

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
