/**
 * Task Insights Types
 * 
 * Types for task-level health, trends, anomalies, and supporting data.
 */

/**
 * Current health state of a task
 * @value RED - Critical (due date within 1-24 hours or missed)
 * @value YELLOW - Cautionary (due date within 2-3 days)
 * @value GREEN - On track (due date > 3 days)
 */
export type HealthState = 'RED' | 'YELLOW' | 'GREEN';

/**
 * Trend direction based on historical performance
 * @value IMPROVING - Task state has improved (e.g., Yellow → Green)
 * @value WORSENING - Task state has worsened (e.g., Green → Yellow)
 * @value STABLE - Task state has remained unchanged
 */
export type TrendDirection = 'IMPROVING' | 'WORSENING' | 'STABLE';

/**
 * Anomaly categories
 */
export type AnomalyCategory = 'resource_overload' | 'deadline_missed' | 'subtask_delay';

/**
 * Anomaly type for an incident detected
 */
export interface InsightAnomaly {
  /** Category of the anomaly */
  category: AnomalyCategory;
  /** Unique code for the anomaly type */
  code: string; // e.g., 'RES_OVERLOAD', 'DL_MISSED', 'SUBTASK_DELAY'
  /** Human-readable description */
  message: string;
  /** ISO 8601 timestamp of when the anomaly was detected */
  detectedAt: string;
}

/**
 * Supporting data points that provide context for insights
 */
export interface InsightSupportingData {
  /** Ingested (automated) vs Manual (user input) data type */
  type: 'Ingested' | 'Manual';
  /** Display label for the data point */
  label: string;
  /** The actual value (string or number, or null if not available) */
  value: string | number | null;
  /** Source system for ingested data (e.g., 'workforce_api', 'analytics_service') */
  source?: string;
  /** Aggregated data (counts, charts, etc.) */
  aggregates?: InsightAggregates;
}

/**
 * Aggregated data for supporting data points
 */
export interface InsightAggregates {
  /** Total count if applicable */
  count?: number;
  /** Last updated timestamp from source */
  lastUpdated?: string;
  /** Historical data for charts (e.g., 30 days of time spent) */
  chartData?: number[];
}

/**
 * Complete insights object for a task
 */
export interface TaskInsights {
  /** Current health state (AC1) */
  currentHealth: HealthState;
  /** Performance trend (AC2) */
  trend: TrendDirection;
  /** Detected anomalies (AC3) */
  anomalies: InsightAnomaly[];
  /** Supporting data with type, value, and context (AC4) */
  supportingData: InsightSupportingData[];
}

export const HealthState = {
  RED: 'RED',
  YELLOW: 'YELLOW',
  GREEN: 'GREEN',
} as const;

export const TrendDirection = {
  IMPROVING: 'IMPROVING',
  WORSENING: 'WORSENING',
  STABLE: 'STABLE',
} as const;

export const AnomalyType = {
  RESOURCE_OVERLOAD: {
    category: 'resource_overload' as const,
    code: 'RES_OVERLOAD',
    description: 'Assignee has exceeded 100% estimated capacity for next 5 working days',
  },
  DEADLINE_MISSED: {
    category: 'deadline_missed' as const,
    code: 'DL_MISSED',
    description: 'Task deadline has been missed',
  },
  SUBTASK_DELAY: {
    category: 'subtask_delay' as const,
    code: 'SUBTASK_DELAY',
    description: 'Subtasks are falling behind schedule',
  },
} as const;

/**
 * Trend color mappings for the UI
 */
export const TrendColor = {
  IMPROVING: 'green',
  WORSENING: 'red',
  STABLE: 'gray',
} as const;

/**
 * Health color mappings for the UI
 */
export const HealthColor = {
  RED: 'red',
  YELLOW: 'yellow',
  GREEN: 'green',
} as const;