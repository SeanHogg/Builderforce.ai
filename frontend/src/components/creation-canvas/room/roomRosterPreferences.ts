/**
 * Whether the ROOM people rail is tucked away.
 *
 * The chevron lives on the roster itself; this file is only the memory of that
 * choice, so a reload does not spring the panel back open. Default is expanded —
 * a first visit should see who is in the room. Mirrors `brainDockPreferences`:
 * same defensive read, same silent write, so canvas preferences behave one way.
 */

export const ROOM_ROSTER_STORAGE_KEY = 'builderforce:create:room-roster';

/** Collapsed only when storage explicitly says so. Anything else is expanded. */
export function readRoomRosterCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(ROOM_ROSTER_STORAGE_KEY) === 'collapsed';
  } catch {
    return false;
  }
}

export function writeRoomRosterCollapsed(collapsed: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ROOM_ROSTER_STORAGE_KEY, collapsed ? 'collapsed' : 'expanded');
  } catch { /* private mode: the session still toggles */ }
}
