/**
 * monitorCheckStamp — when a sweep evaluation of a monitor is worth a row write.
 * Pure; no I/O.
 *
 * `applyResult` used to UPDATE `monitors.last_checked_at` (+ `consecutive_failures`)
 * for every active sweep-driven monitor on every 5-minute tick, even when the monitor
 * was healthy and nothing about it had changed — and a heartbeat that had never
 * signalled appended a `check/unknown` event to `monitor_events` on every tick too.
 * The schema has no per-monitor check cadence (`config.intervalSeconds` is a
 * heartbeat's staleness WINDOW, not how often to look), so evaluation still happens on
 * every tick — a breach must page within one tick — but the WRITE happens only when:
 *
 *   - `consecutive_failures` would change (every breaching tick increments it, so a
 *     breach is always recorded), or
 *   - the monitor has never been stamped, or
 *   - the stamp is older than {@link MONITOR_CHECK_STAMP_REFRESH_MS}, so
 *     `last_checked_at` still proves the sweep is alive, at a fraction of the writes.
 *
 * Status transitions (breach / recovery) are written by their own paths regardless.
 */

/** Longest `last_checked_at` may trail the real last evaluation while nothing changes. */
export const MONITOR_CHECK_STAMP_REFRESH_MS = 30 * 60_000;

export function monitorCheckNeedsWrite(
  monitor: { consecutiveFailures: number; lastCheckedAt: Date | string | null },
  nextConsecutiveFailures: number,
  now: number = Date.now(),
): boolean {
  if (nextConsecutiveFailures !== monitor.consecutiveFailures) return true;
  if (!monitor.lastCheckedAt) return true;
  return now - new Date(monitor.lastCheckedAt).getTime() >= MONITOR_CHECK_STAMP_REFRESH_MS;
}
