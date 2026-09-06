/**
 * Forecasting & anomaly primitives — the small, PURE math layer the insight
 * lenses use to turn a historical series into a forward projection plus a set of
 * flagged outliers. Zero DB / zero I/O so every function is unit-testable in
 * isolation (mirrors financeInsights' `projectMonthlyBurn` and workforceMetrics'
 * `rollupDora` convention of keeping the arithmetic pure and the query separate).
 *
 * Consumed by application/insights/forecastSeries.ts (which pulls the concrete
 * series off the existing collectors) and, through it, the /api/insights/forecast
 * route. Nothing here knows about Hono, drizzle, or the shape of a lens payload.
 */

import { linearFit, movingAverage as sharedMovingAverage } from '@builderforce/creation-canvas-contract';

/** A finite number or 0 — guards every reducer against NaN/Infinity leaking in. */
function fin(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

/** Arithmetic mean of a series (0 for an empty series). */
export function mean(series: number[]): number {
  if (series.length === 0) return 0;
  return series.reduce((a, b) => a + fin(b), 0) / series.length;
}

/** Population standard deviation of a series (0 for <2 points). */
export function stdDev(series: number[]): number {
  if (series.length < 2) return 0;
  const m = mean(series);
  const variance = series.reduce((a, b) => a + (fin(b) - m) ** 2, 0) / series.length;
  return Math.sqrt(variance);
}

/**
 * Trailing simple moving average. Point i is the mean of the up-to-`window`
 * values ending at i (so the head of the series isn't dropped — it just averages
 * fewer points until the window fills). `window` is clamped to ≥1.
 */
export function movingAverage(series: number[], window: number): number[] {
  return sharedMovingAverage(series.map(fin), window);
}

export interface RegressionFit {
  /** Least-squares slope (units of y per 1 step of the x index). */
  slope: number;
  /** Least-squares intercept (fitted y at x=0). */
  intercept: number;
  /** Coefficient of determination R² in [0,1]; 0 when the fit is undefined. */
  r2: number;
  /** Fitted value one step past the last observation (x = n). */
  projection: number;
  /** `horizon` fitted values for x = n … n+horizon-1. */
  forecast: number[];
}

/**
 * Ordinary least-squares fit of `series` against its own integer index
 * (x = 0,1,2,…), then project `horizon` points forward. Returns slope, intercept,
 * R² (fit quality) and the projected values. A <2-point or zero-variance-in-x
 * series can't define a line, so slope/intercept collapse to a flat line at the
 * mean with R²=0 — callers still get a sane, non-NaN projection.
 */
export function regressionForecast(series: number[], horizon: number): RegressionFit {
  const n = series.length;
  const h = Math.max(0, Math.floor(horizon));
  const ys = series.map(fin);

  const fit = linearFit(ys);
  if (!fit) {
    const flat = ys[0] ?? 0;
    return { slope: 0, intercept: flat, r2: 0, projection: flat, forecast: Array.from({ length: h }, () => flat) };
  }

  // A series with no spread fits its own mean exactly; the shared fit reports that
  // as R²=1, but for a FORECAST "no variance" is "no evidence of a trend", so 0.
  const { slope, intercept } = fit;
  const r2 = ys.every((y) => y === ys[0]) ? 0 : fit.r2;

  const at = (x: number) => slope * x + intercept;
  const forecast = Array.from({ length: h }, (_, k) => at(n + k));
  return { slope, intercept, r2, projection: at(n), forecast };
}

export interface AnomalyPoint {
  /** Index into the input series. */
  index: number;
  value: number;
  /** Signed z-score (how many σ from the mean); positive = spike, negative = dip. */
  z: number;
}

/**
 * Flag every point whose z-score magnitude meets `threshold` (default 2σ). A
 * series with no spread (σ=0) or fewer than 3 points has no meaningful outliers,
 * so an empty list is returned. Deterministic and pure — the same series always
 * yields the same anomalies.
 */
export function zScoreAnomalies(series: number[], threshold = 2): AnomalyPoint[] {
  if (series.length < 3) return [];
  const m = mean(series);
  const sd = stdDev(series);
  if (sd === 0) return [];
  const out: AnomalyPoint[] = [];
  for (let i = 0; i < series.length; i++) {
    const z = (fin(series[i]!) - m) / sd;
    if (Math.abs(z) >= threshold) out.push({ index: i, value: fin(series[i]!), z: Math.round(z * 100) / 100 });
  }
  return out;
}
