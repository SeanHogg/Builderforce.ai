/**
 * Composite health score -- single source of truth for a project's composite health signal.
 *
 * Every composite-score surface (card, list, details, portfolios, alerts) calls this so its
 * traffic-light status can never drift. The function merges normalized sub-metric scores into
 * a weighted composite (default weights), maps the composite to a traffic-light tier, and
 * wraps it into a self-contained HealthBadge object.
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

const DEFAULT thresholds = {
  greenLowerBound: 75,
  greenUpperBound: 100,
  amberLowerBound: 50,
  amberUpperBound: 74,
} as const satisfies Readonly<{ greenLowerBound: number; greenUpperBound: number; amberLowerBound: number; amberUpperBound: number }>;

const DEFAULT weights: Readonly<Record<string, number>> = {
  ci_cd_health: 0.30,
  code_quality: 0.20,
  reliability: 0.25,
  delivery_cadence: 0.15,
  dependency_risk: 0.10,
} as const satisfies Readonly<Record<string, number>>;

export type HealthStatus = 'green' | 'amber' | 'red' | 'no_data';

export type SubMetricStatus = 'healthy' | 'stale';

export interface SubMetricValue {
  /** Derived from the native system (e.g., DORA-based delivery score). */
  value: number;
  /** Configurable minimum bound; values below are scored as 0. Defaults to 0. */
  minBound?: number;
  /** Configurable maximum bound; values above are scored as 100. Defaults to 100. */
  maxBound?: number;
  /** Whether the origin is perceived as EMERGENT and cannot be nulled by a hard override. */
  emergent?: boolean;
  /** Whether to treat the value as the true value; otherwise, treat as missing. */
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

/** Final calculation details exposed for audit/debugging. */
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

/* -------------------------------------------------------------------------- */
/* Helper Functions */
/* -------------------------------------------------------------------------- */

const HEALTH_COLOURS: Readonly<Record<HealthStatus, string>> = {
  green: '#22c55e', // tailwind-green-500
  amber: '#f59e0b', // tailwind-amber-500
  red: '#ef4444' as '#ef4444', // tailwind-red-500
  no_data: 'var(--border-subtle)', // neutral
} as const satisfies Readonly<Record<HealthStatus, string>>;

/** Map a 0–100 score to a traffic-light tier (same semantics as status). */
export function trafficTier(score: number): HealthStatus {
  if (score >= DEFAULT.thresholds.greenLowerBound) return 'green';
  if (score >= DEFAULT.thresholds.amberLowerBound) return 'amber';
  return 'red';
}

/** Normalise a value to 0–100 using configurable min/max. */
function normalise(value: number, min: number, max: number): number {
  if (value <= min) return 0;
  if (value >= max) return 100;
  const range = max - min;
  return Math.round(((value - min) / range) * 100);
}

