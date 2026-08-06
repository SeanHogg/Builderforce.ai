'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getStoredGuestToken } from './guestChatApi';
import {
  fetchGuestRoomState, guestRoomSocketUrl, type GuestRoomParticipant, type GuestRoomState,
} from './guestRoomApi';

/**
 * useGuestRoom — the live half of a SHARED logged-out session.
 *
 * One WebSocket to the room's Durable Object on the `chat` channel carries
 * everything the conversation needs to feel like one room rather than N private
 * chats:
 *   • presence — who is here right now,
 *   • `changed` — someone appended to the shared transcript, refetch it,
 *   • `turns` — the room's COMBINED allowance moved (everyone's counter updates,
 *     not just the sender's),
 *   • `busy` — somebody is waiting on the Brain, so the others see why nothing is
 *     happening yet instead of typing over them,
 *   • `stream` — the reply AS IT ARRIVES. Only the sender holds the gateway
 *     stream, so they re-broadcast their delta buffer on a throttle and everyone
 *     else renders it as a trailing bubble. Without it a shared session reads as
 *     turn-based: a pause, then a wall of text that was already finished.
 *
 * Relayed deltas are display-only and never persisted — the sender's completed
 * turn is what lands in the transcript, and `changed` retires the live bubble.
 *
 * The camera meeting rides the SAME room on the `media` channel and is handled by
 * the shared `useMediaRoom` hook (the one Standup/Planning already use) — this
 * hook deliberately owns no WebRTC.
 */

/** How often a sender re-broadcasts its growing reply (leading edge + trailing). */
const STREAM_RELAY_MS = 250;

export interface GuestRoomLive {
  /** Room state as last fetched/pushed, or null before the first load. */
  state: GuestRoomState | null;
  /** True while the relay socket is open. */
  connected: boolean;
  /** Combined turns left for the whole room (null until known). */
  remaining: number | null;
  limit: number;
  /** Everyone currently in the room. */
  participants: GuestRoomParticipant[];
  /** The display name of whoever is waiting on the Brain right now, if anyone. */
  busyWith: string | null;
  /** Announce that this participant just asked the Brain (or finished). */
  setBusy: (busy: boolean) => void;
  /** Another participant's reply as it streams in (display-only), or null. */
  streamingPeer: { name: string; text: string } | null;
  /** Re-broadcast MY in-flight reply so the room watches the same answer arrive. */
  relayStream: (text: string) => void;
  /** Refetch room state (roster + combined allowance) from the server. */
  refresh: () => Promise<void>;
}

const NO_PARTICIPANTS: GuestRoomParticipant[] = [];

