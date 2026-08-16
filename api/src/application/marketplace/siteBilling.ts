/**
 * THE PUBLISHED SITE'S MONEY — `/__api/billing/*` on the app's own origin.
 *
 * ── WHY THIS IS ITS OWN MODULE ───────────────────────────────────────────────
 * These four handlers used to live in `application/ide/siteServer.ts`, beside
 * the asset server and the traffic counter. That put the decision "may this
 * person be charged, and whose ledger does it land in" inside the module whose
 * job is "read bytes out of R2" — two responsibilities with nothing in common
 * except a hostname, and the one that matters is the one that moves money.
 *
 * The split follows the wave's ownership boundary exactly: the MONEY lives in
 * `application/marketplace/`, and the serving fork that mounts it lives in
 * `application/ide/`. `siteServer.ts` now routes `/__api/billing/…` here and
 * knows nothing else about it.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ────────────────────────────────────────────
 * No pricing, no take rate, no ledger writes, no entitlement rule. Every one of
 * those already has exactly one owner (`siteSubscriptions.ts`, `listingCommerce.ts`,
 * `creationListings.ts`), and this module is the ADDRESS they answer at — it
 * resolves who is asking, refuses anonymous callers, and hands off.
 *
 * ── THE TWO RULES THAT MUST NOT MOVE ─────────────────────────────────────────
 *  1. Every route that MOVES OR PROTECTS money requires a SIGNED-IN end user,
 *     resolved from the site's own cookie. There is no anonymous subscribe: a
 *     payment with nobody attached is a charge nobody can be granted access for,
 *     and nobody can cancel. `widget.js` and `listing` are the two deliberate
 *     exceptions — the same public price and name a stranger already sees on the
 *     shop window, answered before it asks them to sign in, because that is the
 *     whole reason the widget exists.
 *  2. The seller's tenant comes off the RESOLVED SITE, never off the request.
 *     It decides whose ledger the money lands in, and taking it from a caller
 *     would let anyone direct a payment into their own books.
 */

import type { Env } from '../../env';
import { buildDatabase } from '../../infrastructure/database/connection';
import type { SiteRecord } from '../ide/siteHosting';
import { resolveSiteUser, siteSessionCookie } from '../ide/siteAuth';
import { jsonResponse, readSubmission } from '../ide/siteServer.http';
import { exportOwnedSiteRecords } from '../ide/siteData';
import { ListingError } from './creationListings';
import { siteListing } from '../ide/siteListing';
import { commerceWidgetResponse } from './siteCommerceWidget';
import {
  acceptSiteSubscriptionUpdate,
  cancelSiteSubscription,
  completeSiteSubscription,
  startSiteSubscriptionCheckout,
  subscriberStanding,
  takeAbandonedBuild,
} from './siteSubscriptions';

/** Turn any failure into the status the caller should see. `ListingError`
 *  already carries one; anything else is a bad request by default rather than a
 *  500, because these are all caller-supplied identifiers. */
function failure(error: unknown, fallback: string): Response {
  const status = error instanceof ListingError ? error.status : 400;
  return jsonResponse({ error: error instanceof Error ? error.message : fallback }, status);
}

/**
 * Handle one `/__api/billing/<action>` request.
 *
 * `action` is the path segment after `billing/`. Returns a 404 envelope for
 * anything unrecognised, so an unknown endpoint answers like an API rather than
 * falling through to the asset server.
 */
