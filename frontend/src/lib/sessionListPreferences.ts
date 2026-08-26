/**
 * How tall the sidebar's sessions block (`SessionList`) renders.
 *
 * It defaults to 42% of the rail's height, which is enough for the New Canvas
 * button, the active canvas and a couple of recent rows before the internal
 * list starts scrolling. A dragged height overrides that percentage the same
 * way a dragged Brain-dock width overrides its size preset — see
 * `brainDockPreferences.ts`, the sibling this mirrors.
 */

export const SESSION_LIST_HEIGHT_STORAGE_KEY = 'builderforce:nav:session-list-height';

export const SESSION_LIST_MIN_HEIGHT = 140;
export const SESSION_LIST_MAX_HEIGHT = 640;

export function clampSessionListHeight(height: number): number {
  if (!Number.isFinite(height)) return SESSION_LIST_MIN_HEIGHT;
  return Math.round(Math.min(SESSION_LIST_MAX_HEIGHT, Math.max(SESSION_LIST_MIN_HEIGHT, height)));
}

/** Null keeps the default 42%-of-rail height; a drag sets an explicit px value. */
export function readSessionListHeight(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SESSION_LIST_HEIGHT_STORAGE_KEY);
    if (raw == null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? clampSessionListHeight(parsed) : null;
  } catch {
    return null;
  }
}

export function writeSessionListHeight(height: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SESSION_LIST_HEIGHT_STORAGE_KEY, String(clampSessionListHeight(height)));
  } catch { /* storage can be unavailable in hardened contexts */ }
}