export function useGuestRoom(
  code: string | null,
  me: { name: string },
  /** Called when the shared transcript changed and should be refetched. */
  onTranscriptChanged?: () => void,
): GuestRoomLive {
  const [state, setState] = useState<GuestRoomState | null>(null);
  const [connected, setConnected] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [limit, setLimit] = useState(0);
  const [participants, setParticipants] = useState<GuestRoomParticipant[]>(NO_PARTICIPANTS);
  const [busyWith, setBusyWith] = useState<string | null>(null);
  const [streamingPeer, setStreamingPeer] = useState<{ name: string; text: string } | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const streamTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStream = useRef<string | null>(null);
  const nameRef = useRef(me.name);
  useEffect(() => { nameRef.current = me.name; }, [me.name]);
  const changedRef = useRef(onTranscriptChanged);
  useEffect(() => { changedRef.current = onTranscriptChanged; }, [onTranscriptChanged]);
  const busyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyState = useCallback((next: GuestRoomState | null) => {
    if (!next) return;
    setState(next);
    setRemaining(next.remaining);
    setLimit(next.limit);
    setParticipants(next.participants);
  }, []);

  const refresh = useCallback(async () => {
    if (!code) return;
    applyState(await fetchGuestRoomState(code));
  }, [code, applyState]);

  const send = useCallback((frame: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(frame)); } catch { /* the reconnect will resync */ }
    }
  }, []);

  const setBusy = useCallback((busy: boolean) => {
    send({ type: 'busy', busy, name: nameRef.current });
  }, [send]);

  /**
   * Broadcast my growing reply on a throttle: the first delta goes out
   * immediately (so the room sees the answer start, not a quarter-second of
   * nothing), and everything after it coalesces into one frame per window. The
   * FULL buffer is sent each time rather than a diff — the payload is small, and
   * a dropped or reordered frame then costs one stale render instead of
   * permanently corrupting the text a peer is reading.
   */
  const relayStream = useCallback((text: string) => {
    pendingStream.current = text;
    if (streamTimer.current) return;
    send({ type: 'stream', text });
    pendingStream.current = null;
    // Keep draining until a window passes with nothing new, so the LAST delta is
    // always broadcast — otherwise the room would sit on a truncated reply until
    // the persisted message arrived.
    const flush = () => {
      const queued = pendingStream.current;
      pendingStream.current = null;
      if (queued === null) { streamTimer.current = null; return; }
      send({ type: 'stream', text: queued });
      streamTimer.current = setTimeout(flush, STREAM_RELAY_MS);
    };
    streamTimer.current = setTimeout(flush, STREAM_RELAY_MS);
  }, [send]);

  // Initial state load — a joiner needs the roster and the combined counter before
  // the socket has said anything.
  useEffect(() => {
    if (!code) { setState(null); setRemaining(null); setParticipants(NO_PARTICIPANTS); return; }
    void refresh();
  }, [code, refresh]);

  // The relay socket.
  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      const token = getStoredGuestToken();
      // No token yet (still minting, or it just lapsed) — try again shortly rather
      // than failing the room; the socket is an enhancement, not the transport.
      if (!token) { retry = setTimeout(connect, 1500); return; }
      try { ws = new WebSocket(guestRoomSocketUrl(code, 'chat', token)); } catch { retry = setTimeout(connect, 2000); return; }
      wsRef.current = ws;
      ws.onopen = () => {
        setConnected(true);
        send({ type: 'join', name: nameRef.current });
      };
      ws.onmessage = (ev) => {
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ''); } catch { return; }
        const type = typeof msg?.type === 'string' ? msg.type : '';
        if (type === 'changed') {
          // The real message just landed in the transcript — retire the live
          // bubble so the answer isn't rendered twice for a beat.
          setStreamingPeer(null);
          changedRef.current?.();
          return;
        }
        if (type === 'stream') {
          const text = String(msg.text ?? '');
          setStreamingPeer(text ? { name: String(msg.name ?? 'Guest'), text } : null);
          return;
        }
        if (type === 'turns') {
          setRemaining(Number(msg.remaining ?? 0));
          setLimit(Number(msg.limit ?? 0));
          return;
        }
        if (type === 'participants') {
          setParticipants((msg.participants as GuestRoomParticipant[] | undefined) ?? NO_PARTICIPANTS);
          return;
        }
        if (type === 'busy') {
          const who = msg.busy ? String(msg.name ?? 'Someone') : null;
          setBusyWith(who);
          if (!who) setStreamingPeer(null);
          if (busyTimer.current) clearTimeout(busyTimer.current);
          // A sender that disconnects mid-turn must not leave the room showing
          // "waiting on the Brain" — or a half-finished reply — forever.
          if (who) {
            busyTimer.current = setTimeout(() => { setBusyWith(null); setStreamingPeer(null); }, 90_000);
          }
          return;
        }
        if (type === 'presence' || type === 'roster') {
          // A join/leave changes the roster the server persists — ask for it
          // rather than reconstructing it from peer frames.
          void refresh();
          return;
        }
        if (type === 'room' && typeof msg.title === 'string') {
          setState((prev) => (prev ? { ...prev, title: msg.title as string } : prev));
        }
      };
      ws.onclose = () => { setConnected(false); if (!cancelled) retry = setTimeout(connect, 2000); };
      ws.onerror = () => { try { ws?.close(); } catch { /* already closing */ } };
    };
    connect();

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      if (busyTimer.current) clearTimeout(busyTimer.current);
      if (streamTimer.current) { clearTimeout(streamTimer.current); streamTimer.current = null; }
      pendingStream.current = null;
      try { ws?.close(); } catch { /* already closing */ }
      wsRef.current = null;
      setConnected(false);
      setBusyWith(null);
      setStreamingPeer(null);
    };
  }, [code, refresh, send]);

  return {
    state, connected, remaining, limit, participants,
    busyWith, setBusy, streamingPeer, relayStream, refresh,
  };
}
