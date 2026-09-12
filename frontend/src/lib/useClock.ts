import { useEffect, useState } from 'react';

/**
 * The current time, re-read every `intervalMs`.
 *
 * For state that is a function of the clock and nothing else — an exam window that
 * opens at 09:00, a deadline that passes — which no edit will ever re-render. A pure
 * function takes `now` as a parameter so it can be tested; this is where a component
 * gets the `now` to hand it.
 */
export function useClock(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
