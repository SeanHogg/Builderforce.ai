import { useEffect, useRef, useState } from 'react';

/** How often a running chat re-reads its row (the server caches a chat's spend this long). */
export const RUN_REFRESH_MS = 30_000;

/**
 * THE refresh beat for what a run moves on the chat row (its spend & savings): a counter
 * that bumps when a run SETTLES and every `intervalMs` WHILE it runs — so a long run's
 * spend pill climbs as it goes instead of jumping only at the end — and never ticks
 * while the chat is idle. Hosts re-read the chat when it changes (web, VS Code, Rovr).
 */
export function useRunRefreshTick(running: boolean, intervalMs: number = RUN_REFRESH_MS): number {
  const [tick, setTick] = useState(0);
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) setTick((n) => n + 1);
    wasRunning.current = running;
    if (!running) return;
    const timer = setInterval(() => setTick((n) => n + 1), intervalMs);
    return () => clearInterval(timer);
  }, [running, intervalMs]);
  return tick;
}
