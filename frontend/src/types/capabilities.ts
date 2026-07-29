/**
 * Capability types — the shape of `GET /api/projects/:id/capabilities` and
 * `GET /api/capabilities/rollup`.
 *
 * This is the SINGLE source of truth for capability shapes on the frontend; the
 * dashboard, the row renderer and the API wrapper all import from here so the
 * status union can never drift between surfaces.
 */

/** Delivery state of a capability. Mirrors the backend enum. */
export type CapabilityStatus = 'shipped' | 'in_progress' | 'planned';

/** Every status, in the order the UI presents them (shipped → planned). */
export const CAPABILITY_STATUSES: readonly CapabilityStatus[] = [
  'shipped',
  'in_progress',
  'planned',
] as const;

export interface Capability {
  id: string;
  name: string;
  status: CapabilityStatus;
  /** Grouping bucket, e.g. "UX", "Performance", "Security". May be absent. */
  category?: string | null;
  /** 0–100. Absent when the backend has no score for this capability. */
  healthScore?: number | null;
  /** ISO-8601 timestamp of the last change. */
  lastUpdated?: string | null;
  /** Optional deep link to a capability detail surface. */
  href?: string | null;
}

/** Counts keyed by status. Always contains every status (zero-filled). */
export type CapabilityStatusBreakdown = Record<CapabilityStatus, number>;

export interface CapabilityRollup {
  /** Aggregate project health, 0–100. */
  healthScore: number;
  statusBreakdown: CapabilityStatusBreakdown;
  /** Capability count per category name. */
  categoryBreakdown: Record<string, number>;
  /** Total capabilities counted in the rollup. */
  total: number;
}

/** Table sort keys (the sortable columns). */
export type CapabilitySortKey = 'name' | 'status' | 'category' | 'healthScore' | 'lastUpdated';

export type SortDirection = 'asc' | 'desc';

export interface CapabilityFilters {
  /** 'all' means unfiltered. */
  status: CapabilityStatus | 'all';
  /** 'all' means unfiltered. */
  category: string | 'all';
  /** Inclusive health-score bounds, 0–100. */
  healthMin: number;
  healthMax: number;
}

export const DEFAULT_CAPABILITY_FILTERS: CapabilityFilters = {
  status: 'all',
  category: 'all',
  healthMin: 0,
  healthMax: 100,
};
