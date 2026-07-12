/**
 * Integration Hub — mapping rules and data collection logic (grounded with real enum values and abstain from extra body metadata fields).
 *
 *   - How ingested metrics connect to insight categories (Quality, Delivery, Velocity, etc.)
 *   - Anomaly detection rules (e.g., "Bug count is 2x the 30-day average")
 *   - Cache version key for invalidating insight engines on new data
 */

import type { InsightCategory } from './types';

/** Cache version key for the Integration Hub layers. */
export function integrationHubVersionKey(tenantId: number): string {
  return `integration-hub-version:tenant:${tenantId}`;
}

/**
 * Insight mappings — canonical list of how ingested metrics should be consumed by insight engines.
 * These rules are used by the hub to map external data (bug_count, deployment_frequency, etc.) to
 * internal insight categories that already exist in the platform (quality_bugs, delivery_speed, etc.).
 */
export const INSIGHT_MAPPINGS: Array<{
  /** Metric name as it appears in external tools (e.g., 'bug_count', 'deployment_frequency'). */
  metricName: string;
  /** Human-readable label for the UI. */
  label: string;
  /** Target insight category this metric feeds into. */
  targetCategory: InsightCategory;
  /** Anomaly window in days (null = use default 30-day). */
  anomalyWindowDays?: number | null;
  /** Aggregation function for time-series analysis (null = raw single-value snapshot). */
  aggregationFn?: 'sum' | 'avg' | 'median' | null;
}> = [
  // Quality & Bugs category
  {
    metricName: 'bug_count',
    label: 'Bug count (external)',
    targetCategory: InsightCategory.QUALITY_BUGS,
    anomalyWindowDays: 30,
  },
  {
    metricName: 'critical_bug_count',
    label: 'Critical bug count',
    targetCategory: InsightCategory.QUALITY_BUGS,
    anomalyWindowDays: 30,
  },
  {
    metricName: 'high_bug_count',
    label: 'High-priority bug count',
    targetCategory: InsightCategory.QUALITY_BUGS,
    anomalyWindowDays: 30,
  },
  // Delivery Flow category
  {
    metricName: 'pr_cycle_time_seconds',
    label: 'PR cycle time',
    targetCategory: InsightCategory.DELIVERY_FLOW,
    anomalyWindowDays: 30,
  },
  {
    metricName: 'pr_cycle_time_minutes',
    label: 'PR cycle time (minutes)',
    targetCategory: InsightCategory.DELIVERY_FLOW,
    anomalyWindowDays: 30,
  },
  {
    metricName: 'open_pr_count',
    label: 'Open PR count',
    targetCategory: InsightCategory.DELIVERY_FLOW,
    anomalyWindowDays: 30,
  },
  // Delivery Speed category
  {
    metricName: 'deployment_frequency_count',
    label: 'Deployment frequency',
    targetCategory: InsightCategory.DELIVERY_SPEED,
    anomalyWindowDays: 30,
  },
  // Technical Debt category
  {
    metricName: 'build_failure_rate_percent',
    label: 'Build failure rate',
    targetCategory: InsightCategory.TECHNICAL_DEBT,
    anomalyWindowDays: 30,
  },
  {
    metricName: 'failed_build_count',
    label: 'Failed build count',
    targetCategory: InsightCategory.TECHNICAL_DEBT,
    anomalyWindowDays: 30,
  },
  // Reliability category
  {
    metricName: 'incident_count',
    label: 'Incident count',
    targetCategory: InsightCategory.RELIABILITY,
    anomalyWindowDays: 30,
  },
  {
    metricName: 'resolved_incident_count',
    label: 'Resolved incidents',
    targetCategory: InsightCategory.RELIABILITY,
    anomalyWindowDays: 30,
  },
  {
    metricName: 'mttr_minutes',
    label: 'Mean time to resolve (minutes)',
    targetCategory: InsightCategory.RELIABILITY,
    anomalyWindowDays: 30,
  },
  // Velocity category
  {
    metricName: 'team_velocity_points',
    label: 'Team velocity (points)',
    targetCategory: InsightCategory.VELOCITY,
    anomalyWindowDays: 30,
  },
  {
    metricName: 'completed_task_count',
    label: 'Completed task count',
    targetCategory: InsightCategory.VELOCITY,
    anomalyWindowDays: 30,
  },
  {
    metricName: 'backlog_item_count',
    label: 'Backlog item count',
    targetCategory: InsightCategory.VELOCITY,
    anomalyWindowDays: 30,
  },
  // Capacity category
  {
    metricName: 'resource_allocation_fraction',
    label: 'Resource allocation %',
    targetCategory: InsightCategory.CAPACITY,
    anomalyWindowDays: 30,
  },
];

/**
 * Find a mapping rule by metric name.
 */
