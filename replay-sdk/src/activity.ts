/**
 * Active time: the visitor's time on the page with idle gaps longer than
 * 30 s left out. Cumulative per visit (persisted in `VisitState`), sent as
 * `activeMs` on every chunk so a retried or lost chunk never double-counts.
 */

export const ACTIVE_IDLE_GAP_MS = 30_000;

export interface ActivityState {
  activeMs: number;
  lastActiveAt: number | null;
}

/** Record activity at `now` (epoch ms). Gaps up to 30 s count as active. */
export function touchActivity(state: ActivityState, now: number): void {
  const last = state.lastActiveAt;
  if (last !== null) {
    const gap = now - last;
    if (gap > 0 && gap <= ACTIVE_IDLE_GAP_MS) state.activeMs += gap;
  }
  state.lastActiveAt = now;
}
