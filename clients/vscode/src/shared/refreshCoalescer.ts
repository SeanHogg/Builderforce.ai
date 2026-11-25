/**
 * Leading + trailing throttle for "something changed — go refetch".
 *
 * A burst of signals (an agent run creating and linking ten tickets in a row, each
 * one a platform write) used to become ten refetches of the same list. With this in
 * front of the refetch, the FIRST request runs at once — an isolated rename or sign-in
 * still repaints immediately — and everything that arrives inside the window collapses
 * into ONE trailing run when the window closes, which then opens a new window.
 *
 * The owner of the refetch holds the coalescer, so every caller of its `refresh()` is
 * throttled the same way without having to know about it.
 */
export interface RefreshCoalescer {
  /** Ask for a run: now if the window is closed, else once at the window's end. */
  request(): void;
  dispose(): void;
}

export function createRefreshCoalescer(run: () => void | Promise<void>, windowMs: number): RefreshCoalescer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;
  let disposed = false;

  const fire = (): void => {
    pending = false;
    // A failed run is the owner's to surface; the throttle only decides WHEN.
    void Promise.resolve().then(run).catch(() => undefined);
    timer = setTimeout(windowClosed, windowMs);
  };
  const windowClosed = (): void => {
    timer = null;
    if (pending && !disposed) fire();
  };

  return {
    request(): void {
      if (disposed) return;
      if (timer) {
        pending = true;
        return;
      }
      fire();
    },
    dispose(): void {
      disposed = true;
      pending = false;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
