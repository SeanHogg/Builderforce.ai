/**
 * Integration Hub — mapping rules and module exports for version key helper(s).
 *
 *   - Cache version key for hub writes.
 *   - Mapping rules linking external metrics to internal insight categories.
 *   - **Grounded: only writes to prod_incidents with timestamp fields (no extra columns).**
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
  /** Optional window size in days for anomaly detection (null = use default 30). */
  anomalyWindowDays?: number | null;
  /** Default aggregation function (null = raw value). */
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