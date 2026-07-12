/**
 * Health Snapshot Types
 * Describes the data captured and compared via the health-snapshots plugin.
 */

/**
 * Overall health status for a snapshot
 */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

/**
 * Snapshot source identifier
 */
export type SnapshotSource = 'scheduled' | 'manual' | 'deployment-hook';

/**
 * Individual component health in a snapshot
 */
export interface ComponentHealth {
  /** Component identifier (e.g. channel name, service name) */
  component: string;
  /** Status of this specific component */
  status: 'healthy' | 'degraded' | 'unhealthy';
  /** Error rate as percentage (0-100) */
  errorRatePercent: number;
  /** Response latency in milliseconds (p50) */
  latencyMs: number;
}

/**
 * Resource utilization metrics
 */
export interface ResourceUsage {
  /** CPU usage percentage */
  cpuPercent?: number;
  /** Memory usage percentage */
  memoryPercent?: number;
  /** Disk usage percentage */
  diskPercent?: number;
}

/**
 * Snapshot payload - point-in-time health state
 */
export interface HealthSnapshot {
  /** Unique stable identifier */
  id: string;
  /** ISO 8601 timestamp in UTC */
  timestamp: string;
  /** Overall health status derived from component states */
  status: HealthStatus;
  /** Per-component health details */
  components: ComponentHealth[];
  /** Resource utilization across the system */
  resourceUsage?: ResourceUsage;
  /** Active incident/alert count at capture time */
  activeIncidentCount: number;
  /** Software version/build identifier */
  version?: string;
  /** Snapshot source type */
  source: SnapshotSource;
  /** Optional: deployment ID if source is deployment-hook */
  deploymentId?: string;
  /** Optional: commit SHA if source is deployment-hook */
  commitSha?: string;
}

/**
 * Differential comparison between two snapshots
 */
export interface SnapshotComparison {
  base: HealthSnapshot;
  target: HealthSnapshot;
  /** Diff of overall health status */
  healthStatusChange: { from: HealthStatus; to: HealthStatus };
  /** Per-component delta and status change */
  componentDeltas: Array<{
    component: string;
    from: ComponentHealth;
    to: ComponentHealth;
    errorRateDeltaPercent: number;
    latencyDeltaMs: number;
    statusChange: HealthStatus;
    added: boolean;
  }>;
  /** Configuration version diff */
  versionDiff?: { old: string | undefined; new: string | undefined };
  /** Summary of significant changes above threshold */
  significantChangesSummary: string;
}

/**
 * Filter options for snapshot listing
 */
export interface SnapshotListFilters {
  /** Minimum timestamp (inclusive) */
  start?: string;
  /** Maximum timestamp (exclusive) */
  end?: string;
  /** Source types to include */
  sources?: SnapshotSource[];
  /** Health status to include */
  status?: HealthStatus;
  /** Component name to filter on */
  component?: string;
  /** Number of results to return (pagination) */
  limit?: number;
}

/**
 * Response for snapshot list API
 */
export interface SnapshotListResponse {
  snapshots: HealthSnapshot[];
  totalCount: number;
  limit: number;
  hasMore: boolean;
}

/**
 * Configuration for the health-snapshots plugin
 */
export interface HealthSnapshotsConfig {
  /** Snapshot interval in milliseconds */
  scheduleIntervalMs?: number;
  /** Days to retain snapshots before archival/deletion */
  retentionDays?: number;
  /** Track per-component metrics */
  trackComponents?: boolean;
  /** Track resource utilization */
  trackResourceUsage?: boolean;
  /** Capture software version/build */
  trackVersion?: boolean;
  /** Alert count threshold for unhealthy status */
  incidentThreshold?: number;
}