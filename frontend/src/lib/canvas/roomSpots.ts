import { readLocalJson, writeLocalJson } from '@/lib/storage';

/**
 * WHERE THINGS STAND IN THE ROOM — per viewer, per browser, per thing.
 *
 * The session's diorama and every 3D creation in the room are placed the same way:
 * one point on the floor plane, from which the anchor (table, floor, wall) is derived
 * on read. So there is one spot shape and one storage rule, and a thing is told apart
 * from the session by its key, never by a second store.
 *
 * Per browser, like the surface preference and the folded bar: where something sits
 * is how one person chooses to read the room, not a fact about the session that a
 * collaborator's placement should overwrite.
 */

/** The two numbers a person actually chooses — everything else is derived. */
export interface RoomSpot {
  x: number;
  z: number;
}

const STORAGE_PREFIX = 'builderforce:create:room-session:';

/**
 * The storage key for the session itself (no `itemId`) or for one thing standing in
 * its room. The session's key is the one it has always had, so a spot a person left
 * before creations stood in the room is still where they left it.
 */
export function roomSpotKey(sessionId: string, itemId?: string): string {
  return itemId ? `${STORAGE_PREFIX}${sessionId}:${itemId}` : `${STORAGE_PREFIX}${sessionId}`;
}

/** The stored spot, or `fallback` when there is none or it is corrupt — never a throw. */
export function readRoomSpot(key: string, fallback: RoomSpot): RoomSpot {
  const parsed = readLocalJson<Partial<RoomSpot>>(key);
  if (!parsed || typeof parsed.x !== 'number' || typeof parsed.z !== 'number') return fallback;
  return { x: parsed.x, z: parsed.z };
}

/**
 * Best effort: where storage is unavailable (server, private mode) the spot is simply
 * not remembered. Only the spot is written — the anchor is re-derived on read, so a
 * change to the table's radius moves every stored thing onto the right surface.
 */
export function writeRoomSpot(key: string, spot: RoomSpot): void {
  writeLocalJson(key, { x: spot.x, z: spot.z });
}
