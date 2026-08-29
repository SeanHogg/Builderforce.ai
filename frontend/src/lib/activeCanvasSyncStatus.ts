/**
 * "Is the canvas on screen saved somewhere else too" — reported by the canvas,
 * read by the session rail.
 *
 * The two are siblings under the app shell, not parent and child (`SessionList`
 * mounts in `Sidebar`, the canvas mounts as page content), so there is no prop
 * path between them. This is a notification store in the same shape as
 * `workspaceFileEvents.ts`: the browser tab holds at most one live canvas, so
 * the only state worth keeping is that one pair, not a history of past values.
 */

export type CanvasSyncState = 'connecting' | 'online' | 'reconnecting' | 'offline';

interface ActiveCanvasSync {
  sessionId: string;
  state: CanvasSyncState;
}

type Listener = () => void;

let current: ActiveCanvasSync | null = null;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** The canvas on screen reports its connection. `undefined` when it has none to report (a local-only board). */
export function setActiveCanvasSync(sessionId: string, state: CanvasSyncState | undefined): void {
  const next = state ? { sessionId, state } : null;
  if (current?.sessionId === next?.sessionId && current?.state === next?.state) return;
  current = next;
  notify();
}

/** Clear on unmount so a closed canvas cannot leave a stale status behind for the next one. */
export function clearActiveCanvasSync(sessionId: string): void {
  if (current?.sessionId !== sessionId) return;
  current = null;
  notify();
}

/** The reported state for `sessionId`, or `undefined` when it is not the live canvas. */
export function getActiveCanvasSync(sessionId: string | null): CanvasSyncState | undefined {
  return current && current.sessionId === sessionId ? current.state : undefined;
}

export function subscribeActiveCanvasSync(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
