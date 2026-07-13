/**
 * Forecast series assembly — the DB-touching bridge between the existing lens
 * collectors and the PURE forecasting math ({@link ./forecasting}). It pulls the
 * concrete historical series for one supported metric off a collector we already
 * ship (FinOps spend, DORA lead-time / change-failure / deployment throughput),
 * then folds in the regression projection + z-score anomalies so the
 * /api/insights/forecast route stays a thin cache-and-return handler.
 *
 * DRY: no metric re-derives its history here — cost reuses computeFinanceInsights,
 * the flow metrics reuse computeDora's weekly series. Only the projection/anomaly
 * overlay is new, and that overlay is the pure module.
 */

import type { Db } from '../../infrastructure/database/connection';
import { computeFinanceInsights, daysInMonth } from './financeInsights';
import { computeDora } from '../metrics/workforceMetrics';
import { regressionForecast, zScoreAnomalies } from './forecasting';

/** The metrics the forecast lens understands. */
export const FORECAST_METRICS = ['cost', 'cycle_time', 'cfr', 'throughput'] as const;
export type ForecastMetric = (typeof FORECAST_METRICS)[number];

export function isForecastMetric(x: string | undefined): x is ForecastMetric {
  return !!x && (FORECAST_METRICS as readonly string[]).includes(x);
}

export type ForecastUnit = 'usd' | 'hours' | 'pct' | 'count';
export type ForecastCadence = 'daily' | 'weekly';

export interface ForecastPointOut { day: string; value: number }
export interface ForecastAnomalyOut { day: string; value: number; z: number; acknowledged: boolean }

export interface ForecastResult {
  metric: ForecastMetric;
  unit: ForecastUnit;
  cadence: ForecastCadence;
  /** Observed history, oldest → newest. */
  history: ForecastPointOut[];
  /** Projected points continuing past the last history day. */
  forecast: ForecastPointOut[];
  /** Points ≥ threshold σ from the mean, annotated with the ack flag. */
  anomalies: ForecastAnomalyOut[];
  /** Least-squares slope (metric units per cadence step). */
  slope: number;
  /** Fit quality R² in [0,1]. */
  r2: number;
  /** Single-step-ahead projected value (first forecast point, or last history). */
  projection: number;
}

/** Metric → (unit, cadence, label) — the display metadata the route echoes. */
const META: Record<ForecastMetric, { unit: ForecastUnit; cadence: ForecastCadence }> = {
  cost: { unit: 'usd', cadence: 'daily' },
  cycle_time: { unit: 'hours', cadence: 'weekly' },
  cfr: { unit: 'pct', cadence: 'weekly' },
  throughput: { unit: 'count', cadence: 'weekly' },
};

/** 'YYYY-MM-DD' of `base` shifted by `deltaDays` (UTC). */
function shiftDay(day: string, deltaDays: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/** Current calendar month 'YYYY-MM' (UTC). */
function currentPeriodMonth(now: number): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Pull the raw {day,value} history for a metric off its existing collector.
 * `cost` is a daily spend series for the current month; the flow metrics are the
 * DORA weekly series bucketed over the window.
 */
async function loadHistory(db: Db, tenantId: number, metric: ForecastMetric, days: number, now: number): Promise<ForecastPointOut[]> {
  if (metric === 'cost') {
    const period = currentPeriodMonth(now);
    const fin = await computeFinanceInsights(db, tenantId, '', period, now);
    return fin.daily.map((d) => ({ day: d.date, value: d.usd }));
  }
  const dora = await computeDora(db, tenantId, days);
  return dora.series.map((p) => ({
    day: p.bucketStart,
    value:
      metric === 'cycle_time' ? (p.leadTimeHours ?? 0)
      : metric === 'cfr' ? (p.changeFailureRatePct ?? 0)
      : p.totalDeployments, // throughput
  }));
}

/**
 * How many points to project forward. Cost fills out the remaining days of the
 * current month (a month-end burn projection); the weekly flow metrics look 4
 * cadence-steps (≈ a month) ahead.
 */
function horizonFor(metric: ForecastMetric, history: ForecastPointOut[], now: number): number {
  if (metric === 'cost') {
    const dim = daysInMonth(currentPeriodMonth(now));
    return Math.max(1, dim - new Date(now).getUTCDate());
  }
  return history.length >= 2 ? 4 : 0;
}

/**
 * Assemble the full forecast payload for one metric: history + projection +
 * anomalies + fit stats. `ackedDays` is the set of 'YYYY-MM-DD' anomaly points
 * the tenant has already dismissed (so the client can hide them), threaded in by
 * the route from forecast_anomaly_acks.
 */
export async function computeForecast(
  db: Db,
  tenantId: number,
  metric: ForecastMetric,
  days: number,
  now: number,
  ackedDays: Set<string> = new Set(),
): Promise<ForecastResult> {
  const meta = META[metric];
  const history = await loadHistory(db, tenantId, metric, days, now);
  const values = history.map((p) => p.value);

  const horizon = horizonFor(metric, history, now);
  const fit = regressionForecast(values, horizon);
  const projected = fit.forecast;

  const stepDays = meta.cadence === 'weekly' ? 7 : 1;
  const lastDay = history.length ? history[history.length - 1]!.day : new Date(now).toISOString().slice(0, 10);
  const forecast: ForecastPointOut[] = projected.map((value, i) => ({
    day: shiftDay(lastDay, (i + 1) * stepDays),
    // cost/throughput can't go negative; a downward line is clamped at 0.
    value: meta.unit === 'usd' || meta.unit === 'count' ? Math.max(0, value) : value,
  }));

  const anomalies: ForecastAnomalyOut[] = zScoreAnomalies(values).map((a) => {
    const day = history[a.index]?.day ?? '';
    return { day, value: a.value, z: a.z, acknowledged: ackedDays.has(day) };
  });

  return {
    metric,
    unit: meta.unit,
    cadence: meta.cadence,
    history,
    forecast,
    anomalies,
    slope: Math.round(fit.slope * 1000) / 1000,
    r2: Math.round(fit.r2 * 1000) / 1000,
    projection: forecast[0]?.value ?? (values[values.length - 1] ?? 0),
  };
}
