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
