/**
 * Trend Analysis — "Are we accelerating, steady, or slowing?"
 *
 * This is the PRD #208 implementation (task #208). It turns any daily
 * {day, value} series into an objective trend classification using the
 * existing forecasting primitive (`regressionForecast`) plus a relative
 * significance rule so small wiggles don't flap between states.
 *
 * TERMINOLOGY — aligned with the PRD's acceptance criteria:
 *   - Accelerating: positive slope with material relative growth.
 *   - Steady:       slope within the tolerance band relative to mean.
 *   - Slowing:      negative slope with material relative decline.
 *
 * The math is exposed as PURE functions (`classifySeries`, `normalizeSlope`)
 * so unit tests need no DB. The DB-touching wrappers (`computeTrend`,
 * `computeTrendsForMetrics`) reuse the WHITELISTED metricRegistry + dailySeries
 * primitives so no new table is introduced for the MVP — every metric is just
 * its existing daily series plus a classification overlay.
 *
 * Wire-up:
 *   GET /api/insights/trend?metric=<key>&days=30[&granularity=daily|weekly|monthly]
 *     — single metric trend with current status, slope, R² and history.
 *   GET /api/insights/trends?keys=finance.spend,dora.deployFreq&days=30
 *     — dashboard rollup (current status for N predefined metrics).
 */

import type { Db } from '../../infrastructure/database/connection';
import type { MetricPoint } from '../dashboards/dailySeries';
import { METRIC_REGISTRY } from '../dashboards/metricRegistry';
import { mean, regressionForecast } from './forecasting';

// ── Classification ─────────────────────────────────────────────────────────

export type TrendLabel = 'Accelerating' | 'Steady' | 'Slowing';
export type TrendGranularity = 'daily' | 'weekly' | 'monthly';

export const TREND_LABELS: readonly TrendLabel[] = ['Accelerating', 'Steady', 'Slowing'] as const;

export interface TrendMethod {
  id: 'least_squares';
  name: 'Least-squares linear regression';
  description: string;
}

export const TREND_METHOD: TrendMethod = {
  id: 'least_squares',
  name: 'Least-squares linear regression',
  description:
    'A trend is derived by fitting a straight line (ordinary least-squares regression of value against the integer day index). The fitted line\'s slope determines the direction, and its relative magnitude against the series mean determines whether the trend is labeled Accelerating (|slope|/mean > threshold), Slowing (negative beyond threshold), or Steady (within threshold). R² measures goodness-of-fit; the slope and R² are exposed in the API payload and dashboard tooltip. Underlying daily points are available via drill-down (`series`).',
};

/** Explain the method on demand — AC5 (documentation/tooltip source). */
export function explainMethod(): TrendMethod {
  return TREND_METHOD;
}

/**
 * Normalize slope to account for differing metric magnitudes.
 *  abs(slope) / mean  — the per-step relative change.
 * For a near-zero mean, normalized by 1 to avoid explosion (falls back to
 * absolute slope classification; treated as steady unless slope itself exceeds
 * steadyTolerance because mean≈0 means small values).
 */
export function normalizeSlope(slope: number, vals: number[]): number {
  if (!Number.isFinite(slope)) return 0;
  if (vals.length === 0) return 0;
  const m = mean(vals.map((v) => (Number.isFinite(v) ? v : 0)));
  if (Math.abs(m) < 1e-9) return Math.abs(slope);
  return Math.abs(slope) / Math.abs(m);
}

/**
 * Core classifier — pure, unit-testable.
 *
 *   `points` — oldest→newest, as returned by dailySeries.
 *   `steadyTolerance` — relative-slope band that counts as steady.
 *       default 0.02 (2% per step relative to mean — e.g. if DAU grows <
 *       2% per day over 30d, it's reported as steady).
 *       Raised for noisy low-cardinality metrics via the caller's config.
 *
 *   Returns the label, slope, r2, and a normalizedSlope for AC5 disclosure.
 */
export function classifySeries(
  points: MetricPoint[] | number[],
  steadyTolerance = 0.02,
): { label: TrendLabel; slope: number; r2: number; normalizedSlope: number; mean: number } {
  const vals: number[] = Array.isArray(points) && points.length > 0
    ? ((typeof points[0] === 'number') ? (points as number[]).map((v) => (Number.isFinite(v) ? v : 0))
      : (points as MetricPoint[]).map((p) => (Number.isFinite(p.value) ? p.value : 0)))
    : [];
  const mu = vals.length ? mean(vals) : 0;

  if (vals.length < 3) {
    // Too little history to label — report Steady with zero slope; callers see
    // confidence via sampleSize < 3. Mirrors forecasting.ts's <2 flat-line behavior.
    return { label: 'Steady', slope: 0, r2: 0, normalizedSlope: 0, mean: mu };
  }

  const fit = regressionForecast(vals, 0);
  const rel = normalizeSlope(fit.slope, vals);
  const tol = Math.max(0, steadyTolerance);

  // If the series has no spread (R²=0, slope 0) — steady.
  // Positive/negative direction via the fitted slope sign, significance via |rel|.
  let label: TrendLabel;
  if (Math.abs(rel) <= tol) label = 'Steady';
  else if (fit.slope > 0) label = 'Accelerating';
  else label = 'Slowing';

  return {
    label,
    slope: Math.round(fit.slope * 1_000_000) / 1_000_000,
    r2: Math.round(fit.r2 * 1000) / 1000,
    normalizedSlope: Math.round(rel * 1_000_000) / 1_000_000,
    mean: Math.round(mu * 1000) / 1000,
  };
}

