/**
 * WHO IS AT THE DOOR — the one derivation of "is this person entitled to the app on
 * this site, or are they still a visitor to it?"
 *
 * ── WHY THIS IS A PRIMITIVE AND NOT AN `if` IN THE SERVER ────────────────────────
 * Three surfaces ask this question and they must never disagree: the document fork
 * (landing page or app?), the billing endpoints (may they manage a subscription?),
 * and anything later that decides whether to show an upgrade prompt. Written inline
 * in the first of them, the second would grow its own copy — and the failure mode of
 * two copies here is a paying customer shown a sales page, or a stranger shown the
 * product.
 *
 * ── THE RULE, AND WHY IT IS SHAPED THIS WAY ──────────────────────────────────────
 *   no session                        → visitor.  Nobody is entitled anonymously.
 *   session, live subscription        → entitled.
 *   session, lapsed or cancelled      → visitor. They see the shop window again, which
 *                                       is where the renewal is — a dead end with an
 *                                       error would be the alternative.
 *   session, never subscribed         → ASK THE SELLER. See below.
 *
 * The lapsed line is worth stating out loud: a lapsed subscriber is deliberately NOT
 * told "access denied". They are returned to the page that sells the thing they already
 * wanted, still signed in, one click from resubscribing.
 *
 * ── THE LAST LINE USED TO BE "ENTITLED", AND THAT WAS A HOLE ─────────────────────
 * "No subscription row → entitled" is right for a FREE app — there is no subscription
 * to hold, and requiring one would lock everybody out of something nobody is charging
 * for. It is wrong for a PAID one, because this site's own sign-in is an emailed code
 * anybody can request: sign in, never pay, get the product.
 *
 * The missing fact was never the visitor's, it was the SELLER's — free, priced, opened
 * to a full trial, or withdrawn. That lives on the `app` listing published from the
 * board that became this project (`siteListing.ts` finds it, cached and invalidated by
 * the marketplace's own version token), and the decision it feeds is
 * `entitledToListing` in `creationListings.ts` — THE rule, which the marketplace
 * listing page already asks. Two copies of that sentence is a paid product served free
 * at one address or a paying customer locked out at the other.
 *
 * A site with NO listing is unchanged: nothing is on sale, signing in is the gate the
 * creator put up, and a signed-in end user is entitled.
 */

import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { resolveSiteUser, siteSessionCookie } from './siteAuth';
import { siteSubscriptionState, type SiteSubscriptionState } from '../marketplace/siteSubscriptions';
import { entitledToListing } from '../marketplace/creationListings';
import { siteListing } from './siteListing';
import type { SiteRecord } from './siteHosting';

export interface SiteVisitor {
  /** The signed-in end user, or null for an anonymous visitor. */
  siteUserId: number | null;
  email: string | null;
  /** True when this person should be served the APP rather than the shop window. */
  entitled: boolean;
  subscription: SiteSubscriptionState;
}

const ANONYMOUS: SiteVisitor = { siteUserId: null, email: null, entitled: false, subscription: 'none' };

export async function resolveSiteVisitor(
  env: Env,
  db: Db,
  site: Pick<SiteRecord, 'siteId' | 'tenantId' | 'projectId'>,
  request: Request,
): Promise<SiteVisitor> {
  const identity = await resolveSiteUser(
    db, site.siteId, site.tenantId, siteSessionCookie(request.headers.get('cookie')),
  );
  // Answered before any other read: an anonymous visitor is the overwhelming majority
  // of traffic to a public page, and they cannot be an entitled `site_user` by
  // definition.
  if (!identity) return ANONYMOUS;

  const { state } = await siteSubscriptionState(db, site.tenantId, site.siteId, identity.userId);
  // A lapsed subscriber is never entitled, whatever the seller has since decided —
  // including a seller who has since made the app free, because the shop window is
  // where they find that out.
  if (state === 'lapsed') {
    return { siteUserId: identity.userId, email: identity.email, entitled: false, subscription: state };
  }

  const listing = await siteListing(env, db, site);
  return {
    siteUserId: identity.userId,
    email: identity.email,
    // Nothing on sale → signing in IS the gate the creator put up. Otherwise the
    // seller's own terms decide, through the rule the marketplace already owns.
    entitled: listing ? entitledToListing(listing, state === 'live') : true,
    subscription: state,
  };
}

/**
 * The query parameter that says "I know about the shop window; let me into the app."
 *
 * A landing page needs a door, and the app's own door is the site root — which is the
 * one address the fork claims. Without an opt-out, "Open the app" would serve the
 * landing page again, so a visitor who wants to sign in or subscribe could never reach
 * the screen that lets them: the shop window would be a room with no exit.
 *
 * A query parameter rather than a second path, because a path convention (`/app`) is a
 * URL the app itself would then have to know it lives under, and the decision this
 * implements is that the app keeps every path it has today.
 */
export const ENTER_APP_PARAM = 'app';

/**
 * Should this request be answered with the landing page?
 *
 * Only the ENTRY DOCUMENT is forked. An asset, a deep link and a backend call are
 * served exactly as they are today, because a landing page returned in place of a
 * stylesheet is a broken site rather than a shop window — and because a visitor who
 * was sent a direct link to something inside the app was sent it on purpose.
 *
 * Cheap by construction: it reads a boolean already on the cached site record and
 * only then asks the database who the visitor is, so a site with no landing page
 * costs nothing at all.
 */
export function landingPageApplies(site: SiteRecord, url: URL): boolean {
  if (!site.landingObjectId) return false;
  if (url.searchParams.has(ENTER_APP_PARAM)) return false;
  const rel = url.pathname.replace(/^\/+/, '');
  return rel === '' || rel === site.indexDocument;
}

/** Never let an intermediary cache one visitor's answer for another's request: the
 *  same URL legitimately returns two different documents depending on a cookie. */
export function forkedDocumentHeaders(): Record<string, string> {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'private, no-store',
    Vary: 'Cookie',
  };
}

/** Re-exported so a consumer of the entitlement rule never has to reach past it into
 *  the subscription module to name the states it returns. */
export type { SiteSubscriptionState };

/** The env type the fork needs — declared so the serving path can stay honest about
 *  requiring R2 without importing the bucket's type from three places. */
export type SiteServingEnv = Env & { UPLOADS?: R2Bucket };
