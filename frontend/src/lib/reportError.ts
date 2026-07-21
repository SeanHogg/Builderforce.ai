import { apiRequest } from './apiClient';

/** Fields to pre-fill the reporter when opened from an existing error. */
export interface ReportErrorPrefill {
  title?: string;
  message?: string;
  url?: string;
  projectId?: number;
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
  projectId: number;
  message: string;
  title?: string;
  url?: string;
  level?: 'fatal' | 'error' | 'warning' | 'info';
}

/**
 * File a user-reported error into a project's Quality feed. Routes through the
 * same ingest engine as every automated source, so a manual report shows up in
 * /quality alongside SDK/webhook errors (grouped by title). Returns the ingest
 * result ({ ok, accepted, ... }).
 */
export async function reportProjectError(input: ReportErrorInput): Promise<{ ok: boolean; accepted: number }> {
  return apiRequest('/api/quality/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    // A full monthly cap (429) is surfaced by the modal, not the global toast.
    expectedErrors: [429],
  });
}