// ── Granularity aggregation ────────────────────────────────────────────────

function toISODate(utcMs: number): string {
  const d = new Date(utcMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function parseUTCDate(s: string): number {
  return new Date(`${s}T00:00:00.000Z`).getTime();
}

/** Convert a daily series into weekly or monthly averages — AC6. */
export function resampleSeries(points: MetricPoint[], granularity: TrendGranularity): MetricPoint[] {
  if (granularity === 'daily') return points;
  if (points.length === 0) return [];

  if (granularity === 'weekly') {
    const buckets = new Map<string, { sum: number; count: number }>();
    const orderedKeys: string[] = [];
    for (let i = 0; i < points.length; i++) {
      const ms = parseUTCDate(points[i]!.day);
      const dow = new Date(ms).getUTCDay(); // 0=Sun
      const bucketStartMs = ms - dow * 86_400_000; // Sunday of this week
      const bucketKey = toISODate(bucketStartMs);
      const cur = buckets.get(bucketKey);
      if (cur) { cur.sum += points[i]!.value; cur.count++; }
      else { buckets.set(bucketKey, { sum: points[i]!.value, count: 1 }); orderedKeys.push(bucketKey); }
    }
    return orderedKeys.map((k) => {
      const b = buckets.get(k)!;
      return { day: k, value: b.sum / b.count };
    });
  }

  // monthly
  {
    const buckets = new Map<string, { sum: number; count: number }>();
    const orderedKeys: string[] = [];
    for (const p of points) {
      const k = p.day.slice(0, 7); // 'YYYY-MM'
      const cur = buckets.get(k);
      if (cur) { cur.sum += p.value; cur.count++; }
      else { buckets.set(k, { sum: p.value, count: 1 }); orderedKeys.push(k); }
    }
    return orderedKeys.map((k) => {
      const b = buckets.get(k)!;
      // use first-of-month as the point key for display consistency
      return { day: `${k}-01`, value: b.sum / b.count };
    });
  }
}

// ── Per-metric result shape (the route payload) ────────────────────────────

export interface TrendResult {
  metricKey: string;
  label: string;                 // registry label if known
  granularity: TrendGranularity;
  windowDays: number;
  classification: TrendLabel;
  slope: number;
  normalizedSlope: number;
  r2: number;
  mean: number;
  history: MetricPoint[];        // granular-resampled series for charting (sparse trend overlay)
  rawHistory: MetricPoint[];     // full daily series (drill-down — AC4)
  method: TrendMethod;
  sampleSize: number;
}

// ── DB-touching compute (single metric + whitelisted multi) ────────────────

export type TrendForKeyResult = { metricKey: string; trend: TrendResult } | { metricKey: string; error: string };

/**
 * Fetch the registry series for a single key and classify it.
 * Returns null when the key has no registered series (scalar-only metrics).
 */
export async function computeTrend(
  db: Db,
  tenantId: number,
  metricKey: string,
  windowDays: number,
  granularity: TrendGranularity = 'daily',
  steadyTolerance = 0.02,
): Promise<TrendResult | null> {
  const def = METRIC_REGISTRY[metricKey];
  if (!def || typeof def.series !== 'function') return null;

  const rawHistory = await def.series(db, tenantId, windowDays);
  const history = resampleSeries(rawHistory, granularity);
  const vals = history.map((p) => p.value);
  const classified = classifySeries(vals.length ? vals : rawHistory.map((p) => p.value), steadyTolerance);

  return {
    metricKey,
    label: def.label,
    granularity,
    windowDays,
    classification: classified.label,
    slope: classified.slope,
    normalizedSlope: classified.normalizedSlope,
    r2: classified.r2,
    mean: classified.mean,
    history,
    rawHistory,
    method: TREND_METHOD,
    sampleSize: history.length,
  };
}

/**
 * Compute trends for N metric keys (dashboard view — AC1, AC2).
 * Ignores keys whose series is not available (they still report as an error
 * row so the client knows which keys were skipped).
 */
export async function computeTrendsForMetrics(
  db: Db,
  tenantId: number,
  metricKeys: string[],
  windowDays: number,
  granularity: TrendGranularity = 'daily',
  steadyToleranceMap?: Record<string, number>,
): Promise<TrendForKeyResult[]> {
  const out: TrendForKeyResult[] = [];
  for (const k of metricKeys) {
    try {
      const def = METRIC_REGISTRY[k];
      if (!def) { out.push({ metricKey: k, error: `unknown metric '${k}'` }); continue; }
      if (typeof def.series !== 'function') {
        out.push({ metricKey: k, error: `metric '${k}' has no daily series — trend requires a time-series source` });
        continue;
      }
      const tol = steadyToleranceMap?.[k] ?? 0.02;
      const trend = await computeTrend(db, tenantId, k, windowDays, granularity, tol);
      if (!trend) { out.push({ metricKey: k, error: `could not compute trend for '${k}'` }); continue; }
      out.push({ metricKey: k, trend });
    } catch (err: unknown) {
      out.push({ metricKey: k, error: (err as Error)?.message ?? String(err) });
    }
  }
  return out;
}

/** Helper for the alert evaluator: re-classify a pair of windows to detect transition. */
export function transitionLabel(
  prev: { label: TrendLabel } | TrendLabel,
  next: { label: TrendLabel } | TrendLabel,
): string {
  const a = typeof prev === 'string' ? prev : prev.label;
  const b = typeof next === 'string' ? next : next.label;
  return `${a} → ${b}`;
}
