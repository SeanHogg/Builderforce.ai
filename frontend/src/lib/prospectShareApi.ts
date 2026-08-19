/**
 * THE client for the prospect share — both ends of it.
 *
 * ── WHY THE SELLER'S AND THE BUYER'S CALLS ARE ONE MODULE ───────────────────────
 * They are two halves of one contract, and the field names have to agree exactly: what a
 * seller mints (`allowControlRequest`, the branding) is what the buyer's page reads and
 * what the buyer's route enforces. Splitting them into `prospectShareApi` and
 * `dealApi` would be two files that must be edited together forever, which is the
 * definition of one module.
 *
 * The buyer's calls go through the SAME transport as everything else, with `auth: 'none'`.
 * The first version of this module used bare `fetch`, reasoning that a public page must not
 * send a workspace token — which is right about the credential and wrong about the
 * transport: `auth: 'none'` withholds the token and keeps the error dispatch, the locale
 * header and the one place a non-ok response is decoded. "Different credential" never means
 * "different transport", which is the argument `RequestOptions.baseUrl` already records for
 * a different ORIGIN.
 */

import { apiRequest } from '@/lib/apiClient';
import type { ProspectEngagement, QuoteCheckoutIntent } from '@builderforce/creation-canvas-contract';

// ---------------------------------------------------------------------------
// The seller's half — authenticated
// ---------------------------------------------------------------------------

export interface ProspectShareSettings {
  sellerName: string;
  sellerCompany: string;
  accentColor: string;
  allowControlRequest: boolean;
  message: string;
}

