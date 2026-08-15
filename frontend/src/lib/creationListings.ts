/**
 * Selling a canvas creation, client side.
 *
 * The listing VOCABULARY is not declared here — it comes from
 * `@builderforce/creation-canvas-contract`, the same module the API validates
 * against, so the kind a seller picks and the kind the server accepts cannot
 * disagree. This file is transport and nothing else.
 *
 * Two auth modes, on purpose. Publishing, buying, earning and paying out send the
 * workspace token; browsing and LAUNCHING do not require one, because a
 * marketplace whose products only run after a sign-up is a catalogue of
 * screenshots. `launchListing` sends the token when there is one — that is what
 * upgrades a paid listing from its preview to the real thing for someone who owns
 * it — and works fine without.
 */

import { apiRequest } from './apiClient';
import type { ListingLaunchMode, ListingTrialPolicy } from '@builderforce/creation-canvas-contract';

export interface CreationListing {
  id: string;
  slug: string;
  kind: string;
  name: string;
  summary: string | null;
  category: string | null;
  tags: string[];
  version: string;
  visibility: string;
  priceCents: number;
  currency: string;
  trial: ListingTrialPolicy;
  launch: ListingLaunchMode;
  icon: string;
  installCount: number;
  rating: number | null;
  publishedAtISO: string | null;
  updatedAtISO: string;
  sellerRef: string | null;
  sellerName: string | null;
  source?: { sessionId: string; objectId: string | null; objectKind: string | null };
}

export interface PublishCandidate {
  objectId: string | null;
  objectKind: string | null;
  title: string;
  kinds: string[];
  existingListingId: string | null;
}

export interface CandidatesView {
  session: PublishCandidate;
  objects: PublishCandidate[];
  /** The platform's cut, in basis points — shown to the seller before they price. */
  takeRateBps: number;
}

export interface LaunchPayload {
  mode: ListingLaunchMode;
  entitled: boolean;
  title: string;
  document?: string;
  url?: string;
  objects?: Array<{ id: string; kind: string; canvasData: unknown; content: unknown }>;
}

export interface SellerEarnings {
  earnedCents: number;
  paidCents: number;
  availableCents: number;
  salesCount: number;
}

export interface PublishRequest {
  sessionId: string;
  objectId: string | null;
  kind: string;
  name: string;
  summary?: string;
  category?: string;
  tags?: string[];
  priceCents?: number;
  currency?: string;
  trial?: ListingTrialPolicy;
  listingId?: string | null;
  /**
   * A staged snapshot to promote instead of re-reading the board.
   *
   * Sent by the Releases panel so the build that passed its checks is the build that
   * goes on sale. Omitted by the publish form, which has nothing staged to promote.
   */
  fromSnapshotId?: string | null;
}

const AUTHED = '/api/creation-listings';
const PUBLIC = '/api/listings';

export const creationListingApi = {
  /** What on this board could be sold, and as what. */
  candidates: (sessionId: string) =>
    apiRequest<CandidatesView>(`${AUTHED}/candidates/${sessionId}`),

  publish: (input: PublishRequest) =>
    apiRequest<{ listing: CreationListing }>(AUTHED, {
      method: 'POST',
      body: JSON.stringify(input),
    }).then((r) => r.listing),

  mine: () => apiRequest<{ listings: CreationListing[] }>(`${AUTHED}/mine`).then((r) => r.listings),

  unpublish: (listingId: string) =>
    apiRequest<{ ok: boolean }>(`${AUTHED}/${listingId}`, { method: 'DELETE' }),

  /** Take a FREE listing. A priced one answers 400 and belongs on `checkout`. */
  acquire: (slug: string) =>
    apiRequest<{ acquisition: { orderId: number; priceCents: number } }>(
      `${AUTHED}/${slug}/acquire`,
      { method: 'POST', expectedErrors: [400] },
    ).then((r) => r.acquisition),

  /** Begin a paid purchase; resolves to the processor's hosted checkout URL. */
  checkout: (slug: string, returnUrl: string) =>
    apiRequest<{ checkoutUrl: string }>(`${AUTHED}/${slug}/checkout`, {
      method: 'POST',
      body: JSON.stringify({ returnUrl }),
      expectedErrors: [400],
    }).then((r) => r.checkoutUrl),

  /**
   * Finish a paid purchase after the processor redirects back.
   *
   * Sends only the checkout id — the server re-reads the session from the
   * processor, so nothing this client says decides whether the grant happens.
   */
  completeCheckout: (checkoutSessionId: string) =>
    apiRequest<{ acquisition: { orderId: number; priceCents: number } }>(
      `${AUTHED}/checkout/${encodeURIComponent(checkoutSessionId)}/complete`,
      { method: 'POST', expectedErrors: [400, 403, 404] },
    ).then((r) => r.acquisition),

  /** Copy what I bought onto a new board of my own; resolves to its session id. */
  install: (slug: string) =>
    apiRequest<{ installed: { sessionId: string; title: string; objectCount: number } }>(
      `${AUTHED}/${slug}/install`,
      { method: 'POST' },
    ).then((r) => r.installed),

  acquired: () =>
    apiRequest<{ acquired: Array<{ listingId: string; slug: string; name: string; kind: string }> }>(
      `${AUTHED}/acquired`,
    ).then((r) => r.acquired),

  earnings: () =>
    apiRequest<{ earnings: SellerEarnings; takeRateBps: number }>(`${AUTHED}/earnings`),

  payout: () =>
    apiRequest<{ ok: boolean; amountCents: number; error?: string }>(`${AUTHED}/payout`, {
      method: 'POST',
      // A payout with nothing available answers 400 with a reason the panel shows;
      // it is a normal outcome of pressing the button early, not a system fault.
      expectedErrors: [400],
    }),

  refund: (orderId: number) =>
    apiRequest<{ refundedCents: number }>(`${AUTHED}/orders/${orderId}/refund`, { method: 'POST' }),
};

export const publicListingApi = {
  browse: (query: { q?: string; kind?: string; page?: number; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (query.q) params.set('q', query.q);
    if (query.kind) params.set('kind', query.kind);
    if (query.page) params.set('page', String(query.page));
    if (query.limit) params.set('limit', String(query.limit));
    const qs = params.toString();
    return apiRequest<{ listings: CreationListing[]; total: number }>(
      `${PUBLIC}${qs ? `?${qs}` : ''}`,
      { auth: 'none' },
    );
  },

  detail: (slug: string) =>
    apiRequest<{ listing: CreationListing }>(`${PUBLIC}/${slug}`, {
      auth: 'none',
      expectedErrors: [404],
    }).then((r) => r.listing),

  /**
   * Run it.
   *
   * Sends the workspace token when the visitor has one — the server uses it only to
   * UPGRADE a paid listing from preview to the product, never to reject — so this
   * one call serves the logged-out stranger and the buyer alike.
   */
  launch: (slug: string, signedIn: boolean) =>
    apiRequest<{ launch: LaunchPayload }>(`${PUBLIC}/${slug}/launch`, {
      auth: signedIn ? 'tenant' : 'none',
      expectedErrors: [404],
    }).then((r) => r.launch),
};

/** Money, formatted the way every listing surface shows it. One derivation, so a
 *  card, the publish panel and the earnings row cannot disagree about a price. */
export function formatListingPrice(cents: number, currency = 'USD', locale?: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
}
