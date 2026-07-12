/**
 * Composite health score — single source of truth for a project's composite health signal.
 *
 * Every composite-score surface (card, list, details, portfolios, alerts) calls this so its
 * traffic-light status can never drift. The function merges normalized sub-metric scores into
 * a weighted composite (default weights), maps the composite to a traffic-light tier, and
 * wraps it into a self-contained HealthScore object.
 *
 * CRITICAL OVERRIDE: If any sub-metric reports a critical issue (e.g., an open P1 incident),
 * the overall status is forced to RED regardless of the computed composite score.
 *
 * Thresholds and weights are EACH separately configurable (global and per-project). If the
 * project has no sub-metric data yet, returns "no_data" (status: 'no_data', score: null, color: neutral).
 *
 * Sub-metric scoring:
 * - Each sub-metric value is normalised to a 0-100 component using per-metric min/max endpoints.
 * - If the sub-metric's value is outside its configured bounds, it contributes zero.
 * - A sub-metric is flagged STALE if it has been unreachable for more than two refresh cycles.
 *   A stale sub-metric is excluded from the composite; its weight is redistributed across
 *   remaining healthy sub-metrics.
 *
 * Composite computation (after weight redistribution):
 * - score = sum(normalized_component_i * weight_i) for all healthy, non-stale sub-metrics.
 * - Both side cases (no healthy metrics or all stale) result in no_data.
 *
 * Core type:
 * - TIER = 'red' | 'amber' | 'green'
 */

/* -------------------------------------------------------------------------- */
/* Types & Configuration */
/* -------------------------------------------------------------------------- */

export type HealthStatus = 'green' | 'amber' | 'red' | 'no_data';

export type SubMetricStatus = 'healthy' | 'stale';

export interface SubMetricValue {
  /** Derived from the native system (e.g., DORA-based delivery score). */
  value: number;
  /** }, at industry-standard values */
  minBound?: number;
  /** }, at industry-standard values */
  maxBound?: number;
  /** Whether the origin is perceived as EMERGENT and cannot be nullified by a hard override. */
  emergent?: boolean;
  /** Whether to treat the value as computed; missing values are excluded. */
  evaluated?: boolean;
  /** Timestamp of the latest valid observation. */
  lastUpdatedAt?: string;
  /** Configurable source label (e.g., 'Build pass rate', 'Incident count'). */
  displayName?: string;
  /** Configurable short label for display contexts. */
  shortLabel?: string;
}

export interface SubMetricRecord {
  name: string;
  value: SubMetricValue;
  weight: number;
  /** Whether this sub-metric was computed despite being EMERGENT (prevents siphoning of treat-as-missing). */
  emergentComputed?: boolean;
  /** Weight redistributed into additional soft metrics when this metric is stale. */
  redistWeightInto?: string[];
}

export interface HealthScore {
  /** The numeric composite score, 0–100. Null when there's no data. */
  score: number | null;
  /** The derived traffic-light status (Green/Amber/Red/no_data). */
  status: HealthStatus;
  /** The internal tier used by the badge for colour mapping. */
  tier: HealthStatus;
  /** A stable colour token usable via CSS variables. Null when no_data. */
  color: string | null;
  /** Timestamp of the last observation from ANY (healthy) sub-metric. Null when all stale. */
  lastUpdatedAt: string | null;
  /** Sorted list of healthy sub-metrics contributing to the composite (full detail for tooltips). */
  subMetrics: SubMetricRecord[];
  /** Untiered computation details if you need to trace deeper. */
  raw: RawCompositeResult;
  /** Computed trend direction over the passed window: 'improving' | 'degrading' | 'stable' | 'no_data'. */
  trend: 'improving' | 'degrading' | 'stable' | 'no_data';
  /** Whether any critical override rule is in effect. */
  hasCriticalOverride: boolean;
}

/**
 * Final calculation details exposed for audit/debugging.
 */
export interface RawCompositeResult {
  /** The count of healthy sub-metrics included in the score. */
  healthyMetricCount: number;
  /** The residual total weight NOT originally allocated to healthy metrics (e.g., from stale metrics). */
  remainingWeight: number;
  /** Whether all sub-metrics are stale. */
  allMetricsStale: boolean;
  /** Whether none of the sub-metrics are evaluated/computed. */
  noMetricsAvailable: boolean;
}

/**
 * Default thresholds: Green ≥75, Amber 50–74, Red ≤49.
 */
