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
 *     happening yet instead of typing over them.
 *
 * The camera meeting rides the SAME room on the `media` channel and is handled by
 * the shared `useMediaRoom` hook (the one Standup/Planning already use) — this
 * hook deliberately owns no WebRTC.
 */

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

  const wsRef = useRef<WebSocket | null>(null);
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
        if (type === 'changed') { changedRef.current?.(); return; }
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
          if (busyTimer.current) clearTimeout(busyTimer.current);
          // A sender that disconnects mid-turn must not leave the room showing
          // "waiting on the Brain" forever.
          if (who) busyTimer.current = setTimeout(() => setBusyWith(null), 90_000);
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
      try { ws?.close(); } catch { /* already closing */ }
      wsRef.current = null;
      setConnected(false);
      setBusyWith(null);
    };
  }, [code, refresh, send]);

  return { state, connected, remaining, limit, participants, busyWith, setBusy, refresh };
}
