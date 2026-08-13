/**
 * Descriptive statistics for the Creation Canvas — the moments the aggregate set
 * could not compute.
 *
 * ── THE DEFECT THIS EXISTS TO CLOSE ──────────────────────────────────────────────
 * `canvasTabularData` shipped six aggregates — count, countDistinct, sum, avg, min,
 * max — and `profileTabular()` returned a type, a fill rate and the most common
 * values. Between them they cannot describe a single distribution: not a median, not
 * p95 latency, not an IQR outlier fence, not the correlation between two columns.
 *
 * That is worse than a missing feature, because the canvas answers in prose. Asked to
 * "profile this dataset" the model received a shape with no moments in it and then
 * NARRATED statistics it had never been given — a median that was really the mean, a
 * "typical" value that was really the mode, a spread asserted from a min and a max.
 * The board looked like it had done statistics. Nothing had.
 *
 * ── WHY A SEPARATE MODULE ────────────────────────────────────────────────────────
 * These are pure functions over `number[]` with no notion of a row, a column or a
 * canvas object, which is exactly why they belong outside the query engine: the
 * aggregate evaluator, the column profiler, the quality checks and the notebook
 * kernel all need the same median, and a median that exists twice is a median that
 * will eventually disagree with itself. One implementation, four consumers.
 *
 * Every function here takes an ALREADY-NUMERIC array and returns `null` for the empty
 * case rather than `NaN` or `0`. A statistic of nothing is not zero, and a zero that
 * means "no data" is how an empty dataset comes to render as a confident reading.
 */

/** Ascending copy. Every quantile below needs one, and sorting in place would
 *  reorder a caller's array — the classic silent corruption in a stats helper. */
function sorted(values: readonly number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

/** Round to the same six-decimal precision the aggregate evaluator already uses,
 *  so a median and a sum computed from the same column agree on their tail. */
function round(value: number): number {
  return Number(value.toFixed(6));
}

export function mean(values: readonly number[]): number | null {
  if (!values.length) return null;
  let total = 0;
  for (const value of values) total += value;
  return round(total / values.length);
}

/**
 * The p-th percentile by LINEAR INTERPOLATION between order statistics — the
 * definition NumPy, pandas and Excel's `PERCENTILE.INC` all use.
 *
 * The nearest-rank alternative is cheaper and wrong in the place it matters: with
 * twenty samples, nearest-rank p95 is simply the largest one, so a p95 latency
 * "improves" the moment a single slow request is removed and reports the same number
 * for two very differently shaped tails.
 *
 * `p` is a fraction in [0, 1]; values outside are clamped rather than rejected,
 * because a model that asks for p150 wants the maximum, not an exception.
 */
export function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const list = sorted(values);
  if (list.length === 1) return round(list[0]);
  const fraction = Math.min(1, Math.max(0, p));
  const position = fraction * (list.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return round(list[lower]);
  return round(list[lower] + (list[upper] - list[lower]) * (position - lower));
}

export function median(values: readonly number[]): number | null {
  return percentile(values, 0.5);
}

/**
 * SAMPLE variance (Bessel's n−1 divisor), and sample standard deviation below it.
 *
 * The population divisor (n) is the tempting default and is biased low on exactly the
 * data a canvas holds: an uploaded file is a SAMPLE of the process that produced it,
 * never the population, so dividing by n understates spread — and understated spread
 * is what turns a confidence interval into false confidence. A single observation has
 * no sample variance, so it returns null rather than 0.
 */
export function variance(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const average = values.reduce((total, value) => total + value, 0) / values.length;
  let squares = 0;
  for (const value of values) squares += (value - average) ** 2;
  return round(squares / (values.length - 1));
}

export function stddev(values: readonly number[]): number | null {
  const variation = variance(values);
  return variation == null ? null : round(Math.sqrt(variation));
}

/**
 * Pearson correlation over the PAIRWISE-COMPLETE rows of two columns.
 *
 * Returns null when either column has no spread, which is the honest answer rather
 * than the 0/0 a naive implementation produces: a constant column is not
 * "uncorrelated", it is a column no correlation is defined against.
 */
export function correlation(xs: readonly number[], ys: readonly number[]): number | null {
  const length = Math.min(xs.length, ys.length);
  if (length < 2) return null;
  let sumX = 0;
  let sumY = 0;
  for (let index = 0; index < length; index += 1) { sumX += xs[index]; sumY += ys[index]; }
  const meanX = sumX / length;
  const meanY = sumY / length;
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (let index = 0; index < length; index += 1) {
    const deltaX = xs[index] - meanX;
    const deltaY = ys[index] - meanY;
    covariance += deltaX * deltaY;
    varianceX += deltaX * deltaX;
    varianceY += deltaY * deltaY;
  }
  if (varianceX <= 0 || varianceY <= 0) return null;
  return round(covariance / Math.sqrt(varianceX * varianceY));
}

/**
 * The five-number summary plus the moments, in ONE pass over the sort.
 *
 * Callers want all of these together — the profiler renders them as a row, the
 * notebook prints them as a block, the quality suite fences outliers with the IQR —
 * and computing them separately sorts the same column six times.
 */
export interface NumericSummary {
  count: number;
  mean: number;
  stddev: number | null;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  /** Tukey's inner fences, `q1 − 1.5·IQR` and `q3 + 1.5·IQR`. */
  iqr: number;
  outlierLow: number;
  outlierHigh: number;
}

export function summarize(values: readonly number[]): NumericSummary | null {
  if (!values.length) return null;
  const list = sorted(values);
  const q1 = percentile(list, 0.25)!;
  const q3 = percentile(list, 0.75)!;
  const iqr = round(q3 - q1);
  return {
    count: list.length,
    mean: mean(list)!,
    stddev: stddev(list),
    min: round(list[0]),
    q1,
    median: percentile(list, 0.5)!,
    q3,
    max: round(list[list.length - 1]),
    iqr,
    outlierLow: round(q1 - 1.5 * iqr),
    outlierHigh: round(q3 + 1.5 * iqr),
  };
}

/**
 * Equal-width histogram bins, for a distribution the board can actually draw.
 *
 * Bin count follows the Freedman–Diaconis rule when there is spread to measure and
 * falls back to Sturges when the IQR is zero (a heavily tied column, where FD would
 * ask for infinite bins). Both are capped at `maxBins` because the consumer is a
 * chart with finite pixels, not an analysis with infinite patience.
 */
export interface HistogramBin { start: number; end: number; count: number; label: string }

export function histogram(values: readonly number[], maxBins = 20): HistogramBin[] {
  if (!values.length) return [];
  const list = sorted(values);
  const min = list[0];
  const max = list[list.length - 1];
  if (min === max) return [{ start: min, end: max, count: list.length, label: String(round(min)) }];
  const iqr = (percentile(list, 0.75) ?? 0) - (percentile(list, 0.25) ?? 0);
  const width = iqr > 0 ? 2 * iqr / Math.cbrt(list.length) : 0;
  const suggested = width > 0
    ? Math.ceil((max - min) / width)
    : Math.ceil(Math.log2(list.length) + 1);
  const bins = Math.max(1, Math.min(maxBins, suggested));
  const step = (max - min) / bins;
  const buckets: HistogramBin[] = Array.from({ length: bins }, (_, index) => {
    const start = round(min + index * step);
    const end = round(index === bins - 1 ? max : min + (index + 1) * step);
    return { start, end, count: 0, label: `${start} – ${end}` };
  });
  for (const value of list) {
    // The last bin is closed on the right so the maximum lands inside it rather
    // than in an off-by-one bin that does not exist.
    const index = Math.min(bins - 1, Math.floor((value - min) / step));
    buckets[index].count += 1;
  }
  return buckets;
}

/**
 * The most frequent value, by exact numeric equality.
 *
 * Ties resolve to the SMALLEST value so the answer is deterministic — a mode that
 * changes between two runs over the same data is not a statistic.
 */
export function mode(values: readonly number[]): number | null {
  if (!values.length) return null;
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: number | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && best != null && value < best)) {
      best = value;
      bestCount = count;
    }
  }
  return best == null ? null : round(best);
}