/** Apply critical override: if any sub-metric is an emergent ERGENT critical, force and return RED status with a single emergent override flag. */
function applyCriticalOverride(
  subMetrics: SubMetricRecord[],
  criticalMetricNames: string[]
): boolean {
  // If any emergent metric is in CRITICAL and is marked as evaluated, it must dominate.
  // Non-emergent metrics do not serve as a reason to force; mitigating (non-critical) metrics work as normal.
  const emergentCritical = subMetrics.some(
    (m) =>
      criticalMetricNames.includes(m.name) &&
      m.value.emergent &&
      m.value.evaluated
  );
  // Otherwise, if any strictly critical metric exists, override (non-critical emergent metrics cannot force).
  const anyOtherCritical =
    !emergentCritical &&
    subMetrics.some(
      (m) => criticalMetricNames.includes(m.name) && m.value.value <= SOME_THRESHOLD_CRITICAL
    );
  // Both patterns force. In the emergent-only case, the computed override is emitted at the return level.
  return emergentCritical || anyOtherCritical;
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
  thresholds?: Readonly<{ greenLowerBound: number; greenUpperBound: number; amberLowerBound: number; amberUpperBound: number }>,
  weights?: Readonly<Record<string, number>>,
  criticalMetricNames: string[] = [],
  projectLastUpdatedAt: string | null = null
): HealthScore {
  // Normalize thresholds and weights (fallback to defaults).
  const t = (thresholds ?? DEFAULT.thresholds) as Required<typeof thresholds>;
  const w = (weights ?? DEFAULT.weights) as Required<typeof weights>;

  // Resolve weights (pre-fallback to global, per-project per spec). Global weight may be omitted.
  const weightByKey: Record<string, number> = {};
  for (const [key, weight] of Object.entries(w)) {
    weightByKey[key] = weight;
  }

  // Identify healthy/computed metrics (evaluated) and stale ones.
  const healthyMetrics: SubMetricRecord[] = [];
  const staleMetricNames: string[] = [];

  for (const metric of subMetrics) {
    if (!metric.value.evaluated) continue;
    if (getStale(metric.name)) {
      staleMetricNames.push(metric.name);
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
      lastUpdatedAt: projectLastUpdatedAt, // Preserve the project-level timestamp if available.
      subMetrics: [],
      raw,
      trend: 'no_data',
      hasCriticalOverride: false,
    };
  }

  // Weight redistribution: ensure remaining weight is zero after weight_diff is absorbed into positions where we sent redistWeightInto (used at decision time).
  let totalWeightedSum = 0;
  const finalWeights: Map<string, number> = new Map();

  // Record final metric weights (and track remaining redist space).
  for (const m of healthyMetrics) {
    // In case global weight had zero for this metric or missing.
    const base = m.weight ?? (weightByKey[m.name] ?? 0);
    // Redistribute any missing baseline weight from previously-sending metrics.
    // We track base here, not redist-weight-in.
    if (base > 0) {
      finalWeights.set(m.name, base);
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
    const weight = finalWeights.get(m.name) ?? 0;
    if (weight === 0) continue;
    weightsForScore.push(m);
    const boundMin = m.value.minBound ?? 0;
    const boundMax = m.value.maxBound ?? 100;
    const normalised = normalise(m.value.value, boundMin, boundMax);
    scoreFromMetrics += normalised * weight;
  }

  // If there are still unresolved redistCapacity(metrics whose weight was sent into others) and they exist in finalWeights, reallocate to nearest-noise logic:
  // For each metric with a planned redist, find the closest metric (lowest delta) that does not already have excess and add that delta.
  // If out of good candidates, we dead-end to the average: allocate the remaining to the nearest avg-to-noise metric.
  // This ensures we hit exactly 100% across healthy metrics (actual votes), with remaining weight being zero.
  // We'll capture and sort by leftover delta first.
  const redistCandidates: { name: string; original: number; current: number; delta: number }[] = [];
  // Initialize each with original (if present) and current (as base).
  for (const m of subMetrics) {
    const orig = (m.weight ?? (weightByKey[m.name] ?? 0));
    const cur = finalWeights.get(m.name) ?? 0;
    redistCandidates.push({ name: m.name, original: orig, current: cur, delta: orig - cur });
  }

  // Iterate and distribute. We support up to 2 full passes (complex spec safety net).
  const maxPasses = 2;
  for (let pass = 0; pass < maxPasses; ++pass) {
    // If everything is settled, break early.
    if (redistCandidates.length === 0) break;
    // Filter out settled lines. A line is settled if its original == current.
    const unsettled = redistCandidates.filter((c) => c.delta !== 0);
    if (unsettled.length === 0) break;
    // Identify where we are trying to pull from.
    const donorIdx = unsettled.findIndex((c) => c.delta > 0); // original > current
    if (donorIdx === -1) break; // no donor; cannot proceed.
    const donor = unsettled[donorIdx];
    if (donor.delta === 0) break;
    // If this was a redistMetricCandidate, we track its planned recv list.
    const recipientIndex = unsettled.findIndex((c) => c.delta < 0 && finalWeights.get(c.name)! !== 0);
    let fromMetricWeight = 0;
    if (recipientIndex !== -1) {
      // Find a metric we had planned to send into; choose the first compatible (non-zero current).
      // We also may find other metrics where delta < 0 but we didn't necessarily plan to send there.
      // For simplicity, pick the first valid candidate.
      const target = unsettled[recipientIndex];
      if (target.name === donor.name) break; // self-redistribute is a no-op.
      fromMetricWeight = Math.abs(target.delta);
      // Cap at donor's available delta, but don't exceed 1.0 (spec says absolute values are capped).
      if (fromMetricWeight > donor.delta) fromMetricWeight = donor.delta;
      const maxCap = Math.max(Math.abs(target.current) * (maxCapAsRatio ?? 1.5), 0);
      if (fromMetricWeight > maxCap) fromMetricWeight = maxCap;
    }

    // If no viable recipient (no positive delta), we dead-end to nearest noise logic:
    // Spread the delta to the metric with smallest absolute delta.
    if (recipientIndex === -1) {
      // Sort by absolute delta ascending.
      const sorted = [...unsettled].sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta));
      if (sorted.length === 0) break;
      // Use the first.
      const deadEnd = sorted[0];
      const deadEndAmount = fromMetricWeight;
      if (deadEndAmount === 0) break;
      // Apply dead-end to that metric's current + delta.
      const newCur = deadEnd.current - deadEndAmount;
      finalWeights.set(deadEnd.name, newCur);
      // Update the list entry in redistCandidates.
      const idx = unsettled.findIndex((c) => c.name === deadEnd.name);
      if (idx !== -1) {
        unsettled[idx] = { name: deadEnd.name, original: deadEnd.original, current: newCur, delta: deadEnd.original - newCur };
      }
      // Remove from candidates (settled after this distribution).
      const realIdx = redistCandidates.findIndex((c) => c.name === deadEnd.name);
      if (realIdx !== -1) {
        redistCandidates.splice(realIdx, 1);
      }
    } else {
      // There is a recipient. Apply the fromMetricWeight delta.
      const target = unsettled[recipientIndex];
      // Cap the resulting weight: clamp to ensure we don't go negative and abide by reasonable limits.
      const prev = finalWeights.get(target.name) ?? 0;
      let newWeight = prev - fromMetricWeight;
      const minCap = 0; // non-destructive but we guard.
      if (newWeight < minCap) newWeight = minCap;
      finalWeights.set(target.name, newWeight);
      // Update redistCandidates entry.
      const idx = unsettled.findIndex((c) => c.name === target.name);
      if (idx !== -1) {
        unsettled[idx] = { name: target.name, original: target.original, current: newWeight, delta: target.original - newWeight };
      }
    }
  }
  // End redistribution.

  const score = Math.round(scoreFromMetrics);
  const tier = trafficTier(score);
  const colour = HEALTH_COLOURS[tier];

  // Determine critical override.
  // Use pull-on-demand critical override logic: if any critMetric names appear in healthyMetrics with emergent && evaluated, force override.
  const hasCrit = applyCriticalOverride(healthyMetrics, criticalMetricNames);
  let finalStatus: HealthStatus = tier;

  // Follow spec: If any emergent metric is CRITICAL and is marked as EMERGENT and evaluated, force Red and surface emergent override.
  // If another critical metric (non-emergent) also meets 'anyOtherCritical' condition, also force Red.
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
    trend: 'stable', // placeholder; call computeTrend for the trend direction via computeTrend專用 lambda.
    hasCriticalOverride: hasCrit,
  };
}

/**
 * Optional: trend direction over a window (default 7 days). Implementation below.
 */
export function computeTrend(
  history: Readonly<{ timestamp: string; score: number | null; subMetrics: SubMetricRecord[] }>[],
  windowDays: number = 7
): 'improving' | 'degrading' | 'stable' | 'no_data' {
  if (!history || history.length < 2) return 'stable'; // Use stable as a reasonable default for insufficient history.
  // Sort by timestamp ascending.
  const sorted = [...history].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp)
  );
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