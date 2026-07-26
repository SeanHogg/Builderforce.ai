/**
 * Anonymous marketing-session API for the free Diagnostics & Tools suite.
 *
 * Deliberately SILENT (no global error toast) and best-effort: tracking a lead
 * must never interrupt the visitor's experience, so every call swallows failures.
 * `track` records a free run; `getSession` fetches a returning visitor's stored
 * diagnostics; `convert` (authenticated) links the session to a new account.
 */

import { AUTH_API_URL, getStoredTenantToken, getStoredWebToken } from './auth';
import { apiRequestStream } from './apiClient';
import { getExistingVisitorId, getVisitorId, getFirstTouch } from './visitor';
import type { ToolResult } from './tools';

export interface MarketingRun {
  toolId: string;
  name: string;
  result: ToolResult;
  updatedAt: string;
}

export interface MarketingSessionView {
  session: {
    visitorId: string;
    toolRuns: number;
    lastToolId: string | null;
    converted: boolean;
    firstSeenAt: string;
    lastSeenAt: string;
  } | null;
  runs: MarketingRun[];
}

/** Record one anonymous tool run (fire-and-forget; no-op when unidentifiable). */
export function trackToolRun(toolId: string, input: Record<string, number>, result: ToolResult): void {
  const visitorId = getVisitorId();
  if (!visitorId) return;
  const touch = getFirstTouch();
  void apiRequestStream('/api/marketing/track', {
    method: 'POST',
    auth: 'none',
    keepalive: true,
    // Ambient attribution — never a toast.
    expectedErrors: [400, 401, 403, 404, 429, 500, 502, 503],
    body: JSON.stringify({
      visitorId,
      toolId,
      input,
      result,
      touch: {
        landingPath: touch.landingPath,
        referrer: touch.referrer,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 512) : '',
        utm: touch.utm,
      },
    }),
  }).catch(() => { /* best-effort */ });
}

/** A returning visitor's stored diagnostics + session. Null on any failure. */
export async function getMarketingSession(): Promise<MarketingSessionView | null> {
  const visitorId = getVisitorId();
  if (!visitorId) return null;
  try {
    const res = await apiRequestStream(`/api/marketing/session/${encodeURIComponent(visitorId)}`, {
      auth: 'none',
      // Attribution lookup is ambient — a miss is normal, never a toast.
      expectedErrors: [400, 401, 403, 404, 429, 500],
    });
    if (!res.ok) return null;
    return (await res.json()) as MarketingSessionView;
  } catch {
    return null;
  }
}

/** Link the anonymous session to the authenticated user (attribution close-out). */
export function convertVisitor(): void {
  // Conversion must not mint an anonymous identity for someone who arrived
  // already authenticated; only close a real pre-auth visitor session.
  const visitorId = getExistingVisitorId();
  const token = getStoredTenantToken() ?? getStoredWebToken();
  if (!visitorId || !token) return;
  void apiRequestStream('/api/marketing/convert', {
    method: 'POST',
    // Either credential closes the session; the tenant token is preferred when
    // present, which is what the transport's 'tenant' mode already does — but a
    // web-only user must still convert, so pass the resolved token explicitly.
    auth: 'none',
    headers: { Authorization: `Bearer ${token}` },
    keepalive: true,
    body: JSON.stringify({ visitorId }),
    expectedErrors: [400, 401, 403, 404, 429, 500, 502, 503],
  }).catch(() => { /* best-effort */ });
}
