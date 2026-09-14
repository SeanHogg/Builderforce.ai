/**
 * Whether the ROOM people rail is tucked away.
 *
 * The chevron lives on the roster itself; this file is only the memory of that
 * choice, so a reload does not spring the panel back open. Default is expanded —
 * a first visit should see who is in the room. Goes through `@/lib/storage` so
 * private mode / SSR never throw and the raw-storage / silent-catch ratchets stay put.
 */

import { readLocal, writeLocal } from '@/lib/storage';

export const ROOM_ROSTER_STORAGE_KEY = 'builderforce:create:room-roster';

/** Collapsed only when storage explicitly says so. Anything else is expanded. */
export function readRoomRosterCollapsed(): boolean {
  return readLocal(ROOM_ROSTER_STORAGE_KEY) === 'collapsed';
}

export function writeRoomRosterCollapsed(collapsed: boolean): void {
  writeLocal(ROOM_ROSTER_STORAGE_KEY, collapsed ? 'collapsed' : 'expanded');
}
