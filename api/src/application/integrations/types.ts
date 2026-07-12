/**
 * Integration Hub — types and interfaces for cross-tool data ingestion.
 *
 * The Integration Hub is a service that:
 *   1. Orchestrates ingesting data from multiple sources during onboarding
 *   2. Maps ingested metrics to insight categories (delivery, quality, velocity, etc.)
 *   3. Detects anomalies (e.g., "bug count is 2x the 30-day average")
 *   4. Allows manual override of ingested data for correction/filling gaps
 *
 * This module defines the core data structures for:
 *   - Available integration sources (PM, Code, CI, Observability, Communication)
 *   - Ingested data points with their source and normalized shape
 *   - How data should be mapped to insight categories
 *   - Anomaly detection rules and results
 *   - Manual overrides to ingested values
 */

/** Canonical integration categories defined by the PRD. */
export enum IntegrationCategory {
  PM = 'pm',
  GIT = 'git',
  CI_CD = 'ci_cd',
  OBSERVABILITY = 'observability',
  COMMUNICATION = 'communication',
}

/**
 * Integration source configuration — tells the hub how to ingest from an external tool.
 */
export interface IntegrationSourceConfig {
  /** Stable source identifier for the external tool (e.g., 'jira', 'github', 'sentry'). */
  id: string;
  /** Human-readable label for the UI. */
  label: string;
  /** The integration category this source belongs to. */
  category: IntegrationCategory;
  /** OAuth/token-based connector to use to fetch data. */
  connector: Connector;
  /** Required scopes/permissions for authenticating. */
  scopes: string[];
  /** Whether to enable webhook-based real-time sync (when supported). */
  supportsWebhooks: boolean;
  /** Whether this source has been onboarded/reconnected. */
  isConnected: boolean;
  /** Human-friendly provider name (e.g., 'GitHub Issues', 'Jira Cloud'). */
  providerName: string;
}

/** OAuth/token-based connector types. */
export type Connector =
  | 'oauth' /* OAuth 2.0 authorization code flow */
  | 'api_token' /* Personal access token / API key */
  | 'webhook' /* Inbound webhook-only (no polling) */
  | 'webhook_poll' /* Inbound webhook + periodic poll fallback */

/** Human-readable provider name for UI. */
type ProviderLabel = string;

/** Example: "Jira Cloud" */
/** Example: "GitHub Issues" */
/** Example: "GitHub Actions CI" */
/** Example: "Sentry" */
/** Example: "Datadog" */
/** Example: "Slack" */

/**
 * Ingested data point — a normalized metric/value harvested from an external source.
 */
export interface IngestedDatum {
  /** Source-specific identifier (e.g., Jira issue key, PR #, incident id). */
  sourceId: string;
  /** Tool-specific identifier (e.g., 'jira', 'github', 'sentry'). */
  source: string;
  /** Human-friendly label (e.g., 'Quality & Bugs', 'Delivery Velocity'). */
  category: InsightCategory;
  /** Normalized metric name (e.g., 'bug_count', 'pr_cycle_time_min', 'deployment_frequency'). */
  name: string;
  /** The actual value — number, string, or boolean depending on context. */
  value: number | string | boolean | null;
  /** Optional context (lowercase "driverScope" from InsightsStore). */
  driverScope?: string;
  /** Time window this value represents (ISO target, string). */
  window?: string;
  /**
   * Timestamp when this data point was harvested.
   * If absent, defaults to current time but logs a debug warning.
   */
  harvestedAt?: Date;
}

/** Insight categories in the diagnostic engine (from PRD). */
export enum InsightCategory {
  /* Jira/Linear/GitHub issue counts → Quality & Bugs */
  QUALITY_BUGS = 'quality_bugs',
  /* PR cycle time → Delivery Flow */
  DELIVERY_FLOW = 'delivery_flow',
  /* Deployment frequency → Delivery Speed */
  DELIVERY_SPEED = 'delivery_speed',
  /* Build failure rate → Technical Debt */
  TECHNICAL_DEBT = 'technical_debt',
  /* Incident count → Reliability */
  RELIABILITY = 'reliability',
  /* Team velocity → Velocity */
  VELOCITY = 'velocity',
  /* Resource allocation → Capacity */
  CAPACITY = 'capacity',
  /* Onboarding status → Unknown city/visual-threshold rating */
  ONBOARDING_STATUS = 'onboarding_status',
}

