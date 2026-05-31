'use client';

import { useEffect } from 'react';
import { AUTH_API_URL, getStoredTenantToken } from '../auth';

/**
 * Subscribe to a collaborative session room over WebSocket. The server pushes a
 * `{ type: 'changed' }` frame after any mutation; we call `onChange` so the
 * surface re-fetches its detail. One hook shared by poker + retros (DRY) —
 * replaces client polling with server push.
 *
 * `wsPath` is the route under the API origin (e.g. '/api/agile/poker/sessions/<id>/ws'),
 * or null when nothing is open. `onChange` MUST be stable (useCallback) so the
 * socket isn't torn down every render. Reconnects with a short backoff; the
 * surface still works if the socket can't be established.
 */
export function useRealtimeRoom(wsPath: string | null, onChange: () => void): void {
  useEffect(() => {
    if (!wsPath) return;
    const token = getStoredTenantToken();
    if (!token) return;

    const base = AUTH_API_URL.replace(/^http/, 'ws');
    const url = `${base}${wsPath}?token=${encodeURIComponent(token)}`;

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
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
          if (msg?.type === 'changed') onChange();
        } catch { /* ignore non-JSON frames */ }
      };
      ws.onclose = () => { if (!closed) retry = setTimeout(connect, 2000); };
      ws.onerror = () => { try { ws?.close(); } catch { /* ignore */ } };
    };
    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      try { ws?.close(); } catch { /* ignore */ }
    };
  }, [wsPath, onChange]);
}
