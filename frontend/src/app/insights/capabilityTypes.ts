/**
 * Capability types and enums used by the Capabilities Dashboard.
 */

// Capability status enum (in sync with backend status field values)
export enum CapabilityStatus {
  /** Already delivered and running */
  shipped = 'shipped',
  /** Currently being developed */
  in_progress = 'in_progress',
  /** Planned but not yet started */
  planned = 'planned',
}

// Capability entity
export interface Capability {
  /** Stable capability identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Current status */
  status: CapabilityStatus;
  /** Category, e.g., 'UX', 'Performance', 'Security' */
  category: string;
  /** Health score (0–100) if applicable */
  healthScore: number;
  /** Last update timestamp in ISO 8601 */
  lastUpdated: string;
}

// Aggregated rollup data used for charts and gauge
export interface CapabilityRollup {
  /** Overall health score (0–100) */
  healthScore: number;
  /** Count of capabilities per status for the Status Breakdown chart */
  statusBreakdown: {
    shipped: number;
    in_progress: number;
    planned: number;
  };
  /** Count of capabilities per category for the Category Breakdown chart */
  categoryBreakdown: Record<string, number>;
}

// Helper conversion utilities
export const CapabilityStatusLabels: Record<CapabilityStatus, string> = {
  [CapabilityStatus.shipped]: 'Shipped',
  [CapabilityStatus.in_progress]: 'In Progress',
  [CapabilityStatus.planned]: 'Planned',
};

export const CapabilityStatusColors: Record<CapabilityStatus, string> = {
  [CapabilityStatus.shipped]: '#22c55e',
  [CapabilityStatus.in_progress]: '#f59e0b',
  [CapabilityStatus.planned]: '#ef4444',
};

/** Ported from capabilityTypes.ts for compatibility — to be removed once all files use.
 * Sticky until we re-export the source in capabilitiesApi.ts.
 * Along with Capability and CapabilityRollup interfaces.
 */
export type { Capability, CapabilityRollup };

export type { CapabilityStatus };