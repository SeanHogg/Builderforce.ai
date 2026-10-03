import type { SiteRecord } from './siteHosting';

/*
 * The landing-page fork's RULE, apart from its rendering and its entitlement check
 * (`siteVisitor.ts`, `siteLandingPage.ts`): pure, so the published-site Worker can
 * decide "is this the shop window?" without carrying the commerce code that decides
 * what the shop window says.
 */

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