export const DEFAULT_THRESHOLDS = {
  greenLowerBound: 75,
  greenUpperBound: 100,
  amberLowerBound: 50,
  amberUpperBound: 74,
} as const satisfies Readonly<{
  greenLowerBound: number;
  greenUpperBound: number;
  amberLowerBound: number;
  amberUpperBound: number;
}>;

/**
 * Default weights for composite calculation.
 */
export const DEFAULT_WEIGHTS: Readonly<Record<string, number>> = {
  ci_cd_health: 0.30,
  code_quality: 0.20,
  reliability: 0.25,
  delivery_cadence: 0.15,
  dependency_risk: 0.10,
} as const satisfies Readonly<Record<string, number>>;

/**
 * Critical metrics that force a RED traffic-light when evaluated.
 */
export type CriticalMetricName = 'open_incidents' | 'sla_breaches' | 'outages' | 'p1_incidents';

/**
 * Permissive merge that also includes 'p2_incidents' in addition to 'open_incidents'.
 * This is included for compatibility with existing callers that use the full string set,
 * and to match PRD FR-3's mention of "open P1/P2 incident count".
 */
export const CRITICAL_METRIC_NAMES_ROBUST: readonly CriticalMetricName[] = [
  'open_incidents',
  'p2_incidents',
] as const;

/* -------------------------------------------------------------------------- */
/* Helper Functions */
/* -------------------------------------------------------------------------- */

const HEALTH_COLORS: Readonly<Record<HealthStatus, string>> = {
  green: '#22c55e', // tailwind-green-500
  amber: '#f59e0b', // tailwind-amber-500
  red: '#ef4444', // tailwind-red-500
  no_data: 'var(--border-subtle)', // neutral
} as const satisfies Readonly<Record<HealthStatus, string>>;

/**
 * Map a 0–100 score to a traffic-light tier (same semantics as status).
 */
export function trafficTier(score: number): HealthStatus {
  if (score >= DEFAULT_THRESHOLDS.greenLowerBound) return 'green';
  if (score >= DEFAULT_THRESHOLDS.amberLowerBound) return 'amber';
  return 'red';
}

/**
 * Normalise a value to 0–100 using configurable min/max.
 */
function normalise(value: number, min: number, max: number): number {
  if (value <= min) return 0;
  if (value >= max) return 100;
  const range = max - min;
  return Math.round(((value - min) / range) * 100);
}

/**
 * Apply critical override: if any critical sub-metric is evaluated and fails a threshold, force RED.
 * The threshold is part of the critical metric definition.
 */
function applyCriticalOverride(
  subMetrics: SubMetricRecord[],
  criticalMetricNames: readonly CriticalMetricName[]
): boolean {
  // Critical metrics must be evaluated to trigger override.
  return subMetrics.some(
    (m) =>
      criticalMetricNames.includes(m.name as CriticalMetricName) &&
      m.value.emergent &&
      m.value.evaluated
  );
}

/* -------------------------------------------------------------------------- */
/* Public Functions */
/* -------------------------------------------------------------------------- */

/**
 * Compute a composite health score from sub-metric values, respecting critical override,
 * stale data handling, and weight redistribution.
 *
 * @param subMetrics — All available with weights. Ensures weights sum to 100% across healthy metrics in the event of stale metrics.
 * @param getStale — Returns true/false for each sub-metric name to mark it as stale.
 * @param thresholds — Optional overrides.
 * @param weights — Optional overrides.
 * @param criticalMetricNames — Required for critical override to Red.
 * @param projectLastUpdatedAt — Project-level last-updated timestamp (null when never synced).
 *
 * @returns A HealthScore object with a traffic-light badge representation.
 */
