/** Numeric helpers shared across metrics/insights modules. */

/**
 * Clamp a raw score into the canonical 0..100 band. The verbatim
 * `Math.max(0, Math.min(100, n))` that every metric/insight scorer used — one
 * definition so a "score" always means the same range.
 */
export function clampScore(n: number): number {
  return Math.max(0, Math.min(100, n));
}
