/**
 * Types for capabilities dashboard data.
 * These types describe the response from /api/projects/:id/capabilities and /api/capabilities/rollup APIs.
 */

export type CapabilityStatus = 'shipped' | 'in_progress' | 'planned';

export interface Capability {
  id: string;
  name: string;
  status: CapabilityStatus;
  category: string;
  healthScore: number;
  lastUpdated: string;
  categoryDisplay?: string;
}

export interface CapabilityRollup {
  healthScore: number;
  statusBreakdown: {
    shipped: number;
    in_progress: number;
    planned: number;
  };
  categoryBreakdown: Record<string, number>;
}

export interface CapabilitiesTableFilter {
  status?: CapabilityStatus;
  category?: string;
  healthMinScore?: number;
  healthMaxScore?: number;
}