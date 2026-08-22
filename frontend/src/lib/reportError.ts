import { apiRequest } from './apiClient';
import { TRANSPORT_FAILURE_STATUS } from './errors/transportFailure';

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

/**
 * A report must survive a bad `message` rather than be rejected for one.
 *
 * A caller in a crash path is exactly where a non-string slips past the type:
 * the gateway's nested 429 envelope (`{ error: { message, code, type, details } }`)
 * did precisely that, and the ingest answered `400 {"error":"message is
 * required"}` — so the one request whose entire job is to preserve the
 * diagnostic threw it away, silently, at the moment it mattered most.
 * `apiClient` no longer produces an object message; this is the floor
 * underneath it, for every caller and every future envelope shape.
 */
function reportMessage(message: unknown): string {
  if (typeof message === 'string' && message.trim()) return message;
  if (message instanceof Error && message.message) return message.message;
  // An object here is a bug upstream, but a readable report beats a lost one.
  if (message !== null && message !== undefined) {
    try {
      const serialized = JSON.stringify(message);
      if (serialized && serialized !== '{}') return serialized;
    } catch {
      /* circular — fall through to the constant below */
    }
  }
  return 'Unknown error (no message supplied)';
}

async function sendProductError(
  input: ReportErrorInput & { source: 'manual' | 'api-client'; context?: Record<string, unknown> },
  endpoint: string,
): Promise<{ accepted: number }> {
  const result = await apiRequest<{ accepted?: number }>('/product-report', {
    method: 'POST',
    auth: 'none',
    baseUrl: endpoint.replace(/\/$/, ''),
    body: JSON.stringify({ ...input, message: reportMessage(input.message) }),
    // The panel renders ingest failures itself; do not create another global
    // API-error toast (and another automatic product report) for this request.
    expectedErrors: PRODUCT_REPORT_ERROR_STATUSES,
  });

  if (result.accepted !== 1) throw new Error('Could not record the report');
  return { accepted: result.accepted };
}

/**
 * Prevent a failed reporting request from recursively reporting itself.
 *
 * Includes {@link TRANSPORT_FAILURE_STATUS} (0), which is the status a request
 * that never reached a server reports under. That is the case this list exists
 * for most of all: when the API is unreachable, EVERY call on the page fails,
 * including this one — so without 0 here the reporter's own failure would raise
 * another report, which would fail, forever.
 */
export const PRODUCT_REPORT_ERROR_STATUSES = [
  TRANSPORT_FAILURE_STATUS,
  ...Array.from({ length: 200 }, (_, index) => 400 + index),
];
