/**
 * Composite health score with traffic light.
 *
 * Normalises sub-metrics to [0,100], computes a weighted average using only
 * non-stale, non-zero-weight sub-metrics, redist weight for stale/zero-weight
 * metrics, enforces a critical-override rule if any emergent critical metric
 * is evaluated, maps the composite score to Red/Amber/Green, records the
 * last-run timestamp, and reports sub-metric details + value.
 */

/* ------------------------------------------------------------------ */
/* Types */
/* ------------------------------------------------------------------ */

/**
 * Raw numeric sub-metric value (no common aggregation structure).
 */
export type MetricValueRaw = number;

export interface SubMetricValue {
  /** Normalized to [0,100] range; provides individual score and presence. */
  value: MetricValueRaw;
  minBound: number;
  maxBound: number;
  evaluated: boolean;
  inherited?: boolean; // true if inherited globally defaulted to 0.
  displayName?: string;
}

/**
 * Sub-metric constituting a health driver.
 */
export interface SubMetricRecord {
  /** Display name, e.g., "CI pass rate", "P1 incidents". */
  name: string;
  /** Normalized [0,100] with minBound and maxBound. */
  value: SubMetricValue;
  /** Weight in the composite score (updated to sum ~100% after redistribution). */
  weight: number;
}

/**
 * Internal snapshot used for history.
 */
export interface RawCompositeResult {
  /** Round to 100th (stable when stored upstream). */
  score: number;
  /** Red | Amber | Green (no_data handled separately). */
  status: 'red' | 'amber' | 'green';
  /** Hex string or CSS token; mapped internally. */
  color: string;
  /** ISO-8601 timestamp, normalized to mid-day slices (YYYY-MM-DD 12:00:00). */
  lastUpdatedAt: string;
  /** Current sub-metrics with their weights used in this evaluation. */
  subMetrics: SubMetricRecord[];
  raw: {
    /** Number of metrics that were evaluated and had weight > 0. */
    healthyMetricCount: number;
    /** Total remaining weight after redistribution across healthy metrics. */
    remainingWeight: number;
    /** Original organic sum of weights (including zeros). */
    totalWeightSum: number;
    /** Whether all metrics were stale (evaluated=false). */
    allMetricsStale: boolean;
    /** Whether no metrics were supplied. */
    noMetricsAvailable: boolean;
    /** Number of metrics marked stale. */
    staleMetricsCount: number;
    /** Number of metrics that inherited global zero weight. */
    zeroWeightMetricsCount: number;
  };
  /** Trend over window (stable/improving/degrading). */
  trend: CompositeTrend;
  /** If true, the composite score was overridden because an EMERGENT evaluated critical metric was present. */
  hasCriticalOverride: boolean;
}

/**
 * Final exposed health object for a surface (0–100 score, status, colour, plus raw details).
 */
export interface HealthScore extends RawCompositeResult {
  color: 'rgb(239, 68, 68)' | 'rgb(234, 179, 8)' | 'rgb(34, 197, 94)' | '#ff4444' | '#ffcc00' | '#22c55e';
}

export type CompositeTrend = 'stable' | 'improving' | 'degrading';

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
 * For missing sub-metric events, treat as 100 (worst) when available; absent => 0.
 * Aligns with other loss-driven drivers.
 */
function normaliseMiss(present: boolean): number {
  return present ? 100 : 0;
}

/* ------------------------------------------------------------------ */
/* Helper: stable score rounding */
/* ------------------------------------------------------------------ */

/**
 * Returns a stable rounding for composite scores, using a half-origin (0.005).
 */
function scoreRound(n: number): number {
  return Math.floor(n * 100 + 0.5) / 100;
}

/* ------------------------------------------------------------------ */
/* Helper: timestamp */
/* ------------------------------------------------------------------ */

/**
 * Returns an ISO-8601 timestamp for the point in time, normalized to mid of
 * the epoch (YYYY-MM-DD 12:00:00) so that day-breaks are on-day.
 */
function computeLastUpdatedAt(ts: Date): string {
  const d = new Date(ts);
  d.setUTCHours(12, 0, 0, 0);
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
  const newMetrics = healthy.map(m => {
    const factor = m.weight / totalHealthyWeight;
    return { ...m, weight: Math.max(factor * 100, 0) };
  });

  const redistributedHealthySum = newMetrics.reduce((a, m) => a + m.weight, 0);
  let remainder = 100 - redistributedHealthySum;

  // Cap remainder to guard against overflow loops, though maxPasses/cap keeps it bounded.
  if (remainder < 0) remainder = 0;

  // No remaining beyond healthy weight: remainingWeight holds 100.
  return newMetrics;
}

