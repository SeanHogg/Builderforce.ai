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
  config: { apiKey: string; endpoint: string },
): Promise<{ accepted: number }> {
  if (!config.apiKey) throw new Error('Product error reporting is not configured');

  const title = input.title?.trim();
  const message = input.message.trim();
  const result = await apiRequest<{ accepted?: number }>('/events', {
    method: 'POST',
    auth: 'none',
    baseUrl: config.endpoint.replace(/\/$/, ''),
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([{
      type: 'UserReportedError',
      message: title ? `${title} — ${message}` : message,
      level: input.level ?? 'error',
      timestamp: new Date().toISOString(),
      environment: 'user-report',
      source: 'native',
      ...(input.url ? { url: input.url } : {}),
      tags: { reporter: 'product-ui' },
      context: { manual: true },
    }]),
    // The panel renders ingest failures itself; do not create another global
    // API-error toast (and another automatic product report) for this request.
    expectedErrors: [400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504],
  });

  if (result.accepted !== 1) throw new Error('Could not record the report');
  return { accepted: result.accepted };
}
import { apiRequest } from './apiClient';