export interface ProspectShareRow {
  id: string;
  label: string;
  settings: ProspectShareSettings;
  target: 'board' | 'card';
  canvasObjectId: string | null;
  title: string;
  expiresAt: string | null;
  opens: number;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface MintedProspectShare {
  id: string;
  /** The plaintext credential, returned EXACTLY once — only its hash is stored, the same
   *  rule the résumé, signature and form tokens follow. A caller that drops it has to
   *  revoke and re-mint; there is no read path that can recover it. */
  token: string;
  viewPath: string;
  expiresAt: string | null;
}

export const listProspectShares = (sessionId: string) =>
  apiRequest<{ shares: ProspectShareRow[] }>(`/api/creation-sessions/${encodeURIComponent(sessionId)}/prospect-shares`)
    .then((r) => r.shares);

export interface MintProspectShareBody extends Partial<ProspectShareSettings> {
  /** A canvas object id for a card share; omitted for the whole board. */
  objectId?: string | null;
  label?: string;
  expiresAt?: string | null;
}

export const mintProspectShare = (sessionId: string, body: MintProspectShareBody) =>
  apiRequest<MintedProspectShare>(`/api/creation-sessions/${encodeURIComponent(sessionId)}/prospect-shares`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const revokeProspectShare = (sessionId: string, shareId: string) =>
  apiRequest<void>(`/api/creation-sessions/${encodeURIComponent(sessionId)}/prospect-shares/${encodeURIComponent(shareId)}`, {
    method: 'DELETE',
  });

/** What the prospect did. `objectId` reads ONE card's engagement; omit it for the board's. */
export const readProspectEngagement = (sessionId: string, objectId?: string) =>
  apiRequest<{ engagement: ProspectEngagement; shared?: boolean }>(
    `/api/creation-sessions/${encodeURIComponent(sessionId)}/prospect-engagement${objectId ? `?objectId=${encodeURIComponent(objectId)}` : ''}`,
  );

// ---------------------------------------------------------------------------
// The buyer's half — no account, no credentials
// ---------------------------------------------------------------------------

export interface ProspectCard {
  id: string;
  kind: string;
  title: string;
  status: string;
  data: Record<string, unknown>;
}

export interface ProspectPacket {
  shareId: string;
  target: 'board' | 'card';
  sessionId: string;
  title: string;
  settings: ProspectShareSettings;
  cards: ProspectCard[];
  acceptable: { quoteObjectId: string; totalCents: number; currency: string } | null;
  revision: number;
}

const dealPath = (token: string, suffix = '') => `/api/public/deals/${encodeURIComponent(token)}${suffix}`;

/** Every buyer-side call: no credential, and the statuses this page renders itself so a
 *  revoked link does not raise the product's global error toast at a stranger. */
const BUYER = { auth: 'none' as const, expectedErrors: [400, 403, 404, 409] };

/** Read the packet. Returns null for every failure — a buyer page that distinguishes
 *  "revoked" from "never existed" is one that tells a stranger which tokens are real. */
export async function fetchProspectPacket(token: string): Promise<ProspectPacket | null> {
  try {
    // `no-store`: a share can be revoked between two reads, and a cached packet is a
    // revoked link that keeps rendering.
    const body = await apiRequest<{ packet?: ProspectPacket }>(dealPath(token), { ...BUYER, cache: 'no-store' });
    return body.packet ?? null;
  } catch {
    return null;
  }
}

export type ProspectEventName = 'opened' | 'viewed' | 'dwell' | 'requestedControl' | 'accepted' | 'declined' | 'downloaded';

/**
 * Report one signal. Fire-and-forget by design: telemetry that can break the page it is
 * measuring is worse than no telemetry, and there is nothing a buyer's browser could
 * usefully do with a failure.
 *
 * `keepalive` so a `dwell` reported as the tab closes actually leaves — which is exactly
 * the moment the most valuable dwell number is known.
 */
export function reportProspectEvent(
  token: string,
  event: ProspectEventName,
  detail: { canvasObjectId?: string; objectLabel?: string; seconds?: number } = {},
): void {
  void apiRequest(dealPath(token, '/events'), {
    ...BUYER,
    method: 'POST',
    body: JSON.stringify({ event, ...detail }),
    // The dwell that matters most is the one reported as the tab closes; without this it
    // is cancelled with the page.
    keepalive: true,
  }).catch(() => { /* a dropped signal must never surface to a buyer */ });
}

export type AcceptOutcome =
  | { ok: true; intent: QuoteCheckoutIntent | null; totalCents: number; currency: string }
  | { ok: false; error: string };

export async function acceptProspectQuote(
  token: string,
  body: { quoteObjectId: string; name: string; email: string },
): Promise<AcceptOutcome> {
  try {
    const payload = await apiRequest<Record<string, unknown>>(dealPath(token, '/accept'), {
      ...BUYER, method: 'POST', body: JSON.stringify(body),
    });
    return {
      ok: true,
      intent: (payload.intent ?? null) as QuoteCheckoutIntent | null,
      totalCents: Number(payload.totalCents ?? 0),
      currency: String(payload.currency ?? 'USD'),
    };
  } catch (error) {
    // The route's own sentence, when it gave one: "this quote has expired" is something a
    // buyer can act on, where "that could not be accepted" is not.
    const message = error instanceof Error && error.message ? error.message : '';
    return { ok: false, error: message || 'That could not be accepted.' };
  }
}

export async function declineProspectQuote(
  token: string,
  body: { quoteObjectId: string; reason: string },
): Promise<boolean> {
  try {
    await apiRequest(dealPath(token, '/decline'), { ...BUYER, method: 'POST', body: JSON.stringify(body) });
    return true;
  } catch {
    return false;
  }
}

export async function requestProspectControl(
  token: string,
  body: { name: string; note: string },
): Promise<boolean> {
  try {
    await apiRequest(dealPath(token, '/request-control'), { ...BUYER, method: 'POST', body: JSON.stringify(body) });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// The sell-motion acts
// ---------------------------------------------------------------------------

const sellMotion = (sessionId: string, objectId: string, action: string) =>
  `/api/sell-motion/${encodeURIComponent(sessionId)}/objects/${encodeURIComponent(objectId)}/${action}`;

export const readCallCard = (sessionId: string, objectId: string) =>
  apiRequest<{ card: Record<string, unknown> }>(sellMotion(sessionId, objectId, 'read-call'), { method: 'POST' });

export const assembleTrustPacketCard = (sessionId: string, objectId: string) =>
  apiRequest<{ card: Record<string, unknown>; answered: number }>(
    sellMotion(sessionId, objectId, 'assemble-trust-packet'), { method: 'POST' },
  );

export const provisionTrialCard = (sessionId: string, objectId: string, body: { days?: number; sourceSessionId?: string }) =>
  apiRequest<{ card: Record<string, unknown>; sessionId: string }>(
    sellMotion(sessionId, objectId, 'provision-trial'), { method: 'POST', body: JSON.stringify(body) },
  );

export const handoffPlanCard = (sessionId: string, objectId: string, body: { sourceSessionId?: string }) =>
  apiRequest<{ card: Record<string, unknown>; sessionId: string }>(
    sellMotion(sessionId, objectId, 'handoff'), { method: 'POST', body: JSON.stringify(body) },
  );
