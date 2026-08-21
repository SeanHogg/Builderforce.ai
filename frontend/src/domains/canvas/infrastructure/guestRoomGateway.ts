/**
 * GUEST ROOM GATEWAY — `ShareCanvasSession`'s port, over the real room API.
 *
 * The adapter is thin ON PURPOSE. Everything interesting about sharing a board
 * — echo suppression, the hydration gate, what to say when a board is refused —
 * is in the use case, where it can be tested without a network. What is left
 * here is the only part that genuinely cannot be: which HTTP call is which, and
 * the fact that `createGuestRoom` reports failure as a bare string.
 *
 * That last translation is the reason this file is not "ceremony over a client".
 * `GuestRoomState | 'unavailable' | 'gone' | 'network'` is a union you have to
 * narrow with `typeof x === 'string'`, and the use case doing that would be the
 * use case knowing how the transport spells its errors. Here it is one line, and
 * the port's vocabulary is the canvas's.
 */

import {
  createGuestRoom,
  fetchGuestRoomCanvas,
  leaveGuestRoom,
  pushGuestRoomCanvas,
} from '@/lib/guestRoomApi';
import type { GuestRoomFailure, GuestRoomPort, SerializedBoard } from '../application/ShareCanvasSession';

/**
 * @param announce  How this device tells the room a new board is up. Supplied by
 *                  the surface because it comes off the live room subscription
 *                  (`useGuestRoom`), which is a hook and cannot be called here.
 */
export function createGuestRoomGateway(announce: () => void): GuestRoomPort {
  return {
    async open(hostName, title) {
      const state = await createGuestRoom(hostName, title, 'canvas');
      return typeof state === 'string' ? (state as GuestRoomFailure) : { code: state.code };
    },
    fetchBoard: (code) => fetchGuestRoomCanvas(code),
    pushBoard: (code, board: SerializedBoard) => pushGuestRoomCanvas(code, board),
    announce,
    leave: (code) => leaveGuestRoom(code),
  };
}
