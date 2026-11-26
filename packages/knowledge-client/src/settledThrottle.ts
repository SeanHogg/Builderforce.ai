/**
 * The ONE "never overlap, measure the window from when the last run SETTLED" throttle, for the
 * whole-graph re-reads of a graph that keeps changing under an open view (the host's live refresh,
 * the view's review-growth re-read).
 *
 * A burst of requests coalesces into ONE run: the first request inside a closed window schedules a
 * run for when it opens, so nothing is lost and nothing runs more often than the window. A run is
 * never started while the previous one is still in flight, and the window is measured from when the
 * previous run settled (resolved, rejected or threw), never from when it started: a build longer
 * than the window would otherwise overlap (and, on a host where the newer load aborts the older,
 * kill) its predecessor forever, handing the view a new graph every window. A request made during a
 * run schedules exactly ONE trailing run, `windowMs` after that run settled.
 */

/** What a run returns (or resolves) to say it did nothing: the window is not closed, so the next request may run at once. */
export const SKIPPED = Symbol('settledThrottle.skipped');

export interface SettledThrottleOptions {
  /** Called with what a run threw or rejected with, before the run settles. Absent: the error is dropped (the caller's run reports its own). */
  onError?: (error: unknown) => void;
  /** The first request runs at once (the window starts closed only after a run). Default: it waits one window from creation. */
  leading?: boolean;
}

export interface SettledThrottle {
  /** Ask for a run: now / when the window opens, or once after the run in flight settles. */
  request(): void;
  /** Drops a scheduled run and the trailing one; nothing runs or schedules after this. */
  dispose(): void;
}

export function settledThrottle(run: () => unknown, windowMs: number, options: SettledThrottleOptions = {}): SettledThrottle {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastSettled = options.leading ? Number.NEGATIVE_INFINITY : Date.now();
  let running = false;
  let trailing = false; // a request arrived while a run was in flight
  let disposed = false;

  const settle = (value?: unknown): void => {
    running = false;
    const skipped = value === SKIPPED;
    if (!skipped) lastSettled = Date.now();
    if (trailing) {
      trailing = false;
      if (!disposed && !skipped) timer = setTimeout(start, windowMs); // a skipped run leaves nothing to follow up
    }
  };

  const fail = (error: unknown): void => {
    try { options.onError?.(error); } finally { settle(); }
  };

  function start(): void {
    timer = undefined;
    if (disposed) return;
    running = true;
    try {
      Promise.resolve(run()).then(settle, fail);
    } catch (error) {
      fail(error);
    }
  }

  return {
    request(): void {
      if (disposed) return;
      if (running) { trailing = true; return; } // exactly ONE trailing run, after this one settles
      const wait = windowMs - (Date.now() - lastSettled);
      if (wait <= 0) { // the window is open (also when the clock moved past a scheduled run): run now
        if (timer) clearTimeout(timer);
        start();
        return;
      }
      if (timer) return; // a run is already scheduled for when the window opens
      timer = setTimeout(start, wait);
    },
    dispose(): void {
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      trailing = false;
    },
  };
}
