/**
 * The ONE way a component keeps a resource live by polling.
 *
 * Fetch-on-mount plus `setInterval` was hand-rolled two dozen times across the
 * product, and each copy made its own choices: one paused when the tab was hidden
 * (PollJoin), one bounded itself (PullRequestPanel), none backed off after a
 * failure, and six independent thirty-second notification polls ran on one page.
 * This hook is that decision made once:
 *
 *   • it reads the LATEST `load` through a ref, so a caller passes a plain inline
 *     function and never needs a memoised callback or a dependency list that tears
 *     the timer down on every render;
 *   • it skips ticks while the tab is hidden and loads once on return (a phone in a
 *     pocket must not fetch a tally, and a tab you come back to must be current);
 *   • a rejected load doubles the wait, up to eight intervals, and a successful one
 *     resets it — an outage costs one request a minute, not one every few seconds;
 *   • a tick never overlaps the one before it;
 *   • `maxTicks` bounds a poll that only exists to watch something finish.
 *
 * `load` receives an `AbortSignal` that fires when the poll stops (unmount,
 * `enabled` going false, a `restartKey` change): check it before writing state
 * from a late response.
 */
import { useCallback, useEffect, useRef } from 'react';

export interface PolledResourceOptions {
  intervalMs: number;
  /** `false` stops the poll entirely (and skips the immediate load). Default true. */
  enabled?: boolean;
  /** Load once as the poll starts. Default true. */
  immediate?: boolean;
  /** Skip ticks while the document is hidden; load once on return. Default true. */
  pauseWhenHidden?: boolean;
  /** Double the wait after a rejected load, capped at eight intervals. Default true. */
  backoffOnError?: boolean;
  /** Stop after this many scheduled ticks (the immediate load is not one). */
  maxTicks?: number;
  /** A value whose change restarts the poll (with its immediate load). */
  restartKey?: string | number | null;
}

const MAX_BACKOFF_FACTOR = 8;

export function usePolledResource(
  load: (signal: AbortSignal) => unknown,
  {
    intervalMs,
    enabled = true,
    immediate = true,
    pauseWhenHidden = true,
    backoffOnError = true,
    maxTicks,
    restartKey = null,
  }: PolledResourceOptions,
): { refresh: () => void } {
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; });
  const runRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let delay = intervalMs;
    let ticks = 0;
    let inFlight = false;

    const hidden = () => pauseWhenHidden && typeof document !== 'undefined' && document.visibilityState === 'hidden';

    const run = async () => {
      if (controller.signal.aborted || inFlight || hidden()) return;
      inFlight = true;
      try {
        await loadRef.current(controller.signal);
        delay = intervalMs;
      } catch {
        if (backoffOnError) delay = Math.min(delay * 2, intervalMs * MAX_BACKOFF_FACTOR);
      } finally {
        inFlight = false;
      }
    };
    runRef.current = run;

    const schedule = () => {
      if (controller.signal.aborted) return;
      timer = setTimeout(async () => {
        if (maxTicks != null && ++ticks > maxTicks) return;
        await run();
        schedule();
      }, delay);
    };

    const onVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') void run();
    };
    if (pauseWhenHidden && typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

    if (immediate) void run();
    schedule();

    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
      if (pauseWhenHidden && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      runRef.current = async () => undefined;
    };
  }, [enabled, intervalMs, immediate, pauseWhenHidden, backoffOnError, maxTicks, restartKey]);

  const refresh = useCallback(() => { void runRef.current(); }, []);
  return { refresh };
}
