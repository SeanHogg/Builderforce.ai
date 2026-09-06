/** Numeric helpers shared across metrics/insights modules. */

/**
 * Clamp `value` into the inclusive `[min, max]` band — the general form the
 * per-module `clamp`/`clampPct` copies collapsed into. `Math.min` is applied
 * last so `value` never exceeds `max` even when `min > max`.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Clamp a raw score into the canonical 0..100 band. The verbatim
 * `Math.max(0, Math.min(100, n))` that every metric/insight scorer used — one
 * definition so a "score" always means the same range.
 */
export function clampScore(n: number): number {
  return clamp(n, 0, 100);
}

/**
 * Clamp into the unit interval, and treat a non-finite input as 0 — the shape
 * eight scorers had each written (`Number.isFinite(n) ? … : 0`). A ratio that is
 * NaN because its denominator was zero is "no signal", not a crash.
 */
export function clamp01(n: number): number {
  return Number.isFinite(n) ? clamp(n, 0, 1) : 0;
}
