import { apiRequest, apiRequestStream } from './apiClient';
import { downloadBlob, filenameFromResponse } from './download';

/**
 * The tax client — `/api/tax`.
 *
 * Mirrors the server port exactly: `profile` is self-service (a payee reads and
 * submits their own W-9/W-8), `report`/`years` are manager+ (mirrors
 * `requireRole(MANAGER)` on the server, surfaced client-side via the
 * `tax.viewReport` capability). The submitted tax id is WRITE-ONLY — nothing in
 * this client, and nothing the API returns, ever carries more than the last four.
 */

export type RecipientType = 'individual' | 'business' | 'unknown';
export type TaxFormType = '1099-NEC' | '1042-S';

export interface TaxProfile {
  userId: string;
  entityType: string | null;
  legalName: string | null;
  businessName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  addressCity: string | null;
  addressRegion: string | null;
  addressPostalCode: string | null;
  addressCountry: string | null;
  taxResidencyCountry: string | null;
  taxIdType: string | null;
  taxIdLast4: string | null;
  formSubmittedAt: string | null;
  recipientType: RecipientType;
  formType: TaxFormType;
  hasTaxId: boolean;
  complete: boolean;
}

export interface TaxProfileInput {
  entityType?: string;
  legalName?: string;
  businessName?: string;
  addressLine1?: string;
  addressLine2?: string;
  addressCity?: string;
  addressRegion?: string;
  addressPostalCode?: string;
  addressCountry?: string;
  taxResidencyCountry?: string;
  taxIdType?: string;
  /** Sent once, never echoed back. Omit to leave a previously sealed id as-is. */
  taxId?: string;
}

export interface TaxProfileOptions {
  entityTypes: string[];
  taxIdTypes: readonly string[];
}

export interface TaxYearReportRow {
  userId: string;
  recipientType: RecipientType;
  legalName: string | null;
  businessName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  addressCity: string | null;
  addressRegion: string | null;
  addressPostalCode: string | null;
  addressCountry: string | null;
  taxIdLast4: string | null;
  taxIdType: string | null;
  taxResidencyCountry: string | null;
  formType: TaxFormType;
  totalPaidCents: number;
  totalPaidUsd: number;
  payoutCount: number;
  reportable: boolean;
  thresholdReason: string;
  profileComplete: boolean;
}

export interface TaxYearReport {
  year: number;
  periodStart: string;
  periodEnd: string;
  totalRecipients: number;
  reportableRecipients: number;
  reportableCents: number;
  blockedRecipients: number;
  rows: TaxYearReportRow[];
}

export const taxApi = {
  options: () => apiRequest<TaxProfileOptions>('/api/tax/options'),
  profile: () => apiRequest<TaxProfile>('/api/tax/profile'),
  saveProfile: (input: TaxProfileInput) =>
    apiRequest<TaxProfile>('/api/tax/profile', { method: 'PUT', body: JSON.stringify(input) }),
  years: () => apiRequest<{ years: number[] }>('/api/tax/years'),
  report: (year: number) => apiRequest<TaxYearReport>(`/api/tax/report/${year}`),
  /** Stream the filer-ready CSV and trigger a browser download. `onlyFilings`
   *  (default) omits recipients under the threshold; false is the reconciliation
   *  view with an audit reason on every row. Auth header is sent manually via
   *  `apiRequestStream` — a CSV response is not the JSON `apiRequest` path. */
  async downloadReportCsv(year: number, onlyFilings = true): Promise<void> {
    const q = onlyFilings ? '' : '?all=true';
    const res = await apiRequestStream(`/api/tax/report/${year}/csv${q}`);
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    const blob = await res.blob();
    downloadBlob(blob, filenameFromResponse(res, `tax-${year}.csv`));
  },
};