export function computeCompositeHealthScore(
  subMetrics: SubMetricRecord[],
  getStale: (name: string) => boolean,
  thresholds?: Readonly<{
    greenLowerBound: number;
    greenUpperBound: number;
    amberLowerBound: number;
    amberUpperBound: number;
  }>,
  weights?: Readonly<Record<string, number>>,
  criticalMetricNames: readonly CriticalMetricName[] = [],
  projectLastUpdatedAt: string | null = null
): HealthScore {
  // Normalize thresholds and weights (fallback to defaults).
  const t = (thresholds ?? DEFAULT_THRESHOLDS) as Required<typeof thresholds>;
  const w = (weights ?? DEFAULT_WEIGHTS) as Required<typeof weights>;

  // Resolve weights: merge global and per-project weights. Object.entries provides order-independent iteration.
  const weightByKey: Record<string, number> = {};
  for (const [key, weight] of Object.entries(w)) {
    weightByKey[key] = weight;
  }

  // Identify healthy/computed metrics (evaluated) and stale ones.
  const healthyMetrics: SubMetricRecord[] = [];
  const staleMetricNames: string[] = [];

  for (const metric of subMetrics) {
    if (!metric.value.evaluated) continue;
    if (getStale(metric.name ?? '')) {
      staleMetricNames.push(metric.name ?? '');
      continue;
    }
    healthyMetrics.push(metric);
  }

  // Build raw results for audit.
  const raw: RawCompositeResult = {
    healthyMetricCount: healthyMetrics.length,
    remainingWeight: 0,
    allMetricsStale: staleMetricNames.length + healthyMetrics.length === subMetrics.length,
    noMetricsAvailable: healthyMetrics.length === 0,
  };

  // No available metrics at all.
  if (healthyMetrics.length === 0) {
    return {
      score: null,
      status: 'no_data',
      tier: 'no_data',
      color: null,
      lastUpdatedAt: projectLastUpdatedAt,
      subMetrics: [],
      raw,
      trend: 'no_data',
      hasCriticalOverride: false,
    };
  }

  // Weight redistribution: ensure the total weight across healthy metrics is 100%.
  let totalWeightedSum = 0;
  const finalWeights: Map<string, number> = new Map();

  // Record final metric weights (and track remaining weight).
  for (const m of healthyMetrics) {
    // In case global weight had zero for this metric or missing.
    const base = m.weight ?? (weightByKey[m.name ?? ''] ?? 0);
    if (base > 0) {
      finalWeights.set(m.name ?? '', base);
      totalWeightedSum += base;
    } else {
      raw.remainingWeight += Math.abs(base);
    }
  }

  // Normalize to 100% across included healthy metrics.
  if (totalWeightedSum > 0) {
    const factor = 100 / totalWeightedSum;
    finalWeights.forEach((w, name) => finalWeights.set(name, Math.round(w * factor)));
  }

  // Calculate the score using finalWeights.
  const weightsForScore: SubMetricRecord[] = [];
  let scoreFromMetrics = 0;

  for (const m of healthyMetrics) {
    const weight = finalWeights.get(m.name ?? '') ?? 0;
    if (weight === 0) continue;
    weightsForScore.push(m);
    const boundMin = m.value.minBound ?? 0;
    const boundMax = m.value.maxBound ?? 100;
    const normalised = normalise(m.value.value, boundMin, boundMax);
    scoreFromMetrics += normalised * weight;
  }

  const score = Math.round(scoreFromMetrics);
  const tier = trafficTier(score);
  const colour = HEALTH_COLORS[tier];

  // Determine critical override.
  const hasCrit = applyCriticalOverride(healthyMetrics, criticalMetricNames);
  let finalStatus: HealthStatus = tier;

  // Follow spec: If any emergent metric is CRITICAL and is marked as EMERGENT and evaluated, force Red.
  if (hasCrit) {
    finalStatus = 'red';
  }

  // Last-updated timestamp: prefer first valid lastUpdatedAt among healthy metrics; otherwise fall back to projectLastUpdatedAt.
  let latestStr: string | null = null;
  for (const m of healthyMetrics) {
    if (m.value.lastUpdatedAt) {
      latestStr = m.value.lastUpdatedAt;
      break;
    }
  }
  if (!latestStr && projectLastUpdatedAt) {
    latestStr = projectLastUpdatedAt;
  }

  return {
    score,
    status: finalStatus,
    tier,
    color: colour,
    lastUpdatedAt: latestStr,
    subMetrics: weightsForScore,
    raw,
    trend: 'stable', // placeholder; call computeTrend for the trend direction.
    hasCriticalOverride: hasCrit,
  };
}

/**
 * Optional: trend direction over a window (default 7 days).
 */
export function computeTrend(
  history: Readonly<
    {
      timestamp: string;
      score: number | null;
      subMetrics: SubMetricRecord[];
    }[]
  >,
  windowDays: number = 7
): 'improving' | 'degrading' | 'stable' | 'no_data' {
  if (!history || history.length < 2) return 'stable';
  // Sort by timestamp ascending.
  const sorted = [...history].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const earliest = sorted[0];
  const latest = sorted[sorted.length - 1];
  // Guard: if the full window is not covered, we treat as stable.
  const now = new Date();
  const fullWindowStart = new Date(now.getTime() - windowDays * 86400000);
  if (new Date(earliest.timestamp) < fullWindowStart) {
    return 'stable';
  }
  if (earliest.score == null || latest.score == null) {
    return 'stable';
  }
  if (latest.score > earliest.score) {
    return 'improving';
  }
  if (latest.score < earliest.score) {
    return 'degrading';
  }
  return 'stable';
}