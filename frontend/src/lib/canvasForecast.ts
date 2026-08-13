/**
 * Forecasting for a series that is ALREADY ON THE BOARD.
 *
 * ── THE DEFECT THIS CLOSES ───────────────────────────────────────────────────────
 * The product owns a forecast engine — `/api/insights/forecast` returns history, a
 * least-squares projection and z-score anomalies — and it is hardwired to four DevEx
 * metrics (`cost`, `cycle_time`, `cfr`, `throughput`), behind the `advancedInsights`
 * plan gate. It cannot be pointed at a canvas `dataset` or a `metric` definition, so a
 * board holding three years of revenue could not project next quarter, and no
 * `timeGrain` result could be resampled or extrapolated. The hard part was built and
 * the board had no way to reach it.
 *
 * ── WHY THIS RUNS IN THE BROWSER RATHER THAN GENERALISING THE ENDPOINT ───────────
 * The rows are already here. A canvas dataset lives in the visitor's own document, so
 * "let the API forecast it" would mean uploading the frame to ask a question that is
 * pure arithmetic over data already in memory — a network round-trip, a tenant
 * requirement, and a plan gate, in exchange for nothing. Computing it locally keeps it
 * working for a logged-out visitor evaluating the product, which is the same reasoning
 * that makes `canvas_query_dataset` guest-safe.
 *
 * The API endpoint stays exactly as it is: it forecasts series that live in the
 * DATABASE, which the browser genuinely cannot see.
 *
 * ── THE SEMANTICS DELIBERATELY MATCH `application/insights/forecasting.ts` ───────
 * Same OLS-against-integer-index fit, same flat-line-at-the-mean degenerate case, same
 * 2σ anomaly threshold. Two forecasts in one product that disagree about what "the
 * trend" means is worse than one forecast in half the places, so the behaviours are
 * matched on purpose — including the choice to clamp R² into [0,1] and to project from
 * x = n rather than x = n+1.
 */

import { linearFit, mean, stddev } from './canvasStatistics';
import { timeBucket, toNumber, type TabularSource, type TabularTimeGrain } from './canvasTabularData';

export interface ForecastPoint { label: string; value: number }

export interface ForecastAnomaly {
  index: number;
  label: string;
  value: number;
  /** Signed z-score, rounded to two places to match the API's annotation. */
  z: number;
}

export interface CanvasForecast {
  history: ForecastPoint[];
  /** Projected points continuing past the last observation. */
  forecast: ForecastPoint[];
  anomalies: ForecastAnomaly[];
  slope: number;
  /** Fit quality in [0,1]. A slope without it is the most misleading number a
   *  dashboard can show, which is why it is not optional. */
  r2: number;
  /** The next projected value — the number a card leads with. */
  projection: number;
}

/** Points beyond which a series is more noise than trend for a card. */
const DEFAULT_HORIZON = 6;
const ANOMALY_THRESHOLD = 2;

/** Label for a projected step: the source label when it is a date we can extend,
 *  otherwise a bare step counter. Never a fabricated date — a projection labelled
 *  with a month it was not computed for is a chart that lies about its x-axis. */
