/**
 * THE byte-count formatter. Six copies existed — the canvas documents helper
 * (whose own docblock said "shared so every file surface rounds the same
 * way"), a byte-identical `formatFileSize` in the creation node, two
 * `toFixed(1)`-everywhere variants in the site publish/release panels, a
 * `while`-loop variant in the talent vocabulary and an inline ternary in the
 * agent-host workspace — so the same 1,536 bytes read `1.5 KB`, `1.5KB` and
 * `1.50 KB` depending on which panel showed it.
 *
 * Rounding rule: whole bytes stay whole; above that, one decimal below 10 and
 * an integer at 10 and beyond. Callers that want an EMPTY label for an
 * unknown size (0 / non-finite) guard before calling, as the file surfaces
 * already do — a zero is a real size, not a missing one.
 */
const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(bytes: number): string {
  const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  const unit = Math.min(SIZE_UNITS.length - 1, Math.max(0, Math.floor(Math.log(Math.max(safe, 1)) / Math.log(1024))));
  const value = safe / 1024 ** unit;
  return `${unit !== 0 && value < 10 ? value.toFixed(1) : String(Math.round(value))} ${SIZE_UNITS[unit]}`;
}