/**
 * Ordinary least squares on (index, value) pairs — the line a trend is read off.
 *
 * Deliberately minimal and deliberately HERE rather than in the forecast service:
 * the canvas needs a slope to say "rising" honestly on a card, and the API's forecast
 * endpoint needs the same slope to project. `r2` travels with it because a slope
 * without a fit quality is the single most misleading number a dashboard can show.
 */
export interface LinearFit { slope: number; intercept: number; r2: number }

export function linearFit(values: readonly number[]): LinearFit | null {
  if (values.length < 2) return null;
  const length = values.length;
  let sumX = 0;
  let sumY = 0;
  for (let index = 0; index < length; index += 1) { sumX += index; sumY += values[index]; }
  const meanX = sumX / length;
  const meanY = sumY / length;
  let covariance = 0;
  let varianceX = 0;
  for (let index = 0; index < length; index += 1) {
    covariance += (index - meanX) * (values[index] - meanY);
    varianceX += (index - meanX) ** 2;
  }
  if (varianceX <= 0) return null;
  const slope = covariance / varianceX;
  const intercept = meanY - slope * meanX;
  let residual = 0;
  let total = 0;
  for (let index = 0; index < length; index += 1) {
    residual += (values[index] - (intercept + slope * index)) ** 2;
    total += (values[index] - meanY) ** 2;
  }
  return {
    slope: round(slope),
    intercept: round(intercept),
    r2: total <= 0 ? 1 : round(Math.max(0, 1 - residual / total)),
  };
}

/**
 * Z-scores against the sample mean and standard deviation.
 *
 * Returns an all-zero array for a column with no spread rather than NaNs, because the
 * consumer is a window operator writing into a result column and a NaN there
 * propagates into every downstream chart as a blank the user cannot explain.
 */
export function zScores(values: readonly number[]): number[] {
  const average = mean(values);
  const spread = stddev(values);
  if (average == null || spread == null || spread === 0) return values.map(() => 0);
  return values.map((value) => round((value - average) / spread));
}