function projectedLabel(lastLabel: string, step: number): string {
  const match = /^(\d{4})-(\d{2})$/.exec(lastLabel);
  if (match) {
    const month = Number(match[2]) - 1 + step;
    const year = Number(match[1]) + Math.floor(month / 12);
    return `${year}-${String((month % 12 + 12) % 12 + 1).padStart(2, '0')}`;
  }
  const year = /^(\d{4})$/.exec(lastLabel);
  if (year) return String(Number(year[1]) + step);
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(lastLabel);
  if (day) {
    const date = new Date(`${lastLabel}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + step);
    return date.toISOString().slice(0, 10);
  }
  return `+${step}`;
}

/**
 * Project a labelled series forward and flag its outliers.
 *
 * Anomalies are computed against the RESIDUALS of the fit rather than against the raw
 * values, and that differs from the API's version on purpose: the API's series are
 * mostly stationary rates, while a canvas series is routinely a growing revenue line,
 * where every early point is more than 2σ below the raw mean and the whole first year
 * would be flagged. Residual z-scores ask the question the user means — "which point is
 * unusual GIVEN the trend" — rather than "which point is far from the average".
 */
export function forecastSeries(
  history: readonly ForecastPoint[],
  horizon: number = DEFAULT_HORIZON,
): CanvasForecast {
  const points = history.filter((point) => Number.isFinite(point.value));
  const values = points.map((point) => point.value);
  const steps = Math.max(0, Math.min(Math.floor(horizon), 60));

  if (values.length < 2) {
    const flat = values[0] ?? 0;
    return {
      history: points,
      forecast: Array.from({ length: steps }, (_, index) => ({ label: projectedLabel(points[points.length - 1]?.label ?? '', index + 1), value: flat })),
      anomalies: [],
      slope: 0,
      r2: 0,
      projection: flat,
    };
  }

  const fit = linearFit(values) ?? { slope: 0, intercept: mean(values) ?? 0, r2: 0 };
  const at = (x: number): number => Number((fit.slope * x + fit.intercept).toFixed(6));
  const lastLabel = points[points.length - 1].label;

  const residuals = values.map((value, index) => value - at(index));
  const residualSpread = stddev(residuals);
  const residualMean = mean(residuals) ?? 0;
  const anomalies: ForecastAnomaly[] = residualSpread && residualSpread > 0
    ? residuals.flatMap((residual, index) => {
      const z = (residual - residualMean) / residualSpread;
      return Math.abs(z) >= ANOMALY_THRESHOLD
        ? [{ index, label: points[index].label, value: values[index], z: Math.round(z * 100) / 100 }]
        : [];
    })
    : [];

  return {
    history: points,
    forecast: Array.from({ length: steps }, (_, step) => ({
      label: projectedLabel(lastLabel, step + 1),
      value: at(values.length + step),
    })),
    anomalies,
    slope: fit.slope,
    r2: fit.r2,
    projection: at(values.length),
  };
}

/**
 * Build a labelled series out of a dataset by bucketing a date column.
 *
 * This is the half that makes "project next quarter" answerable from a raw file rather
 * than only from an already-aggregated chart: the same `timeBucket` the query engine
 * uses, so a forecast's periods and a grouped chart's periods are the same periods.
 * Missing buckets are FILLED with zero rather than skipped — a month with no rows is a
 * month with no revenue, and silently omitting it compresses the x-axis and steepens
 * every trend drawn through it.
 */
export function seriesFromDataset(
  source: TabularSource,
  dateColumn: string,
  valueColumn: string,
  grain: TabularTimeGrain = 'month',
): ForecastPoint[] {
  const totals = new Map<string, number>();
  for (const row of source.rows) {
    const bucket = timeBucket(row[dateColumn], grain);
    if (!bucket) continue;
    const value = toNumber(row[valueColumn]);
    totals.set(bucket, (totals.get(bucket) ?? 0) + (value ?? 0));
  }
  const labels = [...totals.keys()].sort();
  if (!labels.length) return [];
  // Only day/month/year have a total order cheap enough to fill densely; week and
  // quarter labels are filled from the observed set, which is correct whenever the
  // source has no wholly-empty period and is never WRONG, only sparse.
  const filled = grain === 'month' || grain === 'year' || grain === 'day'
    ? denseLabels(labels[0], labels[labels.length - 1], grain)
    : labels;
  return filled.map((label) => ({ label, value: Number((totals.get(label) ?? 0).toFixed(6)) }));
}

/** Every period label between two bounds, inclusive. */
function denseLabels(first: string, last: string, grain: TabularTimeGrain): string[] {
  const out: string[] = [first];
  let cursor = first;
  // Bounded so a malformed label cannot spin: no canvas series needs 4,000 periods,
  // and a runaway fill would hang the board rather than report a bad column.
  for (let guard = 0; guard < 4_000 && cursor !== last; guard += 1) {
    cursor = projectedLabel(cursor, 1);
    out.push(cursor);
    if (cursor.length !== first.length) break;
  }
  return out[out.length - 1] === last ? out : [first, last].filter((label, index, all) => all.indexOf(label) === index);
}
