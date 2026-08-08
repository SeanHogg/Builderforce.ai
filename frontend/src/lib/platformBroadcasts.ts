'use client';

/**
 * Platform broadcasts on the client — fetch, live refresh, dismissal, and the
 * engagement each of those is worth reporting.
 *
 * The server decides WHO sees a broadcast (from the visitor's lead row, never
 * from anything this file claims), so everything here is delivery mechanics: ask
 * for my messages, notice when they change, remember which ones I closed.
 *
 * Live without polling. One shared relay room carries the same `{type:'changed'}`
 * frame every other realtime surface in the app uses, and this re-fetches on it.
 * Nothing about the message crosses that socket, which is what lets an anonymous
 * visitor subscribe to it at all. If the socket cannot be established the
 * broadcasts still arrive — one fetch later than they would have.
 */

import { useCallback, useEffect, useState } from 'react';
import { AUTH_API_URL } from './auth';
import { apiRequestStream } from './apiClient';
import { getVisitorId } from './visitor';

export type BroadcastTone = 'info' | 'success' | 'warning' | 'critical';

/** What a visitor receives — no audience, no counts, nothing about anyone else. */
export interface PlatformBroadcast {
  id: number;
  message: string;
  tone: BroadcastTone;
  ctaLabel: string | null;
  ctaHref: string | null;
  dismissible: boolean;
}

/** Seen / clicked / closed. Idempotent server-side per (broadcast, visitor, kind). */
export type BroadcastEventKind = 'impression' | 'click' | 'dismiss';

const DISMISSED_KEY = 'bf_broadcasts_dismissed';

/**
 * Broadcasts this visitor has closed.
 *
 * Kept in the browser rather than on the server on purpose: a dismissal is a
 * per-device preference, it must survive the round trip that has not happened
 * yet (the banner has to disappear on click, not on the next fetch), and losing
 * it in private mode means a visitor sees a banner twice — the mildest possible
 * failure. The server still hears about it, as engagement.
 */
function readDismissed(): number[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is number => typeof v === 'number') : [];
  } catch {
    return [];
  }
}

function writeDismissed(ids: number[]): void {
  if (typeof window === 'undefined') return;
  // Bounded: a visitor who has closed 200 banners is not going to be shown the
  // first one again, and an unbounded array in localStorage is a slow leak.
  try { window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids.slice(-200))); } catch { /* private mode */ }
}

/** The broadcasts targeted at this visitor right now. Empty on any failure —
 *  a marketing banner is never worth an error surface. */
export async function fetchPlatformBroadcasts(): Promise<PlatformBroadcast[]> {
  const visitorId = getVisitorId();
  if (!visitorId) return [];
  try {
    const res = await apiRequestStream(`/api/guest/messages?visitorId=${encodeURIComponent(visitorId)}`, {
      auth: 'none',
      expectedErrors: [400, 401, 403, 404, 429],
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { messages?: PlatformBroadcast[] };
    return Array.isArray(data.messages) ? data.messages : [];
  } catch {
    return [];
  }
}

/** Report that this visitor saw, clicked, or closed a broadcast. Fire-and-forget;
 *  `keepalive` because a click reports and then navigates away. */
export async function reportBroadcastEvent(id: number, kind: BroadcastEventKind): Promise<void> {
  const visitorId = getVisitorId();
  if (!visitorId) return;
  try {
    await apiRequestStream(`/api/guest/messages/${id}/event`, {
      method: 'POST',
      auth: 'none',
      keepalive: true,
      body: JSON.stringify({ visitorId, kind }),
      expectedErrors: [400, 401, 403, 404, 429],
    });
  } catch { /* engagement is never worth failing a click over */ }
}

/** The relay URL for the shared broadcast room. No token: the frame carries no
 *  data, which is exactly why one public room can serve every visitor. */
function broadcastSocketUrl(): string {
  return `${AUTH_API_URL.replace(/^http/, 'ws')}/api/guest/messages/ws`;
}

/**
 * A normal HTTP request to the relay returns 426 when the route exists (the
 * actual connection must be a WebSocket upgrade). Probe first so a frontend
 * deployed ahead of its API does not create a noisy failed WebSocket every five
 * seconds. Browsers do not expose the failed handshake status to WebSocket
 * clients, so this capability check has to happen before `new WebSocket()`.
 */
async function broadcastSocketAvailable(): Promise<boolean> {
  try {
    const res = await apiRequestStream('/api/guest/messages/ws', {
      auth: 'none',
      expectedErrors: [404, 426, 503],
    });
    return res.status === 426;
  } catch {
    return false;
  }
}

export interface PlatformBroadcastsState {
  broadcasts: PlatformBroadcast[];
  dismiss: (id: number) => void;
  onClick: (id: number) => void;
}

/**
 * Subscribe to this visitor's broadcasts.
 *
 * Fetches once on mount, re-fetches when the relay says something changed, and
 * filters out what this browser has already closed. Impressions are reported for
 * whatever survives that filter — once per broadcast per visitor, enforced
 * server-side, so a remount cannot inflate a campaign's reach.
 */
export function usePlatformBroadcasts(): PlatformBroadcastsState {
  const [broadcasts, setBroadcasts] = useState<PlatformBroadcast[]>([]);
  const [dismissed, setDismissed] = useState<number[]>([]);

  useEffect(() => { setDismissed(readDismissed()); }, []);

  const reload = useCallback(() => {
    void fetchPlatformBroadcasts().then(setBroadcasts);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Live refresh. Capability-check before connecting because WebSocket does not
  // expose a failed handshake's HTTP status. An older API deployment therefore
  // degrades quietly to the mount fetch instead of filling the console forever.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return;
    let closed = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = async () => {
      if (closed) return;
      if (!(await broadcastSocketAvailable()) || closed) {
        // Re-probe quietly: this tab can recover after a staggered API deploy
        // without repeatedly attempting a WebSocket handshake to a missing URL.
        if (!closed) retry = setTimeout(() => { void connect(); }, 60_000);
        return;
      }
      try {
        socket = new WebSocket(broadcastSocketUrl());
      } catch {
        retry = setTimeout(() => { void connect(); }, 5000);
        return;
      }
      socket.onmessage = (event) => {
        try {
          const frame = JSON.parse(typeof event.data === 'string' ? event.data : '');
          if (frame?.type === 'changed') reload();
        } catch { /* non-JSON frames are not ours */ }
      };
      socket.onclose = () => {
        if (!closed) retry = setTimeout(() => { void connect(); }, 5000);
      };
      socket.onerror = () => { try { socket?.close(); } catch { /* already gone */ } };
    };
    void connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      try { socket?.close(); } catch { /* already gone */ }
    };
  }, [reload]);

  const visible = broadcasts.filter((b) => !dismissed.includes(b.id));

  // One impression per broadcast that actually reaches the screen. Keyed by the
  // id list so a re-render does not re-report, and de-duplicated server-side
  // anyway — belt and braces, because reach is a number people will act on.
  const visibleIds = visible.map((b) => b.id).join(',');
  useEffect(() => {
    if (!visibleIds) return;
    for (const id of visibleIds.split(',')) void reportBroadcastEvent(Number(id), 'impression');
  }, [visibleIds]);

  const dismiss = useCallback((id: number) => {
    setDismissed((prior) => {
      const next = prior.includes(id) ? prior : [...prior, id];
      writeDismissed(next);
      return next;
    });
    void reportBroadcastEvent(id, 'dismiss');
  }, []);

  const onClick = useCallback((id: number) => { void reportBroadcastEvent(id, 'click'); }, []);

  return { broadcasts: visible, dismiss, onClick };
}
