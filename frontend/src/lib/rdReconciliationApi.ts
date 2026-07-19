import { apiRequest } from './apiClient';

/** R&D reconciliation client (derived QRE vs reported quarterly facts). */

export type ReconFlag = 'aligned' | 'derived_higher' | 'reported_higher' | 'no_reported';

export interface RdReconciliation {
  fiscalYear: number;
  windowDays: number;
  derived: {
    qualifiedHours: number;
    blendedRate: number;
    laborUsd: number;
    aiSpendUsd: number;
    baseUsd: number;
  };
  reported: {
    actualUsd: number;
    planUsd: number;
    revenueUsd: number | null;
    rdToRevenuePct: number | null;
  };
  variance: { absUsd: number; pct: number | null; flag: ReconFlag };
  quarters: Array<{
    quarter: number;
    totalActualUsd: number;
    totalPlanUsd: number;
    revenueUsd: number | null;
    rdToRevenuePct: number | null;
  }>;
}

export const rdReconciliationApi = {
  get: (fy?: number): Promise<RdReconciliation> =>
    apiRequest<RdReconciliation>(`/api/finops/rd-reconciliation${fy != null ? `?fy=${fy}` : ''}`),
};
