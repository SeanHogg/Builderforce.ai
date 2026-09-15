/**
 * Typed client for the CFO's finance reads that are NOT the entity browser —
 * today the runway report (`GET /api/bi/runway`).
 *
 * Its own module rather than another block in `builderforceApi.ts`: that file is
 * the platform's largest, and the runway report is a destination's contract,
 * not a platform-wide one. The shapes mirror
 * `api/src/application/finance/runwayReport.ts`.
 */

import type { CashflowPoint, DeclaredFinance, RunwayVerdict } from '@builderforce/creation-canvas-contract';
import { apiRequest } from './apiClient';

export interface ObservedMonth {
  month: string;
  burn: number | null;
  revenue: number | null;
  cash: number | null;
  mrr: number | null;
}

export interface ObservedFinance {
  available: boolean;
  monthlyBurn: number | null;
  runwayMonths: number | null;
  cash: number | null;
  mrr: number | null;
  asOf: string | null;
  months: ObservedMonth[];
  cashflow: CashflowPoint[];
}

export interface DeclaredReport {
  companyId: number;
  companyName: string;
  finance: DeclaredFinance;
  runway: RunwayVerdict | null;
  projection: CashflowPoint[];
}

export interface RunwayReport {
  observed: ObservedFinance;
  declared: DeclaredReport | null;
  companies: Array<{ id: number; name: string; declaredAt: string | null }>;
}

export const financeApi = {
  runway: (companyId?: number | null): Promise<RunwayReport> =>
    apiRequest<RunwayReport>(`/api/bi/runway${companyId ? `?company=${companyId}` : ''}`),
};
