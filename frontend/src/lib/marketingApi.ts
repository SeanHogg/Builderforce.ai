/**
 * Anonymous marketing-session API for the free Diagnostics & Tools suite.
 *
 * Deliberately SILENT (no global error toast) and best-effort: tracking a lead
 * must never interrupt the visitor's experience, so every call swallows failures.
 * `track` records a free run; `getSession` fetches a returning visitor's stored
 * diagnostics; `convert` (authenticated) links the session to a new account.
 */

import { AUTH_API_URL, getStoredTenantToken, getStoredWebToken } from './auth';
import { getVisitorId, getFirstTouch } from './visitor';
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
  void fetch(`${AUTH_API_URL}/api/marketing/track`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
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
    const res = await fetch(`${AUTH_API_URL}/api/marketing/session/${encodeURIComponent(visitorId)}`);
    if (!res.ok) return null;
    return (await res.json()) as MarketingSessionView;
  } catch {
    return null;
  }
}

/** Link the anonymous session to the authenticated user (attribution close-out). */
export function convertVisitor(): void {
  const visitorId = getVisitorId();
  const token = getStoredTenantToken() ?? getStoredWebToken();
  if (!visitorId || !token) return;
  void fetch(`${AUTH_API_URL}/api/marketing/convert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    keepalive: true,
    body: JSON.stringify({ visitorId }),
  }).catch(() => { /* best-effort */ });
}
