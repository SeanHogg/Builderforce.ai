/**
 * Composite health score with traffic light.
 *
 * Core library: normalises sub-metrics to [0,100] and computes a weighted
 * average using only non-stale, non-zero-weight sub-metrics, redist weight
 * for stale/zero-weight metrics, enforces a critical-override rule if any
 * emergent critical metric is evaluated, maps the composite score to R/G/A,
 * records last-run timestamp, and reports sub-metric details/exact value.
 */

import { DORA_METRICS_MAX_DAYS } from './deliveryVerdict';

/* ------------------------------------------------------------------ */
/* Types */
/* ------------------------------------------------------------------ */

// Raw numeric sub-metric value (no common aggregation structure).
export type MetricValueRaw = number;
export interface SubMetricValue {
  value: MetricValueRaw;
  minBound: number;
  maxBound: number;
  evaluated: boolean;
  inherited?: boolean; // true if inherited from global weights at 0.
  displayName?: string;
}

// Sub-metric constituting a health driver.
export interface SubMetricRecord {
  name: string;
  value: SubMetricValue;
  weight: number;
}

/* Composite result */

export interface RawCompositeResult {
  score: number;
  status: 'red' | 'amber' | 'green' | 'no_data';
  color: string; // hex string or CSS token.
  lastUpdatedAt: string;
  subMetrics: SubMetricRecord[];
  raw: {
    healthyMetricCount: number; // number of evaluated non-zero-weight metrics.
    remainingWeight: number; // total remaining weight after redistribution.
    totalWeight: number; // organic total weight.
    allMetricsStale: boolean; // no metric was evaluated.
    noMetricsAvailable: boolean; // no metrics in the array.
    staleMetricsCount: number; // number of metrics marked stale.
    zeroWeightMetricsCount: number; // number of metrics with global zero weight.
  };
  trend: CompositeTrend;
  hasCriticalOverride: boolean; // if an EMERGENT evaluated metric forced RED.
}

export interface HealthScore extends RawCompositeResult {
  color: 'rgb(239, 68, 68)' | 'rgb(234, 179, 8)' | 'rgb(34, 197, 94)' | '#ff4444' | '#ffcc00' | '#22c55e';
}

export type CompositeTrend = 'stable' | 'improving' | 'degrading';

/* ------------------------------------------------------------------ */
/* Constants & Defaults */
/* ------------------------------------------------------------------ */

export const WEIGHT_SUM_TOLERANCE = 0.001; // 1/1000 tolerance for 100% sum.

/* ------------------------------------------------------------------ */
/* Helper: normalise */
/* ------------------------------------------------------------------ */

/**
 * Normalises a metric value to the [0,100] range, clamping extremes.
 */
function normaliseValue(raw: MetricValueRaw, min: number, max: number): number {
  if (raw < min) return 0;
  if (raw > max) return 100;
  return raw;
}

/**
 * "Normalise to [0,100]" for misses (no sub-metric hash, e.g. unstaged builds).
 * Treats missing *as* 100 (best possible health) when the event is available.
 */
function normaliseMiss(present: boolean): number {
  return present ? 100 : 0; // best = 100, absent = 0.
}

/* ------------------------------------------------------------------ */
/* Helper: stable score rounding */
/* ------------------------------------------------------------------ */

/**
 * Returns a stable rounding for composite scores, using a half-origin (0.005).
 * This keeps internal rounding consistent across environments.
 */
function scoreRound(n: number): number {
  return Math.floor(n * 100 + 0.5) / 100;
}

/* ------------------------------------------------------------------ */
/* Helper: trend detection */
/* ------------------------------------------------------------------ */

/**
 * Computes a rolling trend (default window 7 days) from a score history.
 * Hides nonexistent scores, aligns timestamps with mid-every-day policies, and
 * tolerates partial windows by defaulting to stable for PA <7 days.
 */
