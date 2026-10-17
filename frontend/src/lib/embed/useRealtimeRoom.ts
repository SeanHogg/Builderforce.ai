import { useEffect } from 'react';
import { getStoredTenantToken, getStoredWebToken } from '../auth';
import { apiSocketUrl } from '../apiSocket';

/**
 * Subscribe to a collaborative session room over WebSocket. The server pushes a
 * `{ type: 'changed' }` frame after any mutation; we call `onChange` so the
 * surface re-fetches its detail. One hook shared by poker + retros (DRY) —
 * replaces client polling with server push.
 *
 * `wsPath` is the route under the API origin (e.g. '/api/agile/poker/sessions/<id>/ws'),
 * or null when nothing is open. `onChange` MUST be stable (useCallback) so the
 * socket isn't torn down every render. Reconnects with exponential backoff
 * (2 s doubling to a 60 s cap, reset once a socket opens), stops on an auth
 * close code, a changed token, or a room that never opens; the surface still
 * works (its poll backstop) if the socket can't be established.
 *
 * `auth` names WHICH token the room is behind, because the API has two: a
 * workspace-scoped one (`tenant`, the default — every collaborative room is
 * inside a workspace) and a person-scoped one (`web`), which is what the message
 * hub uses because a conversation with the platform owner is not workspace work.
 * Sending the wrong one 401s the upgrade and the surface silently stops
 * updating, so it is a parameter rather than a guess.
 */
/** First reconnect wait; doubles per consecutive failure up to {@link MAX_RETRY_MS}. */
const BASE_RETRY_MS = 2000;
const MAX_RETRY_MS = 60_000;
/**
 * Consecutive attempts that closed WITHOUT ever opening before we give up. A
 * browser never exposes the upgrade's HTTP status, so a 401/403 (expired token,
 * revoked membership) looks exactly like a network blip: close code 1006 before
 * `open`. A room that has never opened after this many backed-off tries (~4 min)
 * is treated as refused; a visibility regain grants one fresh round.
 */
const MAX_UNOPENED_ATTEMPTS = 8;
/** A socket must stay open this long before its close resets the backoff — a
 *  server that accepts and immediately drops must not earn a 2 s reconnect loop. */
const STABLE_OPEN_MS = 10_000;
/** Close codes a server sends to say "not allowed" — never retried. */
const AUTH_CLOSE_CODES = new Set([1008, 4001, 4003, 4401, 4403]);

function openSocket(url: string): WebSocket | null {
  try { return new WebSocket(url); } catch { return null; }
}

export function useRealtimeRoom(
  wsPath: string | null,
  onChange: () => void,
  auth: 'tenant' | 'web' = 'tenant',
): void {
  useEffect(() => {
    if (!wsPath) return;
    const token = auth === 'web' ? getStoredWebToken() : getStoredTenantToken();
    if (!token) return;

    const url = apiSocketUrl(wsPath, { token });

    let closed = false;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let delay = BASE_RETRY_MS;
    let unopened = 0;

    const currentToken = () => (auth === 'web' ? getStoredWebToken() : getStoredTenantToken());
    const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

    const scheduleReconnect = () => {
      if (closed) return;
      // Signed out / switched workspace: the socket URL carries a dead token, so
      // reconnecting only earns another refused upgrade. The remount with the new
      // token (wsPath/auth deps) owns the next connection.
      if (currentToken() !== token) return;
      if (unopened >= MAX_UNOPENED_ATTEMPTS) return;
      const wait = delay;
      delay = Math.min(delay * 2, MAX_RETRY_MS);
      retry = setTimeout(() => {
        retry = null;
        // A hidden tab waits for visibility (onVisibility reconnects) rather
        // than holding a socket nobody is looking at.
        if (hidden()) return;
        connect();
      }, wait);
    };

    const connect = () => {
      if (closed) return;
      let openedAt: number | null = null;
      const socket = openSocket(url);
      if (!socket) {
        unopened += 1;
        scheduleReconnect();
        return;
      }
      ws = socket;
      socket.onopen = () => { openedAt = Date.now(); };
      socket.onmessage = (ev) => {
        try {
          const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
          if (msg?.type === 'changed') onChange();
        } catch { /* ignore non-JSON frames */ }
      };
      socket.onclose = (ev) => {
        if (ws === socket) ws = null;
        if (closed) return;
        if (AUTH_CLOSE_CODES.has(ev.code)) return;
        if (openedAt != null && Date.now() - openedAt >= STABLE_OPEN_MS) {
          // A connection that held: the next drop starts from the short wait.
          unopened = 0;
          delay = BASE_RETRY_MS;
        } else if (openedAt == null) {
          unopened += 1;
        }
        scheduleReconnect();
      };
      socket.onerror = () => { try { socket.close(); } catch { /* ignore */ } };
    };

    const onVisibility = () => {
      if (closed || hidden() || ws || retry) return;
      if (currentToken() !== token) return;
      // Back in view with no live socket (paused while hidden, or gave up): one
      // fresh round, starting from the short wait.
      unopened = 0;
      delay = BASE_RETRY_MS;
      connect();
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      try { ws?.close(); } catch { /* ignore */ }
    };
  }, [auth, wsPath, onChange]);
}
