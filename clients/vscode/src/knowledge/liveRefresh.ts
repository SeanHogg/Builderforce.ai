/**
 * The whole-graph refresh throttle of a RUNNING root's live stream (PRD 38 §4.5, `knowledgeLive.ts`):
 * the view tracks deltas (patches) after its Run, and the whole picture — importance, communities,
 * findings — re-reads at most once per {@link FULL_REFRESH_MIN_MS} window while something changed.
 * A burst of triggers (a review landing, a branch switch, edits) coalesces into ONE rebuild: the
 * first request inside a closed window schedules a trailing rebuild for when it opens, so nothing
 * is lost and nothing runs more often than the window.
 */

/** At most one whole-graph refresh per this many ms while the root runs. */
export const FULL_REFRESH_MIN_MS = 30_000;

/** The throttle handle a `knowledgeLive.ts` whole-graph refresh lives behind. */
export interface LiveRefreshThrottle {
  /** Ask for the refresh: runs now when the window is open, else once when it next opens. */
  request(): void;
  /** Drops a scheduled refresh and closes the window (unlive / dispose). */
  dispose(): void;
}

/**
 * `refresh` is the whole-graph rebuild (a `loadGraph` by the view's last query). The first
 * request after the throttle's creation waits for one full window (the Run's own load is still
 * fresh); every later request waits for its own window since the last run.
 */
export function throttledRefresh(refresh: () => void | Promise<void>, windowMs: number = FULL_REFRESH_MIN_MS): LiveRefreshThrottle {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastRun = Date.now();

  const run = (): void => {
    lastRun = Date.now();
    timer = undefined;
    void refresh();
  };

  return {
    request(): void {
      if (timer) return; // a rebuild is already scheduled for when the window opens
      const wait = Math.max(0, windowMs - (Date.now() - lastRun));
      timer = setTimeout(run, wait);
    },
    dispose(): void {
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}
