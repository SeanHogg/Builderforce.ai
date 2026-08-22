/**
 * A request that never produced a response.
 *
 * `fetch` rejects — with an opaque `TypeError` carrying no status, no headers and
 * no body — for a set of causes the browser deliberately refuses to distinguish:
 * the device is offline, the connection dropped, a proxy or extension blocked it,
 * the edge returned a page with no `Access-Control-Allow-Origin` header (a
 * Cloudflare 1101/1102 error page or a bot/WAF challenge), or the origin really is
 * outside the allow-list. The devtools console prints the CORS wording for most of
 * these, which is why "CORS error for everyone" is the report that arrives, and why
 * chasing the CORS configuration never finds anything.
 *
 * Before this module the API client did not catch that rejection AT ALL. Every
 * transport failure escaped as an unhandled promise rejection: no toast, no
 * message a person could act on, and — the part that mattered — no record. The
 * incident of 2026-07-09 could not be diagnosed afterwards because the only place
 * the evidence existed was the browser that saw it, and nothing collected it. The
 * server-side trail is empty BY CONSTRUCTION for this failure: the request never
 * reached the worker.
 *
 * So this does two things, and no more: it names the failure honestly (never
 * "CORS", which we cannot know and usually is not true), and it puts one record
 * per outage onto the existing API-error bus, where `QualityErrorReporter` already
 * files it into the product Quality feed.
 */
import { dispatchApiError } from './apiErrorEvent';

/** No response means no status. Zero is the browser's own convention for it. */
export const TRANSPORT_FAILURE_STATUS = 0;

/**
 * What we can actually tell apart. Deliberately coarse — claiming more precision
 * than the browser gives us is how this failure got mis-diagnosed the first time.
 */
export type TransportFailureReason = 'offline' | 'aborted' | 'unreachable';

/** A request that never reached a server, or whose response could not be read. */
export class ApiTransportError extends Error {
  readonly status = TRANSPORT_FAILURE_STATUS;
  constructor(
    readonly reason: TransportFailureReason,
    readonly url: string,
    readonly method: string,
    readonly cause?: unknown,
  ) {
    super(describeTransportFailure(reason));
    this.name = 'ApiTransportError';
  }
}

/**
 * `navigator.onLine` is the ONE extra signal the platform gives us, and it is only
 * trustworthy in the negative: false genuinely means no network, true means very
 * little. An abort is ours (a cancelled request, a navigation), never an incident.
 */
export function classifyTransportFailure(error: unknown): TransportFailureReason {
  if (error instanceof DOMException && error.name === 'AbortError') return 'aborted';
  if (typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError') return 'aborted';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  return 'unreachable';
}

/**
 * The non-localized diagnostic text. This is what lands in the Quality feed and in
 * a copied support ticket, so it names the real candidates instead of the CORS
 * wording the console prints. The string a PERSON reads is localized separately by
 * the toast, keyed off {@link ApiTransportError.reason}.
 */
export function describeTransportFailure(reason: TransportFailureReason): string {
  switch (reason) {
    case 'offline':
      return 'The device is offline — the request never left the browser.';
    case 'aborted':
      return 'The request was cancelled before a response arrived.';
    case 'unreachable':
      return 'The API returned no response at all. The request either never reached the worker or the edge answered with a page carrying no CORS headers (a Cloudflare 1101/1102 error page, or a bot/WAF challenge). This is NOT a worker CORS-configuration fault.';
  }
}

/**
 * One record per outage, not one per request.
 *
 * When the API goes down every in-flight call on the page fails within the same
 * second — a dashboard can have twenty. Reporting each one would open twenty
 * toasts and fire twenty ingest POSTs which, the API being down, would themselves
 * fail. The first failure of a given reason reports; the rest inside the window
 * are counted and dropped, because the twentieth adds nothing the first did not
 * already say.
 */
const REPORT_WINDOW_MS = 10_000;
const lastReportedAt = new Map<TransportFailureReason, number>();

/** Test seam — clears the collapse window so one case cannot silence the next. */
export function resetTransportFailureWindow(): void {
  lastReportedAt.clear();
}

export interface TransportFailureReport {
  url: string;
  method: string;
  error: unknown;
  /** Suppress the user-facing surface for callers that render the failure themselves. */
  silent?: boolean;
}

/**
 * Turn an opaque fetch rejection into a typed error, and (unless it is ours, or a
 * duplicate of one already reported) put it on the API-error bus.
 */
export function reportTransportFailure({ url, method, error, silent }: TransportFailureReport): ApiTransportError {
  const reason = classifyTransportFailure(error);
  const failure = new ApiTransportError(reason, url, method, error);

  // An abort is a cancellation we asked for. It is not an incident and must never
  // reach a toast, or every navigation away from a loading page files a report.
  if (reason === 'aborted' || silent) return failure;

  // The bus is a DOM CustomEvent. On the server there is nobody listening and no
  // window to dispatch on, so a server-rendered caller gets the typed error only.
  if (typeof window === 'undefined') return failure;

  const now = Date.now();
  const previous = lastReportedAt.get(reason);
  if (previous !== undefined && now - previous < REPORT_WINDOW_MS) return failure;
  lastReportedAt.set(reason, now);

  dispatchApiError({
    method: method.toUpperCase(),
    url,
    status: TRANSPORT_FAILURE_STATUS,
    code: reason,
    message: describeTransportFailure(reason),
  });
  return failure;
}

/**
 * `fetch`, with the one outcome nobody remembers to handle already handled.
 *
 * Every browser-side caller that talks to the API goes through this: the shared
 * transport in `apiClient`, and the auth/passkey calls that cannot import it
 * (`apiClient` imports `auth`, so the dependency only runs one way). Those auth
 * calls are the LOGIN path — the surface the 2026-07-09 outage was reported on —
 * and each of their two dozen raw `fetch` calls let the rejection escape.
 */
export async function fetchWithTransportReport(
  url: string,
  init?: RequestInit,
  opts?: { silent?: boolean },
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    throw reportTransportFailure({
      url,
      method: init?.method ?? 'GET',
      error,
      ...(opts?.silent === undefined ? {} : { silent: opts.silent }),
    });
  }
}