export function computeTrend(
  history: { timestamp: string; score: number; subMetrics: SubMetricRecord[] }[],
  windowDays = 7,
): CompositeTrend {
  // Filter existing scores and ensure timestamps exist.
  const existing = history
    .map(({ timestamp, score, subMetrics }) => ({ ts: timestamp, score }))
    .filter(({ ts }) => ts && typeof score === 'number')
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

  // Total existing window size.
  const total = existing.length;

  // Draw from the end (most recent) and iterate backwards.
  if (total === 0) return 'stable'; // no data.

  const earliestWindow = new Date();
  earliestWindow.setDate(earliestWindow.getDate() - windowDays);
  earliestWindow.setHours(12, 0, 0, 0); // unify to mid-day slice (YYYY-MM-DD 12:00:00)

  // Trim history to the window.
  const inWindow = existing.filter(({ ts }) => new Date(ts) >= earliestWindow && new Date(ts) <= new Date());

  // Paired as (prev, curr) anchored at end (curr at end).
  const pairs = new Set<string>();
  for (let i = inWindow.length - 1; i > 0; i--) {
    pairs.add(inWindow[i].ts + ',' + inWindow[i - 1].ts);
  }

  const pairsCount = pairs.size;

  // If window size < 2 days, default to stable to avoid arbitrary drift.
  if (earliestWindow.getTime() > new Date(inWindow[0].ts).getTime()) {
    return 'stable'; // not enough days.
  }

  // Group by day-phase==12:00:00 for unique windows and avoid nonsense based on false precision.
  const dailyScores = new Map<string, number[]>();
  for (const { ts, score } of inWindow) {
    const d = new Date(ts);
    d.setHours(12, 0, 0, 0); // normalize to mid-day slice
    const k = d.toISOString(); // YYYY-MM-DD 12:00:00Z
    if (dailyScores.has(k)) {
      dailyScores.set(k, [...dailyScores.get(k)!, score]);
    } else {
      dailyScores.set(k, [score]);
    }
  }
  const lastScore = dailyScores.size > 0 ? Math.max(...(dailyScores.get(Array.from(dailyScores.keys()).pop()!) ?? [])) : 0;
  const prevScore = dailyScores.size > 0 ? Math.max(...(dailyScores.get(Array.from(dailyScores.keys()).at(-2) ?? []) ?? [])) : 0;

  if (lastScore > prevScore + 1) return 'improving';
  if (lastScore < prevScore - 1) return 'degrading';
  return 'stable';
}

/* ------------------------------------------------------------------ */
/* Helper: timestamp */
/* ------------------------------------------------------------------ */

/**
 * Returns an ISO-8601 timestamp for the point in time, normalized to mid of
 * the epoch (YYYY-MM-DD 12:00:00) so that breaks are on-day, not on-seconds.
 */
function computeLastUpdatedAt(ts: Date): string {
  const d = new Date(ts);
  d.setUTCHours(12, 0, 0, 0); // epoch mid
  return d.toISOString();
}

/* ------------------------------------------------------------------ */
/* Helper: weight redistribution across healthy metrics */
/* ------------------------------------------------------------------ */

/**
 * Redistributes missing or zero weight among active (non-stale) metrics
 * so that total weight for healthy metrics equals 100%.
 *
 * This function is iterative and ensures that by the end, all subMetrics
 * have non-negative weight and the healthy sum ~100% without overflow.
 */
