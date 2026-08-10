import { apiRequest } from './apiClient';

/** Fields to pre-fill the reporter when opened from an existing error. */
export interface ReportErrorPrefill {
  title?: string;
  message?: string;
  url?: string;
}

/** Global bus so a root-level surface (the API-error toast) can open the shared
 *  reporter panel, which lives lower in the tree inside the project scope. */
export const REPORT_ERROR_EVENT = 'bf:report-error';

/** Request the app-wide Report-error panel to open (optionally pre-filled). */
export function requestReportError(prefill?: ReportErrorPrefill): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ReportErrorPrefill>(REPORT_ERROR_EVENT, { detail: prefill ?? {} }));
}

export interface ReportErrorInput {
  message: string;
  title?: string;
  url?: string;
  level?: 'fatal' | 'error' | 'warning' | 'info';
}

/**
 * File a user-reported error into BuilderForce.ai's product Quality feed. The
 * collector key fixes the destination, so reporting never depends on the
 * visitor having an account or choosing one of their own projects.
 */
export async function reportProductError(
  input: ReportErrorInput,
  endpoint: string,
): Promise<{ accepted: number }> {
  return sendProductError({ ...input, source: 'manual' }, endpoint);
}

/** Automatically persist a global API failure to the same product project. */
export async function reportProductApiError(
  input: ReportErrorInput & { context?: Record<string, unknown> },
  endpoint: string,
): Promise<{ accepted: number }> {
  return sendProductError({ ...input, source: 'api-client' }, endpoint);
}

async function sendProductError(
  input: ReportErrorInput & { source: 'manual' | 'api-client'; context?: Record<string, unknown> },
  endpoint: string,
): Promise<{ accepted: number }> {
  const result = await apiRequest<{ accepted?: number }>('/product-report', {
    method: 'POST',
    auth: 'none',
    baseUrl: endpoint.replace(/\/$/, ''),
    body: JSON.stringify(input),
    // The panel renders ingest failures itself; do not create another global
    // API-error toast (and another automatic product report) for this request.
    expectedErrors: PRODUCT_REPORT_ERROR_STATUSES,
  });

  if (result.accepted !== 1) throw new Error('Could not record the report');
  return { accepted: result.accepted };
}

/** Prevent a failed reporting request from recursively reporting itself. */
export const PRODUCT_REPORT_ERROR_STATUSES = Array.from({ length: 200 }, (_, index) => 400 + index);
