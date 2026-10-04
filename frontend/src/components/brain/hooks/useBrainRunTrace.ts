import { useEffect, useMemo, useRef, useState } from 'react';
import {
  subscribeRun,
  getRunSnapshot,
  getRunTrace,
  mergeRecoveredTrace,
  traceEventToPersistInput,
  type BrainTraceEvent,
} from '@seanhogg/builderforce-brain-embedded';
import { brain } from '@/lib/builderforceApi';
import { traceRowToEvent } from '../panel/brainPanelUtils';

/**
 * Run-trace persist + rehydrate for the active chat. Returns the timeline's trace:
 * the persisted history merged with this session's live run.
 */
export function useBrainRunTrace(activeChatId: number | null, liveTrace: BrainTraceEvent[]) {
  // Rehydrate: on chat load, pull the persisted tool/LLM-turn trace so those steps
  // survive a reload. Shown when there's no live trace this session (a live run
  // repopulates conv.trace, which then wins).
  const [persistedTrace, setPersistedTrace] = useState<BrainTraceEvent[]>([]);
  // No chat ⇒ no history. Cleared while rendering, the moment the chat goes away
  // (React's "adjust state when a prop changes"), not by an effect.
  const [prevChatId, setPrevChatId] = useState(activeChatId);
  if (prevChatId !== activeChatId) {
    setPrevChatId(activeChatId);
    if (activeChatId == null) setPersistedTrace([]);
  }
  useEffect(() => {
    const cid = activeChatId;
    if (cid == null) return;
    let live = true;
    brain.getChatTrace(cid)
      .then((rows) => { if (live) setPersistedTrace(rows.map(traceRowToEvent)); })
      .catch(() => { if (live) setPersistedTrace([]); });
    return () => { live = false; };
  }, [activeChatId]);
  // MERGED, not either/or: a live run must not erase the history it is continuing.
  // Deduped by step identity in the shared primitive — see `mergeRecoveredTrace`.
  const timelineTrace = useMemo(() => mergeRecoveredTrace(persistedTrace, liveTrace), [persistedTrace, liveTrace]);

  // Persist: when a run settles (running flips true→false with a non-empty trace),
  // POST only the events not yet persisted this session (tracked per-chat) so tool
  // turns are durable and don't double-post.
  const persistedLenRef = useRef<Map<number, number>>(new Map());
  const wasRunningRef = useRef<Map<number, boolean>>(new Map());
  useEffect(() => {
    const cid = activeChatId;
    if (cid == null) return;
    wasRunningRef.current.set(cid, getRunSnapshot(cid).running);
    const onChange = () => {
      const snap = getRunSnapshot(cid);
      const prev = wasRunningRef.current.get(cid) ?? false;
      wasRunningRef.current.set(cid, snap.running);
      if (!prev || snap.running) return; // only act on running → settled
      const full = getRunTrace(cid);
      const already = persistedLenRef.current.get(cid) ?? 0;
      if (full.length <= already) return;
      const events = full.slice(already).map(traceEventToPersistInput);
      persistedLenRef.current.set(cid, full.length);
      void brain.appendChatTrace(cid, events).catch(() => { /* best-effort */ });
    };
    return subscribeRun(cid, onChange);
  }, [activeChatId]);

  return timelineTrace;
}