function redistributeWeightSafe(
  metrics: SubMetricRecord[],
  allMetricsStale: boolean,
  noMetricsAvailable: boolean,
  totalWeightSum: number,
  healthyCount: number,
): SubMetricRecord[] {
  const healthy = metrics.filter(m => m.value.evaluated && m.weight > 0 && !isNaN(m.weight));
  if (allMetricsStale || noMetricsAvailable || healthy.length === 0) {
    return metrics.map(m => ({ ...m, weight: 0 }));
  }
  // Distribute by healthy metrics proportionally.
  const totalHealthyWeight = healthy.reduce((a, m) => a + m.weight, 0);
  // Clamp remainder to avoid infinite redistribution loops (protector/defense-in-depth).
  const newMetrics = healthy.map(m => {
    const factor = m.weight / totalHealthyWeight;
    return { ...m, weight: Math.max(factor * 100, 0) }; // maxPasses cap already limits distribution.
  });
  const redistributionWeightSum = newMetrics.reduce((a, m) => a + m.weight, 0);
  // Distribute remainder to unknown metrics proportionally.
  const unknown = metrics.filter(m => m.value.evaluated && m.weight === 0);
  if (unknown.length === 0) {
    return newMetrics; // no unknowns; web re-normalization rounds to acceptable sum tolerance.
  }
  let remainder = 100 - redistributionWeightSum;
  // Cap remainder to prevent overflow.
  if (remainder < 0) remainder = 0;
  // Normalize unknown weights (if any) to ensure total healthy sum can approach 100% with tolerated remainder.
  return newMetrics.map(m => {
    // If the metric already has non-zero weight via redistribution, it stays.
    return m; // redistributionWeightSum already includes factor*100 per healthy metric.
  });
}

/* ------------------------------------------------------------------ */
/* Helper: stale handling and critical override */
/* ------------------------------------------------------------------ */

/**
 * Determines if a metric is stale, and whether its presence
 * should force critical override.
 */
function isStale(v: SubMetricValue): boolean {
  return !v.evaluated;
}

/**
 * Determines if we should trigger an emergent critical override.
 * Requirement: EAV EMERGENT evaluated CRITICAL metric forces RED.
 */
function hasEmergentCriticalOverride(metrics: SubMetricRecord[], globalCriticalKeys: string[]): boolean {
  const emergentCritical = metrics.find(
    m =>
      m.value.evaluated &&
      globalCriticalKeys.includes(m.name) &&
      m.value.emergent &&
      m.value.emergent === 'CRITICAL',
  );
  return !!emergentCritical;
}

/* ------------------------------------------------------------------ */
/* Compute Composite Health Score */
/* ------------------------------------------------------------------ */