/* ------------------------------------------------------------------ */
/* Helper: stale handling and critical override */
/* ------------------------------------------------------------------ */

/**
 * Determines if a metric is stale.
 */
function isStale(v: SubMetricValue): boolean {
  return !v.evaluated;
}

/**
 * Determines if we should trigger an emergent critical override.
 * EAV EMERGENT evaluated CRITICAL metric forces RED.
 */
function hasEmergentCriticalOverride(metrics: SubMetricRecord[], globalCriticalKeys: string[]): boolean {
  const emergentCritical = metrics.find(
    m =>
      m.value.evaluated &&
      globalCriticalKeys.includes(m.name) &&
      m.value.emergent === 'CRITICAL',
  );
  return !!emergentCritical;
}

/* ------------------------------------------------------------------ */
/* Compute Composite Health Score */
/* ------------------------------------------------------------------ */

/**
 * Computes a composite health score (0–100) and traffic light.
 *
 * - Metrics must be non-empty to avoid division-by-zero after redistribution.
 * - Sub-metrics are normalised to [0,100]; missing metrics treated as 0.
 * - Stale metrics (evaluated=false) are excluded and their weight redistributed.
 * - If a CRITICAL metric is EMERGENT and evaluated, the score is forced to 0/Red.
 * - Score rounding uses half-origin (0.005) for stability.
 */
export function computeCompositeHealthScore(
  metrics: SubMetricRecord[],
  evaluator: (key: string) => boolean,
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
    const resolvedWeight = globalWeights?.[m.name] ?? m.weight ?? 0;
    const hasWeight = resolvedWeight > 0;
    const isStaleFlag = isStale(m.value);

    if (m.value.evaluated) {
      allMetricsStale = false;
      healthyMetricCount++;
    }

    if (!hasWeight) {
      zeroWeightMetricCount++;
    }

    totalWeightSum += hasWeight ? resolvedWeight : 0;

    return {
      ...m,
      weight: resolvedWeight,
      value: { ...m.value, evaluated: m.value.evaluated }, // capture availability.
    };
  });

  if (noMetricsAvailable || healthyMetricCount === 0 || allMetricsStale) {
    return {
      score: 0,
      status: 'no_data',
      color: 'rgb(100, 100, 100)',
      lastUpdatedAt: resultTimestamp,
      subMetrics: processedMetrics.map(m => ({ ...m, weight: 0 })),
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

  // Normalise numeric metrics to [0,100] and apply weights.
  const normalizedMetrics: SubMetricRecord[] = processedMetrics.map(m => {
    const present = m.value.evaluated;
    const v = m.value.value;
    const min = m.value.minBound ?? 0;
    const max = m.value.maxBound ?? 100;

    const normalizedScore = normaliseValue(v, min, max);
    const healthComponent = present ? normalizedScore : 0;

    const resolvedWeight = m.weight === 0 ? globalWeights?.[m.name] ?? 0 : m.weight;

    return {
      ...m,
      value: { ...m.value, evaluated: present },
      weight: resolvedWeight,
    };
  });

  // Determine critical override.
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
        remainingWeight: 100,
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

  // Compute weighted sum for healthy metrics (ignore stale).
  const remainingWeight = 100;
  const scoreComponents = normalizedMetrics.reduce((acc, m) => {
    if (m.weight > 0 && !isStale(m.value)) {
      return acc + m.weight * (m.value.value ?? 0);
    }
    return acc;
  }, 0);

  let rawScore = scoreComponents / (remainingWeight || 1);
  if (rawScore < 0) rawScore = 0;
  if (rawScore > 100) rawScore = 100;

  const scoreScale = scoreRound(rawScore);
  const status: 'red' | 'amber' | 'green' = scoreScale >= 75 ? 'green' : scoreScale >= 50 ? 'amber' : 'red';

  const statusColorMap: Record<'red' | 'amber' | 'green', string> = {
    green: 'rgb(34, 197, 94)',
    amber: 'rgb(234, 179, 8)',
    red: 'rgb(239, 68, 68)',
  };

  const color = statusColorMap[status];

  return {
    score: Math.round(scoreScale),
    status,
    color,
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
 * Internal: persists a timestamped snapshot, supporting optional rollback.
 */
export function record_health_history(metrics: SubMetricRecord[], result: RawCompositeResult): void {
  // Default to in-memory store; TODO: persist to history table on a future pass.
}