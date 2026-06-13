'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AUTH_API_URL, getStoredTenantToken } from './auth';

/**
 * useCeremonyRoom — the live multiplayer client for a standup/planning round-table.
 *
 * Connects to the ceremony room WebSocket (`/api/agile/ceremonies/rooms/<projectId>/ws`),
 * announces this client (presence), and relays frames peer-to-peer. Modeled on
 * {@link useRealtimeRoom} (token via ?token=, ws/wss from AUTH_API_URL, 2s
 * reconnect) but adds presence tracking and an outbound `send`.
 *
 * Frame protocol mirrors CeremonyRoomDO:
 *  - server→client `{type:"hello", id}` — this client's assigned peer id
 *  - server→client `{type:"roster", peers}` — full roster sent right after join
 *  - relayed `{type:"presence", action:"join"|"leave", peer}` — roster deltas
 *  - relayed `{type:"changed", from}` — a peer committed a mutation → re-fetch
 *  - relayed `{type:"cursor"|"drag", from, …}` — ephemeral, handed to onFrame
 *
 * `onChange` and `onFrame` MUST be stable (useCallback) so the socket isn't torn
 * down each render. The surface still works (single-user) if the socket can't open.
 */
export interface CeremonyPeer {
  id: string;
  name: string;
  /** 'human' | 'cloud_agent' | 'host_agent' — matches the seat's member kind. */
  kind: string;
  /** Stable identity (users.id / ide_agents.id / agent_hosts.id) used to light a seat. */
  ref: string;
}

export interface CeremonyRoomFrame {
  type: string;
  from?: string;
  [key: string]: unknown;
}

export interface UseCeremonyRoom {
  /** Other people currently at the table (excludes this client). */
  peers: CeremonyPeer[];
  /** This client's assigned peer id (null until connected). */
  myId: string | null;
  connected: boolean;
  /** Broadcast a frame to every other peer. No-op when disconnected. */
  send: (frame: CeremonyRoomFrame) => void;
}

export function useCeremonyRoom(
  projectId: number | null,
  me: { name: string; kind: string; ref: string },
  opts: { onChange: () => void; onFrame?: (frame: CeremonyRoomFrame) => void },
): UseCeremonyRoom {
  const { onChange, onFrame } = opts;
  const [peers, setPeers] = useState<CeremonyPeer[]>([]);
  const [myId, setMyId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // Keep the latest identity without resubscribing the socket every render.
  const meRef = useRef(me);
  useEffect(() => { meRef.current = me; }, [me]);

  const upsertPeer = useCallback((p: CeremonyPeer) => {
    setPeers((prev) => {
      const next = prev.filter((x) => x.id !== p.id);
      next.push(p);
      return next;
    });
  }, []);

  useEffect(() => {
    if (projectId == null) return;
    const token = getStoredTenantToken();
    if (!token) return;

    const base = AUTH_API_URL.replace(/^http/, 'ws');
    const url = `${base}/api/agile/ceremonies/rooms/${projectId}/ws?token=${encodeURIComponent(token)}`;

    let closed = false;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closed) return;
      try {
        ws = new WebSocket(url);
      } catch {
        retry = setTimeout(connect, 2000);
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        try { ws?.send(JSON.stringify({ type: 'join', ...meRef.current })); } catch { /* ignore */ }
      };
      ws.onmessage = (ev) => {
        let msg: CeremonyRoomFrame;
        try {
          msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
        } catch {
          return;
        }
        if (!msg || typeof msg.type !== 'string') return;
        switch (msg.type) {
          case 'hello':
            setMyId(String(msg.id ?? ''));
            break;
          case 'roster':
            setPeers(Array.isArray(msg.peers) ? (msg.peers as CeremonyPeer[]) : []);
            break;
          case 'presence':
            if (msg.action === 'join' && msg.peer) upsertPeer(msg.peer as CeremonyPeer);
            else if (msg.action === 'leave' && msg.peer) {
              const id = (msg.peer as { id: string }).id;
              setPeers((prev) => prev.filter((x) => x.id !== id));
            }
            break;
          case 'changed':
            onChange();
            break;
          default:
            onFrame?.(msg);
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 2000);
      };
      ws.onerror = () => { try { ws?.close(); } catch { /* ignore */ } };
    };
    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      setConnected(false);
      setPeers([]);
      setMyId(null);
      try { ws?.close(); } catch { /* ignore */ }
      wsRef.current = null;
    };
  }, [projectId, onChange, onFrame, upsertPeer]);

  const send = useCallback((frame: CeremonyRoomFrame) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(frame)); } catch { /* ignore */ }
    }
  }, []);

  return { peers, myId, connected, send };
}