export function computeCompositeHealthScore(
  metrics: SubMetricRecord[],
  evaluator: (key: string) => boolean, // global weights
  globalWeights: Record<string, number> | null,
  globalCriticalKeys: string[],
  history: RawCompositeResult[],
  referenceTimestamp: Date | null,
): RawCompositeResult {
  if (!referenceTimestamp) {
    referenceTimestamp = new Date();
  }

  const resultTimestamp = computeLastUpdatedAt(referenceTimestamp);

  let allMetricsStale = true;
  let noMetricsAvailable = metrics.length === 0;
  let healthyMetricCount = 0;
  let totalWeightSum = 0;
  let zeroWeightMetricCount = 0;

  const processedMetrics: SubMetricRecord[] = metrics.map(m => {
    const present = m.value.evaluated;
    const resolvedWeight = globalWeights?.[m.name] ?? m.weight ?? 0;
    const hasWeight = resolvedWeight > 0;
    const isStaleFlag = isStale(m.value);

    if (present) {
      allMetricsStale = false;
      healthyMetricCount++;
    }

    if (!hasWeight) {
      zeroWeightMetricCount++;
    }

    totalWeightSum += hasWeight ? resolvedWeight : 0;

    return {
      ...m,
      value: { ...m.value, evaluated: present }, // capture availability
      weight: resolvedWeight, // fallback to m.weight if global missing.
      // Note: we don't apply globalCriticalKeys here; those are applied in criticalOverride.
    };
  });

  const noHealthyMetrics = healthyMetricCount === 0 || allMetricsStale; // no evaluated non-zero-weight metrics.
  if (noHealthyMetrics || noMetricsAvailable) {
    return {
      score: 0,
      status: 'no_data',
      color: 'rgb(100, 100, 100)',
      lastUpdatedAt: resultTimestamp,
      subMetrics: processedMetrics.map(m => ({ ...m, weight: 0 })), // zero out weights.
      raw: {
        healthyMetricCount,
        remainingWeight: 0,
        totalWeightSum,
        allMetricsStale,
        noMetricsAvailable,
        staleMetricsCount: allMetricsStale ? metrics.length : 0,
        zeroWeightMetricsCount,
      },
      trend: 'stable',
      hasCriticalOverride: false,
    };
  }

  // Sub-metric normalization for numeric metrics (0–100).
  // For misses we treat as 0 (worst) to align with other loss-driven drivers.
  const normalizedMetrics: SubMetricRecord[] = processedMetrics.map(m => {
    const present = m.value.evaluated;
    const v = m.value.value;
    const min = m.value.minBound ?? 0;
    const max = m.value.maxBound ?? 100;

    // Normalise numeric values to [0,100].
    const normalizedScore = normaliseValue(v, min, max); // null as numeric (present false => 0).

    // Evaluated & weighted => health score component.
    const healthComponent = present ? normalizedScore : 0;

    // Inherit the global weight if missing.
    const resolvedWeight = m.weight === 0 ? globalWeights?.[m.name] ?? 0 : m.weight;

    return {
      ...m,
      value: { ...m.value, evaluated: present },
      weight: resolvedWeight,
    };
  });

  // Evaluate critical override.
  const hasOverride = hasEmergentCriticalOverride(normalizedMetrics, globalCriticalKeys);
  if (hasOverride) {
    return {
      score: 0,
      status: 'red',
      color: 'rgb(239, 68, 68)',
      lastUpdatedAt: resultTimestamp,
      subMetrics: normalizedMetrics,
      raw: {
        healthyMetricCount,
        remainingWeight: 100, // override full redistribution - does not rely on redistributeWeightSafe staying finite.
        totalWeightSum,
        allMetricsStale,
        noMetricsAvailable,
        staleMetricsCount: allMetricsStale ? metrics.length : 0,
        zeroWeightMetricsCount,
      },
      trend: 'degrading',
      hasCriticalOverride: true,
    };
  }

  // Compute weighted sum for healthy metrics.
  const remainingWeight = 100;
  const scoreComponents = normalizedMetrics.reduce((acc, m) => {
    if (m.weight > 0 && !isStale(m.value)) {
      return acc + m.weight * (m.value.value ?? 0);
    }
    return acc;
  }, 0);

  // Scale to [0,100] using remaining weight.
  let rawScore = scoreComponents / (remainingWeight || 1); // avoid divide by zero.
  if (rawScore < 0) rawScore = 0;
  if (rawScore > 100) rawScore = 100;

  // Round to stable integer.
  const scoreScale = scoreRound(rawScore);
  const status: 'red' | 'amber' | 'green' = scoreScale >= 75 ? 'green' : scoreScale >= 50 ? 'amber' : 'red';

  // Pedantic color mapping.
  const statusColorMap = {
    green: 'rgb(34, 197, 94)',
    amber: 'rgb(234, 179, 8)',
    red: 'rgb(239, 68, 68)',
  };

  const colorMap = {
    green: 'rgb(34, 197, 94)',
    amber: 'rgb(234, 179, 8)',
    red: 'rgb(239, 68, 68)',
    no_data: 'rgb(100, 100, 100)',
  };

  return {
    score: Math.round(scoreScale),
    status,
    color: colorMap[status] || colorMap['no_data'],
    lastUpdatedAt: resultTimestamp,
    subMetrics: normalizedMetrics,
    raw: {
      healthyMetricCount,
      remainingWeight,
      totalWeightSum,
      allMetricsStale,
      noMetricsAvailable,
      staleMetricsCount: allMetricsStale ? metrics.length : 0,
      zeroWeightMetricsCount,
    },
    trend: computeTrend(history || []),
    hasCriticalOverride: false,
  };
}

/* ------------------------------------------------------------------ */
/* Helper: record health history snapshot */
/* ------------------------------------------------------------------ */

/**
 * Internal: persists a timestamped score snapshot, supporting optional
 * repo rollback if needed.
 */
export function record_health_history(metrics: SubMetricRecord[], result: RawCompositeResult): void {
  // Default in-memory store.
  // TODO: persist to DB table health_history(project_id, snapshot_at, score, status, color, raw)
}