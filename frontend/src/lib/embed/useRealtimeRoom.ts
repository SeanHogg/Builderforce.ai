import { useEffect } from 'react';
import { getStoredTenantToken, getStoredWebToken } from '../auth';
import { apiSocketUrl } from '../apiSocket';
import { createReconnector, openSocket } from '../polling/reconnectPolicy';
import { createCoalescedRefresh } from '../polling/coalescedRefresh';

/**
 * Subscribe to a collaborative session room over WebSocket. The server pushes a
 * `{ type: 'changed' }` frame after any mutation; we call `onChange` so the
 * surface re-fetches its detail. One hook shared by poker + retros (DRY) —
 * replaces client polling with server push.
 *
 * `wsPath` is the route under the API origin (e.g. '/api/agile/poker/sessions/<id>/ws'),
 * or null when nothing is open. `onChange` MUST be stable (useCallback) so the
 * socket isn't torn down every render. Reconnects follow `reconnectPolicy`
 * (backoff, auth close codes, a room that never opens, hidden tab) and also stop
 * on a changed token; the surface still works (its poll backstop) if the socket
 * can't be established. A burst of `changed` frames is coalesced into one call.
 *
 * `auth` names WHICH token the room is behind, because the API has two: a
 * workspace-scoped one (`tenant`, the default — every collaborative room is
 * inside a workspace) and a person-scoped one (`web`), which is what the message
 * hub uses because a conversation with the platform owner is not workspace work.
 * Sending the wrong one 401s the upgrade and the surface silently stops
 * updating, so it is a parameter rather than a guess.
 */
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
    const currentToken = () => (auth === 'web' ? getStoredWebToken() : getStoredTenantToken());

    let ws: WebSocket | null = null;
    // A burst of mutations is one re-fetch, not one per frame.
    const refresh = createCoalescedRefresh(() => onChange());
    const reconnector = createReconnector({
      // Signed out / switched workspace: the socket URL carries a dead token, so
      // reconnecting only earns another refused upgrade. The remount with the new
      // token (wsPath/auth deps) owns the next connection.
      canRetry: () => currentToken() === token,
      connect: () => {
        const socket = openSocket(url);
        if (!socket) { reconnector.closed(); return; }
        ws = socket;
        socket.onopen = () => reconnector.opened();
        socket.onmessage = (ev) => {
          try {
            const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
            if (msg?.type === 'changed') refresh.trigger();
          } catch { /* ignore non-JSON frames */ }
        };
        socket.onclose = (ev) => {
          if (ws === socket) ws = null;
          reconnector.closed(ev?.code);
        };
        socket.onerror = () => { try { socket.close(); } catch { /* ignore */ } };
      },
    });
    reconnector.start();

    return () => {
      reconnector.stop();
      refresh.cancel();
      try { ws?.close(); } catch { /* ignore */ }
    };
  }, [auth, wsPath, onChange]);
}
