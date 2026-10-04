/** This client's presence relay, over whichever transport the board has open. */
import { type RefObject, useState } from 'react';
import { CANVAS_PRESENCE_FRAME, type CanvasPresenceState } from '@builderforce/creation-canvas-contract';
import { createPresenceRelay, type PresenceRelay } from '@/domains/canvas/application/PresenceRelay';
import { PRESENCE_SEND_INTERVAL_MS } from '@/lib/canvas/livePresence';

/**
 * The TRANSPORT under the relay: this board's socket, or — for an account-less board
 * shared through a guest room, which has no server socket — that room's relay, which
 * carries the same frame. Both are read through their refs when a frame is SENT.
 */
function createCanvasPresenceRelay(
  liveSocketRef: RefObject<WebSocket | null>,
  sendRoomPresenceRef: RefObject<(state: CanvasPresenceState) => boolean>,
): PresenceRelay {
  return createPresenceRelay({
    deliver: (state) => {
      const socket = liveSocketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return sendRoomPresenceRef.current(state);
      try { socket.send(JSON.stringify({ type: CANVAS_PRESENCE_FRAME, ...state })); return true; }
      catch { return false; } // the socket is closing; the poll takes over
    },
  }, { intervalMs: PRESENCE_SEND_INTERVAL_MS });
}

/**
 * This client's ephemeral state on the relay — cursor, viewport, selection, typing.
 *
 * The coalescing throttle that makes a fast drag look like a drag rather than a teleport
 * lives in `application/PresenceRelay.ts`; this builds it ONCE over the board's transport
 * and keeps that one relay for the life of the canvas. Silence when neither channel is
 * open is correct: on a saved board the 8-second presence poll is the fallback and
 * carries the cursor on its own.
 */
export function useCanvasPresenceRelay(
  liveSocketRef: RefObject<WebSocket | null>,
  sendRoomPresenceRef: RefObject<(state: CanvasPresenceState) => boolean>,
): PresenceRelay {
  const [relay] = useState(() => createCanvasPresenceRelay(liveSocketRef, sendRoomPresenceRef));
  return relay;
}