export function findMapping(metricName: string) {
  return INSIGHT_MAPPINGS.find((m) => m.metricName === metricName);
}

/**
 * Find mapping rules by target category.
 */
export function findMappingsByCategory(category: InsightCategory) {
  return INSIGHT_MAPPINGS.filter((m) => m.targetCategory === category);
}

/**
 * Detect anomalies in ingested time series data.
 *
 * Compares a recent window of measurements against a historical baseline (30 days by default)
 * and flags values that deviate significantly (2x for high, 1.5x for medium, 1.1x for low).
 *
 * @param measurements Array of { timestamp, value } objects — must be sorted chronologically.
 * @param baselineCount Number of historical data points to use for the baseline average.
 * @returns Array of anomaly results (empty = no anomalies detected).
 */
export function detectAnomalies(
  measurements: Array<{ timestamp: Date; value: number }>,
  baselineCount = 30,
): Array<{
  metricName: string;
  currentValue: number | null;
  averageValue: number;
  delta: number;
  deltaPercent: number;
  severity: 'high' | 'medium' | 'low';
}> {
  if (measurements.length < baselineCount + 1) {
    // Not enough data to establish a baseline
    return [];
  }

  // Split into baseline (first N points) vs recent (remaining points)
  const baseline = measurements.slice(0, baselineCount);
  const recent = measurements.slice(baselineCount);

  const anomalies: Array<{
    metricName: string;
    currentValue: number | null;
    averageValue: number;
    delta: number;
    deltaPercent: number;
    severity: 'high' | 'medium' | 'low';
  }> = [];

  // Process each recent data point
  for (const point of recent) {
    const avg = baseline.reduce((sum, p) => sum + p.value, 0) / baseline.length;

    if (point.value === null || point.value === undefined) continue;

    const delta = point.value - avg;
    const deltaPercent = avg > 0 ? (delta / avg) * 100 : delta > 0 ? Infinity : -Infinity;

    // Determine severity thresholds
    const severity: 'high' | 'medium' | 'low' =
      deltaPercent > 100 ? 'high' : deltaPercent > 50 ? 'medium' : deltaPercent > 10 ? 'low' : null;

    if (severity) {
      anomalies.push({
        metricName: 'unknown', // Will be enriched by the caller
        currentValue: point.value,
        averageValue: avg,
        delta,
        deltaPercent,
        severity,
      });
    }
  }

  return anomalies;
}

/**
 * Detect anomalies for a full set of ingested metrics.
 *
 * Groups datums by category (for per-category reporting) and names anomalies within each.
 */
export function detectAnomaliesForMetrics(
  measurementsByMetric: Record<string, Array<{ timestamp: Date; value: number }>>,
): Array<{
  categoryId: string;
  metrics: Record<
    string,
    {
      currentValue: number | null;
      averageValue: number;
      delta: number;
      deltaPercent: number;
      severity: 'high' | 'medium' | 'low';
    }
  >;
  hasCriticalAnomaly: boolean;
}> {
  const multiAnomaly: Array<{
    categoryId: string;
    metrics: Record<
      string,
      {
        currentValue: number | null;
        averageValue: number;
        delta: number;
        deltaPercent: number;
        severity: 'high' | 'medium' | 'low';
      }
    >;
    hasCriticalAnomaly: boolean;
  }> = [];

  // Group by target category (from mapping rules)
  const metricsByCategory = new Map<string, Array<{ name: string; values: Array<{ timestamp: Date; value: number }> }>>();

  const ms = measurementsByMetric;
  for (const [metricName, values] of Object.entries(ms)) {
    const mapping = findMapping(metricName);
    if (!mapping) continue;

    const cat = mapping.targetCategory;
    if (!metricsByCategory.has(cat)) {
      metricsByCategory.set(cat, []);
    }
    metricsByCategory.get(cat)!.push({ name: metricName, values });
  }

  // Run anomaly detection per category
  const defaultWindowDays = 30;
  for (const [categoryId, items] of metricsByCategory) {
    const metrics: Record<
      string,
      {
        currentValue: number | null;
        averageValue: number;
        delta: number;
        deltaPercent: number;
        severity: 'high' | 'medium' | 'low';
      }
    > = {};

    for (const item of items) {
      const anomalies = detectAnomalies(item.values, defaultWindowDays);
      if (anomalies.length > 0) {
        for (const an of anomalies) {
          metrics[item.name] = {
            currentValue: an.currentValue,
            averageValue: an.averageValue,
            delta: an.delta,
            deltaPercent: an.deltaPercent,
            severity: an.severity,
          };
        }
      }
    }

    multiAnomaly.push({
      categoryId,
      metrics,
      hasCriticalAnomaly: Object.values(metrics).some((m) => m.severity === 'high'),
    });
  }

  return multiAnomaly;
}