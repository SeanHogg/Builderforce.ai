/**
 * Series arithmetic both packages need and used to carry separately: the API's
 * insight forecasts and the canvas's statistics, notebook and tabular windows each
 * re-derived the same least-squares line and the same trailing mean. Pure, so
 * every function is unit-testable in isolation, and unrounded — each consumer
 * applies its own rounding policy (the canvas rounds to six places; the API does
 * not), which is the one thing that legitimately differed between the copies.
 */

/** Least-squares fit of `values` against their own index (x = 0, 1, 2, …). */
export interface LinearFit {
  slope: number;
  intercept: number;
  /** Coefficient of determination in [0, 1]; 1 when the series has no spread. */
  r2: number;
}

/**
 * Ordinary least squares over the index. `null` for fewer than two points — a
 * line needs two — and for a degenerate x spread, which cannot happen with an
 * index but is guarded so a caller never divides by zero.
 */
export function linearFit(values: readonly number[]): LinearFit | null {
  const length = values.length;
  if (length < 2) return null;
  const meanX = (length - 1) / 2;
  let meanY = 0;
  for (const value of values) meanY += value;
  meanY /= length;
  let covariance = 0;
  let varianceX = 0;
  for (let index = 0; index < length; index += 1) {
    covariance += (index - meanX) * (values[index]! - meanY);
    varianceX += (index - meanX) ** 2;
  }
  if (varianceX <= 0) return null;
  const slope = covariance / varianceX;
  const intercept = meanY - slope * meanX;
  let residual = 0;
  let total = 0;
  for (let index = 0; index < length; index += 1) {
    residual += (values[index]! - (intercept + slope * index)) ** 2;
    total += (values[index]! - meanY) ** 2;
  }
  return { slope, intercept, r2: total <= 0 ? 1 : Math.max(0, Math.min(1, 1 - residual / total)) };
}

/**
 * Trailing simple moving average. Point i is the mean of the up-to-`window`
 * values ending at i, so the head of the series is kept — it just averages fewer
 * points until the window fills. `window` is clamped to at least 1.
 */
export function movingAverage(values: readonly number[], window: number): number[] {
  const width = Math.max(1, Math.floor(window));
  const out: number[] = [];
  let running = 0;
  for (let index = 0; index < values.length; index += 1) {
    running += values[index]!;
    if (index >= width) running -= values[index - width]!;
    out.push(running / Math.min(width, index + 1));
  }
  return out;
}
