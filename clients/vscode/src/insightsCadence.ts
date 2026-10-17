/**
 * When — and how — the Insights surfaces talk to the gateway. Pure (no `vscode`),
 * so the cadence is unit-testable; `insights.ts` owns the timers and the stream.
 *
 * Every builder-insights request is one the platform has to serve, and the SSE
 * stream builds a fresh snapshot server-side every 30 s it stays open. An editor
 * left open used to hold that stream (and reopen it 2 s after every close) around
 * the clock — ~120 snapshot builds an hour, which alone kept the database awake.
 * Now the stream only runs while someone can actually read it.
 */

/** `stream` = live SSE (the Health view is on screen in an attended window);
 *  `poll` = slow one-shot reads of the server-cached snapshot (only the status bar
 *  is showing); `off` = nobody is looking, or signed out — no requests at all. */
export type InsightsMode = "off" | "stream" | "poll";

export interface InsightsAudience {
  signedIn: boolean;
  /** Window focused AND recently used (`WindowState.focused && .active`). */
  attended: boolean;
  /** The Health view (home of the "Spend today" rows) is visible. */
  viewVisible: boolean;
}

export const INSIGHTS_CADENCE = {
  /** After the server closes a healthy stream (~5 min), wait this long before reopening. */
  RECONNECT_MS: 10_000,
  /** Status-bar-only refresh while the window is attended but the Health view is hidden. */
  POLL_MS: 5 * 60_000,
  /** Focus/activity flips reopen the stream at most this often — `active` flips a lot. */
  REFRESH_MIN_GAP_MS: 30_000,
  /** After a failed stream/fetch: the first retry, doubling up to the ceiling — the
   *  same ladder `attention.ts` climbs. */
  ERROR_MIN_MS: 15_000,
  ERROR_MAX_MS: 5 * 60_000,
} as const;

export function insightsMode(a: InsightsAudience): InsightsMode {
  if (!a.signedIn || !a.attended) return "off";
  return a.viewVisible ? "stream" : "poll";
}

/** The next wait after a failure, given the current one (0 = no failure yet). */
export function nextErrorBackoff(currentMs: number): number {
  return currentMs <= 0
    ? INSIGHTS_CADENCE.ERROR_MIN_MS
    : Math.min(currentMs * 2, INSIGHTS_CADENCE.ERROR_MAX_MS);
}

/**
 * How long to wait before (re)starting `mode`, given when the last good snapshot
 * landed and until when an error backoff holds. `fresh` (manual refresh, sign-in,
 * project switch) skips both — the caller knows the state moved.
 */
export function insightsStartDelay(
  mode: InsightsMode,
  now: number,
  lastFrameAt: number,
  errorUntil: number,
  fresh: boolean,
): number {
  if (mode === "off") return 0;
  if (fresh) return 0;
  const sinceFrame = mode === "stream" ? INSIGHTS_CADENCE.REFRESH_MIN_GAP_MS : INSIGHTS_CADENCE.POLL_MS;
  const frameDelay = lastFrameAt > 0 ? lastFrameAt + sinceFrame - now : 0;
  return Math.max(0, frameDelay, errorUntil - now);
}
