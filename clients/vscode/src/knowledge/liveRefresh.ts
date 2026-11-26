/**
 * The whole-graph refresh throttle of a RUNNING root's live stream (PRD 38 §4.5, `knowledgeLive.ts`):
 * the view tracks deltas (patches) after its Run, and the whole picture — importance, communities,
 * findings — re-reads at most once per {@link FULL_REFRESH_MIN_MS} window while something changed.
 * The throttle itself is the ONE `settledThrottle` (`@builderforce/knowledge-client`), which the view's
 * review-growth re-read shares: bursts coalesce into one run, a run never starts while the previous
 * is in flight, and the window is measured from when the previous run settled.
 */

import { settledThrottle, type SettledThrottle } from "@builderforce/knowledge-client";

/** At most one whole-graph refresh per this many ms while the root runs. */
export const FULL_REFRESH_MIN_MS = 30_000;

/** The throttle handle a `knowledgeLive.ts` whole-graph refresh lives behind. */
export type LiveRefreshThrottle = SettledThrottle;

/** The first request after creation waits one full window (the Run's own load is still fresh). */
export function throttledRefresh(refresh: () => void | Promise<void>, windowMs: number = FULL_REFRESH_MIN_MS): LiveRefreshThrottle {
  return settledThrottle(refresh, windowMs);
}