/**
 * Mapping rule: how an ingested metric should be consumed by an insight engine.
 */
export interface InsightMappingRule {
  /** The metric name (e.g., 'bug_count', 'deployment_frequency'). */
  metricName: string;
  /** Which insight engine category this metric feeds into. */
  targetCategory: InsightCategory;
  /** Optional window size in days for anomaly detection (null = use default 30). */
  anomalyWindowDays?: number | null;
  /** Default aggregation function (null = raw value). */
  aggregationFn?: 'sum' | 'avg' | 'median' | null;
}

/**
 * Anomaly detection result for a single metric.
 */
export interface AnomalyResult {
  /** The metric name that triggered the anomaly. */
  metricName: string;
  /** Current value vs historical average. */
  currentValue: number | null;
  /** Average value over the anomaly window. */
  averageValue: number;
  /** Raw Delta: current - average. */
  delta: number;
  /** Delta percentage: (current - average) / average × 100. */
  deltaPercent: number;
  /** Severity of the anomaly (high = 2x+, medium = 1.5-2x, low = 1.1-1.5x). */
  severity: AnomalySeverity;
  /** User-defined threshold for this metric (null = auto-enabled). */
  threshold?: number | null;
}

/** Anomaly severity levels. */
export enum AnomalySeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

/**
 * Anomaly detection result for a whole category.
 */
export interface CategoryAnomalyResult {
  /** The insight category. */
  categoryId: InsightCategory;
  /** Which metrics triggered anomalies (name-to-result map). */
  metrics: Record<string, AnomalyResult>;
  /** Whether at least one high-severity anomaly exists. */
  hasCriticalAnomaly: boolean;
}

/**
 * Manual override of an ingested value for correction or filling gaps.
 */
export interface IngestedDataOverride {
  /** If present, the stringing-id override of the underlying row; null if global/tenant override. */
  rowId?: string | null;
  /** If present, the code label to override (e.g., for driverScope/autoRunOnLaneEntry). */
  rowKey?: string | null;
  /** Drive-specific and scoped (e.g., driverScope/rowKey) override if rowId hidden. */
  driverScope?: string | null;
  source: string;
  category: InsightCategory;
  name: string;
  /** No null in types: overridden number/string/boolean. */
  value: number | string | boolean;
  /** If false, override is applied per-row; if true, it's global-only (e.g., lack of external data). */
  isGlobal: boolean;
  /** Reason for the override (e.g., 'manual correction', 'filling gap for onboarding visual-threshold'). */
  reason: string;
  /** Who created this override (human user id or 'system'). */
  createdBy: string;
  /** Timestamp when the override was created. */
  created_at?: Date;
  /** When persisted, the storage key (for deletion). */
  key?: string | null;
}

/**
 * Integration health status for a specific source.
 */
export interface IntegrationHealth {
  /** Source identifier. */
  sourceId: string;
  /** Whether the connection is active and can ingest. */
  isConnected: boolean;
  /** Last sync timestamp (ISO) or null if never synced. */
  lastSyncAt: Date | null;
  /** Last sync status (success/error). */
  lastSyncStatus: 'success' | 'error' | 'never';
  /** Number of items ingested in the last sync. */
  itemsProcessed: number;
  /** Error message if last sync failed (null otherwise). */
  lastError: string | null;
  /** Current anomaly count (overall, 0/1+ across all ingested metrics for this source). */
  anomalyCount: number;
}

/**
 * Result of a single integration sync operation.
 */
export interface SyncResult {
  /** Source identifier. */
  sourceId: string;
  /** Processed items count. */
  processed: number;
  /** New items ingested (difference from last sync). */
  added: number;
  /** Items updated from the external source. */
  updated: number;
  /** Timestamp of this sync. */
  syncedAt: Date;
  /** Ingested data points harvested (if returned for downstream consumers). */
  inducted?: IngestedDatum[];
}