export async function handleSiteBilling(
  env: Env,
  site: SiteRecord,
  request: Request,
  action: string,
): Promise<Response> {
  const db = buildDatabase(env);

  // ── The two PUBLIC answers ───────────────────────────────────────────────
  // Neither carries anything a stranger to this app should not see — the widget
  // script is the same bytes for every paid app, and the listing's name and price
  // are already on the shop window. Answered BEFORE the sign-in gate, because the
  // subscribe surface has to show a price to somebody it has not yet asked to sign
  // in — that is the whole reason it exists.
  if (action === 'widget.js' && request.method === 'GET') {
    return commerceWidgetResponse();
  }
  if (action === 'listing' && request.method === 'GET') {
    const listing = await siteListing(env, db, site);
    return jsonResponse({
      ok: true,
      listing: listing ? {
        slug: listing.slug, name: listing.name, priceCents: listing.priceCents, currency: listing.currency,
      } : null,
    }, 200);
  }

  const identity = await resolveSiteUser(
    db, site.siteId, site.tenantId, siteSessionCookie(request.headers.get('cookie')),
  );
  if (!identity) return jsonResponse({ error: 'Sign in first.' }, 401);

  const who = { tenantId: site.tenantId, siteId: site.siteId, siteUserId: identity.userId };

  if (action === 'me' && request.method === 'GET') {
    // The subscription, the version offer, AND the app's own lifecycle, from one
    // call. Asking them separately is how a surface shows a live subscription to a
    // dead app, or a paid-up subscriber an update prompt for a version they
    // already hold — exactly the drift the hosted lifecycle and the version offer
    // both exist to make visible in one read.
    const standing = await subscriberStanding(db, env, who);
    return jsonResponse({ ok: true, ...standing }, 200);
  }

  if (action === 'accept-update' && request.method === 'POST') {
    try {
      const subscription = await acceptSiteSubscriptionUpdate(db, env, who);
      return jsonResponse({ ok: true, subscription }, 200);
    } catch (error) {
      return failure(error, 'Could not apply the update.');
    }
  }

  if (action === 'subscribe' && request.method === 'POST') {
    const body = await readSubmission(request) as { slug?: unknown } | null;
    const slug = String(body?.slug ?? '').trim().slice(0, 160);
    if (!slug) return jsonResponse({ error: 'Which app?' }, 400);
    // The return URL is rebuilt from the REQUEST's own origin rather than taken
    // from the body: a caller-supplied one is an open redirect that a processor
    // would then send a paying customer to.
    const returnUrl = new URL(request.url).origin + '/';
    try {
      const { checkoutUrl } = await startSiteSubscriptionCheckout(db, env, {
        siteId: site.siteId,
        tenantId: site.tenantId,
        siteUserId: identity.userId,
        slug,
        returnUrl,
      });
      return jsonResponse({ ok: true, checkoutUrl }, 200);
    } catch (error) {
      return failure(error, 'Could not start checkout.');
    }
  }

  if (action === 'complete' && request.method === 'POST') {
    const body = await readSubmission(request) as { checkoutSessionId?: unknown } | null;
    const checkoutSessionId = String(body?.checkoutSessionId ?? '').trim().slice(0, 255);
    if (!checkoutSessionId) return jsonResponse({ error: 'Which checkout?' }, 400);
    try {
      const subscription = await completeSiteSubscription(db, env, {
        siteId: site.siteId,
        tenantId: site.tenantId,
        siteUserId: identity.userId,
        checkoutSessionId,
      });
      return jsonResponse({ ok: true, subscription }, 200);
    } catch (error) {
      return failure(error, 'Could not complete checkout.');
    }
  }

  if (action === 'cancel' && request.method === 'POST') {
    const result = await cancelSiteSubscription(db, env, site.tenantId, site.siteId, identity.userId);
    return jsonResponse({ ok: result.ok }, result.ok ? 200 : 404);
  }

  // ── The two abandonment remedies ───────────────────────────────────────────
  // Both are GATED ON THE LIFECYCLE and nothing else. `resolveHostedLifecycle`
  // decides; this module only asks. That is the whole reason they can be trusted:
  // a price check or a role check here would be a second rule, and a second rule
  // is how a working product gets given away or a stranded customer gets refused.

  if (action === 'export' && request.method === 'GET') {
    const standing = await subscriberStanding(db, env, who);
    if (!standing.hosted?.subscriberMayExport) {
      return jsonResponse({ error: 'This app is still running.' }, 409);
    }
    const collections = await exportOwnedSiteRecords({ db, ...who });
    return jsonResponse({ ok: true, collections }, 200);
  }

  if (action === 'take' && request.method === 'GET') {
    try {
      const build = await takeAbandonedBuild(db, env, who);
      return jsonResponse({ ok: true, ...build }, 200);
    } catch (error) {
      return failure(error, 'Could not hand over the build.');
    }
  }

  return jsonResponse({ error: 'Unknown endpoint.' }, 404);
}
