/**
 * Human-readable elapsed/duration formatting, shared by the ceremony timers and
 * scorecards. No such helper existed in the app.
 */

/** "45s" / "1m 23s" / "1h 04m". Clamps negatives to 0. */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

/**
 * The length of a span between two timestamps, or `null` while it is still open —
 * the admin-access and impersonation session lists read that as "Active".
 */
export function formatElapsedBetween(startedAt: string, endedAt: string | null | undefined): string | null {
  if (!endedAt) return null;
  return formatDuration(new Date(endedAt).getTime() - new Date(startedAt).getTime());
}

/**
 * Day-scale elapsed formatting: "7d 04h" / "1h 04m" / "45s".
 *
 * {@link formatDuration} is right for timers and cooldowns but degrades past a day
 * ("168h 00m" for a week), and a week is exactly the scale a stuck ticket or an orphaned
 * background pass sits at — the unit a reader reasons about it in. Clamps negatives to 0.
 */
export function formatAge(ms: number): string {
  const days = Math.floor(Math.max(0, ms) / 86_400_000);
  if (days < 1) return formatDuration(ms);
  const hours = Math.floor((Math.max(0, ms) % 86_400_000) / 3_600_000);
  return `${days}d ${String(hours).padStart(2, '0')}h`;
}

/** Compact hours value for scorecards: "3.2h" / "—" when null. */
export function formatHours(hours: number | null | undefined): string {
  if (hours == null) return '—';
  return `${hours.toFixed(1)}h`;
}

/**
 * The transcript's reading: "52s" / "1m 14s" / "2m" — a whole minute drops its
 * zero seconds, because "2m 00s" in a run summary reads as a timer, not a fact.
 */
export function formatDurationCompact(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

/**
 * A clock reading — "m:ss", or "mm:ss" with `padMinutes` — for the places a
 * person reads elapsed time the way a stopwatch shows it: a video cut, an
 * emulation session. Takes SECONDS, because both of those hold seconds.
 */
export function formatClock(totalSeconds: number, options: { padMinutes?: boolean } = {}): string {
  const whole = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(whole / 60);
  const seconds = String(whole % 60).padStart(2, '0');
  return `${options.padMinutes ? String(minutes).padStart(2, '0') : minutes}:${seconds}`;
}

/** Sub-second precision for traces: "850ms" / "1.2s" / "3.5m". */
export function formatDurationPrecise(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

/**
 * A span read at the scale it sits at: "mm:ss" under an hour, "3h 05m" under a
 * day, "2d 03h" past it. Takes SECONDS — the survey and DevEx metrics arrive so.
 */
export function formatSpan(totalSeconds: number): string {
  const sec = Math.max(0, totalSeconds);
  if (sec < 3600) return formatClock(sec, { padMinutes: true });
  if (sec < 86_400) return `${Math.floor(sec / 3600)}h ${String(Math.round((sec % 3600) / 60)).padStart(2, '0')}m`;
  return `${Math.floor(sec / 86_400)}d ${String(Math.round((sec % 86_400) / 3600)).padStart(2, '0')}h`;
}
