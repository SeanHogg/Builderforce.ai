/**
 * DevFinOps API client — R&D Tax Credits, SOC 1 Type II controls, and Audit-Ready
 * Reports. Talks to /api/finops on the auth API. Manager-gated server-side.
 */
import { apiRequest, getApiBaseUrl, getAuthHeaders } from './apiClient';
import { downloadBlob } from './download';

// ── R&D Tax Credits ──────────────────────────────────────────────────────────

export interface RdTaxCreditConfig {
  qualifiedCategories: string[];
  blendedLaborRateUsd: number;
  qualifiedActionTypes: string[];
}

export interface RdCategoryLine {
  category: string;
  label: string;
  hours: number;
  laborUsd: number;
  aiSpendUsd: number;
  qualified: boolean;
}

export interface RdTaxCreditReport {
  period: string;
  windowDays: number;
  qualifiedHours: number;
  blendedRate: number;
  qualifiedLaborUsd: number;
  qualifiedAiSpendUsd: number;
  qualifiedBaseUsd: number;
  qualifiedCategories: string[];
  byCategory: RdCategoryLine[];
}

export function getRdTaxConfig(): Promise<RdTaxCreditConfig> {
  return apiRequest<RdTaxCreditConfig>('/api/finops/rd-tax/config');
}

export function updateRdTaxConfig(patch: Partial<RdTaxCreditConfig>): Promise<RdTaxCreditConfig> {
  return apiRequest<RdTaxCreditConfig>('/api/finops/rd-tax/config', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export function getRdTaxReport(period?: string, days?: number): Promise<RdTaxCreditReport> {
  const q = new URLSearchParams();
  if (period) q.set('period', period);
  if (days) q.set('days', String(days));
  const qs = q.toString();
  return apiRequest<RdTaxCreditReport>(`/api/finops/rd-tax${qs ? `?${qs}` : ''}`);
}

// ── SOC 1 Type II controls ───────────────────────────────────────────────────

export type SocControlStatus = 'implemented' | 'partial' | 'gap';

export interface SocControl {
  id: number | null;
  controlRef: string;
  objective: string;
  category: string;
  status: SocControlStatus;
  owner: string | null;
  note: string;
  lastReviewed: string | null;
}

export interface ControlCoverage {
  total: number;
  implemented: number;
  partial: number;
  gap: number;
  coveragePct: number;
  seeded: boolean;
  controls: SocControl[];
}

export function getSocControls(): Promise<ControlCoverage> {
  return apiRequest<ControlCoverage>('/api/finops/soc/controls');
}

export interface NewSocControl {
  controlRef: string;
  objective: string;
  category?: string;
  status?: SocControlStatus;
  owner?: string | null;
  note?: string;
}

export function createSocControl(input: NewSocControl): Promise<ControlCoverage> {
  return apiRequest<ControlCoverage>('/api/finops/soc/controls', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export interface SocControlPatch {
  status?: SocControlStatus;
  owner?: string | null;
  note?: string;
  objective?: string;
  category?: string;
  /** `true` stamps now; an ISO string sets an explicit review date. */
  lastReviewed?: boolean | string;
}

export function updateSocControl(id: number, patch: SocControlPatch): Promise<ControlCoverage> {
  return apiRequest<ControlCoverage>(`/api/finops/soc/controls/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

// ── Audit-Ready Reports ──────────────────────────────────────────────────────

export interface AuditReport {
  generatedAt: string;
  period: string;
  windowDays: number;
  finance: {
    spendUsd: number;
    forecastUsd: number;
    paidOverflowUsd: number;
    costPerMergedPrUsd: number | null;
  };
  allocation: {
    hours: number;
    capexUsd: number;
    opexUsd: number;
    capitalizablePct: number;
  };
  rdTaxCredit: {
    qualifiedHours: number;
    blendedRate: number;
    qualifiedLaborUsd: number;
    qualifiedAiSpendUsd: number;
    qualifiedBaseUsd: number;
  };
  socControls: {
    total: number;
    implemented: number;
    partial: number;
    gap: number;
    coveragePct: number;
  };
  compliance: {
    windowDays: number;
    totalEvents: number;
    sensitiveEvents: number;
    distinctExecutions: number;
    distinctAgents: number;
  };
}

export function getAuditReport(period?: string): Promise<AuditReport> {
  return apiRequest<AuditReport>(`/api/finops/audit-report${period ? `?period=${encodeURIComponent(period)}` : ''}`);
}

/**
 * Download the assembled report as CSV or JSON. Streams the response to a Blob and
 * triggers a browser download (auth header is sent manually since this is not the
 * JSON apiRequest path).
 */
export async function downloadAuditReport(format: 'csv' | 'json', period?: string): Promise<void> {
  const q = new URLSearchParams({ format });
  if (period) q.set('period', period);
  const res = await fetch(`${getApiBaseUrl()}/api/finops/audit-report/export?${q.toString()}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  const blob = await res.blob();
  downloadBlob(blob, `audit-report-${period ?? 'current'}.${format}`);
}
