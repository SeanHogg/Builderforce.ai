'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  applyPresenceFrame, expirePresence, isPresenceFrame, retireSocket, LIVE_PRESENCE_TTL_MS, type LivePresenceMap,
} from './livePresence';

/**
 * ONE store for a canvas's ephemeral presence, whichever socket carries it.
 *
 * A board has one live transport at a time — the server session's relay for a saved
 * board, the guest room's for an account-less shared one — and both speak the same two
 * frames: a `canvas.presence` update, and a `presence`/`leave` that names a socket.
 * Folding them used to live inline in `CreationCanvas`, wired to the server socket only,
 * which is why an account-less room never showed a peer's cursor, typing or Brain run:
 * the frames had nowhere to land. A transport hands this hook ANY frame it received;
 * the hook decides whether it is presence. Expiry runs here too, so a peer whose socket
 * died without a `leave` is retired on either transport.
 */
export interface LivePresenceStore {
  live: LivePresenceMap;
  /** Hand over any frame a relay socket received; frames that are not presence are ignored. */
  receive: (frame: unknown) => void;
  /** Forget everyone — this client's socket closed, so nobody's state is live any more. */
  clear: () => void;
}

export function useLivePresence(): LivePresenceStore {
  const [live, setLive] = useState<LivePresenceMap>({});

  const receive = useCallback((frame: unknown) => {
    if (isPresenceFrame(frame)) {
      setLive((current) => applyPresenceFrame(current, frame, Date.now()));
      return;
    }
    const leave = frame as { type?: unknown; action?: unknown; peer?: { id?: unknown } } | null;
    if (leave?.type === 'presence' && leave.action === 'leave') {
      const socketId = String(leave.peer?.id ?? '');
      setLive((current) => retireSocket(current, socketId));
    }
  }, []);

  const clear = useCallback(() => setLive((current) => (Object.keys(current).length ? {} : current)), []);

  // Retire pointers nobody retracted (a closed lid, a dropped network). On an empty map
  // this returns the same map, so an idle board never re-renders for it.
  useEffect(() => {
    const timer = window.setInterval(
      () => setLive((current) => expirePresence(current, Date.now())),
      LIVE_PRESENCE_TTL_MS / 2,
    );
    return () => window.clearInterval(timer);
  }, []);

  return useMemo(() => ({ live, receive, clear }), [live, receive, clear]);
}
