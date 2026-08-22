/**
 * Shell chrome routing — the single source of truth for which chrome a pathname
 * gets. Pure (no React) so it can be unit-tested without mounting the whole app
 * provider tree; consumed by ConditionalAppShell.
 */

import { PANEL_SURFACES } from './publicDestinations';

/**
 * Standalone auth-flow screens. They render their own card UI and own their auth
 * handling (sign in, sign up, editor activation), so they must mount for LOGGED-OUT
 * visitors too. `/activate` belongs here: as a default app-shell route a signed-out
 * visitor hitting the VS Code device link (/activate?code=XXXX-XXXX) got the generic
 * "This is part of Builderforce.ai" marketing teaser — the page never mounted, so its
 * own sign-in redirect never fired and the device flow dead-ended.
 */
const FOOTER_ONLY_PATHS = ['/login', '/register', '/activate'];

/**
 * Is `pathname` this route or something UNDER it?
 *
 * A bare `startsWith` is not that question, and the difference was a real bug:
 * `/embedded` — the Embedded Capabilities destination, a rail row with its own
 * page — starts with `/embed`, so the framed-webview prefix below swallowed it.
 * It rendered with no chrome at all and, in `ConditionalAppShell`, inside the
 * lean cross-origin provider tree meant for a partitioned iframe. Prefix lists
 * compare SEGMENTS here, as `PUBLIC_SHELL_PREFIXES` already did.
 */
function underPrefix(pathname: string, prefix: string): boolean {
  if (prefix.endsWith('/')) return pathname.startsWith(prefix);
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Full-screen routes that render their own UI with no shell chrome.
 *
 * `/book` is a CANDIDATE picking an interview time. They have no account, they are not a
 * prospect, and they did not come to evaluate the product — so neither the operator shell
 * nor the marketing chrome is honest here. A nav bar inviting them to "start building"
 * beside the interview they are booking is the surface equivalent of an ad in a waiting
 * room. The page is its own thing, and that is the whole reason this list exists.
 *
 * `/deal` is the same argument pointed the other way, and it is stronger. It is a BUYER
 * reading what a seller sent them — a price, a security packet, a joint plan — and the
 * masthead on that page is the SELLER's name, not ours. Wrapping it in our marketing
 * chrome would put our nav, our pricing link and our sign-up CTA around somebody else's
 * negotiated offer, which is both a worse demo and, on a link the buyer may forward
 * internally, a leak of who we are selling to. See `ProspectDealView`.
 *
 * `/f/` (a published form) and `/p/` (a live poll) are the same argument a third and
 * fourth time, and they are the two that were WRONG until this entry existed. Neither
 * was listed, so `classifyShell` called them app routes and a signed-out visitor —
 * which is every visitor either of them has, by construction — got the per-route
 * marketing teaser instead of the page. The responder and the participant surfaces
 * were unreachable by their ONLY audience: exactly the defect class recorded against
 * the reference surfaces and `/creation-canvas` below, on the two routes where the
 * audience can never sign in first.
 *
 * Trailing slashes on both, deliberately: `underPrefix` reads a trailing-slash prefix
 * as "everything UNDER this route", so `/pricing` and `/features` stay app routes
 * while `/p/<slug>` and `/f/<slug>` do not. A bare `/p` here would silently swallow
 * every route beginning with p.
 *
 * The TOKEN-CREDENTIAL surfaces, added for the same reason `/f/` and `/p/` were
 * and found the same way: each one's own doc comment says "unauthenticated by
 * construction — the recipient has no session, so the token IS the credential",
 * and every one of them was nonetheless classified as an app route. A signer
 * opening `/sign/<token>`, a customer opening `/invoice/<ref>?t=…`, a firm
 * opening a data room, a referee opening a reference request, a recruiter
 * opening a resume link — all of them got the "This is part of Builderforce.ai"
 * teaser, because the page never mounted. Their ONLY audience could not reach
 * them, which is the whole defect class this list exists to close.
 *
 * `/lti/` is the same argument arriving from a learning management system. Both
 * routes render inside the LMS's iframe, where our cookie is a blocked
 * third-party cookie by design: `/lti/deep-link` is authenticated by the signed
 * envelope in the URL and nothing else, and `/lti/launch` is the page a launch
 * lands on precisely WHEN it was declined — a learner, or a platform that
 * released no email address. Teasing it replaced the sentence explaining why
 * they were turned away with an advert for the product that turned them away.
 *
 * Trailing slashes throughout: these are the sub-trees, not the app routes above
 * them. `/references` is the requester's console and stays an app route; only
 * `/references/shared/<token>` is the referee's page.
 */
const NO_CHROME_PREFIXES = ['/embed', '/webcontainer', '/auth/', '/book', '/deal', '/f/', '/p/', '/sign/', '/invoice/', '/resume/', '/data-rooms/shared/', '/legal-documents/shared/', '/references/shared/', '/lti/'];

/**
 * The framed cross-origin surface — the VS Code webview and third-party hosts.
 *
 * Exported because `ConditionalAppShell` asks the same question to pick the lean
 * provider tree, and it asked it with its own `startsWith('/embed')`, which is
 * how `/embedded` ended up in the iframe-safe tree with the global Brain and
 * every bridge missing.
 */
export function isFramedEmbed(pathname: string): boolean {
  return underPrefix(pathname, '/embed');
}

/**
 * Marketing + public-browse routes. These render in PublicShell (auth-aware
 * sidebar) for EVERYONE: logged-out visitors get the marketing nav + product
 * map, signed-in users get the app nav — but the page stays publicly viewable.
 * This is a DENY-LIST against the app shell: every route NOT listed here (nor
 * no-chrome / footer-only) defaults to the authenticated app shell, so a new
 * authed page gets correct chrome without being added to a list [1557]. Keep
 * this list current as marketing/public routes are added.
 */
// `/creation-canvas` is on this list because the HOMEPAGE links it — the Meet
// carousel's "Explore Create" button — and as a default app route a signed-out
// visitor who followed that button got the "This is part of Builderforce.ai"
// teaser instead of the page the button promised. Same defect class as the
// reference surfaces above, found while giving it the marketing column.
// `/salary` is the LARGEST programmatic-SEO surface the sitemap submits — every
// role page plus every role x city leaf, hundreds of URLs — and every one of them
// served the RouteMarketing teaser instead of the guide. The pages are async
// server components reading `getSalaryDirectory()` with no session anywhere in
// them, so the whole programme was filing hundreds of URLs of identical
// duplicate content under hundreds of names. `check-public-surface.mjs` now
// asserts sitemap membership and this list agree, so it cannot recur silently.
// `/skills/` and `/personas/` carry a TRAILING SLASH on purpose, and the
// distinction is the whole fix for [per-entity SEO]. `underPrefix` treats a
// trailing-slash prefix as "everything UNDER this route, not the route itself",
// so the DETAIL pages (`/skills/<slug>`, `/personas/<slug>`) render for a
// logged-out crawler while the INDEX pages keep their `RouteMarketing` teaser.
//
// That split is deliberate, not an oversight. `/skills` and `/personas` are
// marketed registry entries (routeMarketing REGISTRY) whose real pages are
// authenticated browse-and-install consoles with nothing to show a signed-out
// visitor; their teaser is the better landing page and is already the URL the
// sitemap submits via `indexableTeaserRoutes()`. A detail page is the opposite:
// it is one entity, fully renderable without a session, and while it stayed on
// the app side every slug URL served the SAME teaser — duplicate content under
// hundreds of names, and no `generateMetadata` could run because the pages had
// to be client components to fetch at all. So: index → teaser (indexed once),
// detail → real page (indexed per entity). Sitemap and teaser registry agree
// because neither list changed for the index routes.
const PUBLIC_SHELL_PREFIXES = ['/about', '/legal', '/product', '/blog', '/tutorials', '/agents', '/pricing', '/compare', '/marketplace', '/talent', '/prompts', '/models', '/diagnostics', '/tools', '/evermind', '/media', '/sell-builderforce', '/book-demo', '/demo', '/creation-canvas', '/crm/phone', '/salary', '/skills/', '/personas/'];

/**
 * Routes an ANONYMOUS visitor gets the OPERATOR shell for, not marketing chrome.
 *
 * PRD 21 §0 — "the canvas is the product. Everything else is a panel over it."
 * A board opened without an account is a real, editable, local-first board, so it
 * gets the real shell: sessions on the left, the stage in the middle, the team on
 * the footer. Rendering it inside `MarketingShell` handed a signed-out person a
 * DIFFERENT product from the one they were being asked to sign up for — and the
 * shell IS the product, so the two must be the same surface.
 *
 * `/create/invitations/*` is here for a second reason: that page renders its own
 * "sign in with the invited email" branch, so as a default app route it was a
 * dead end — the teaser mounted in its place and the invitee never saw it.
 *
 * `/create/new` is here for the same reason, and it was the worst version of it:
 * that route is not a page, it is the ONE prompt-led entry point — it opens a
 * local session from `?prompt=` and replaces the URL with `/create/local-…`.
 * Teasing it meant the page never mounted, so the session was never created and
 * the prompt was DROPPED. Every prompt-carrying CTA in the product lands here
 * (the tutorial catalog, the blog course links, Marketplace model comparison,
 * `/brainstorm`), and the teaser's own "Start creating free" button points at
 * `/create/new` too — so a signed-out visitor bounced back to the same teaser
 * with their request thrown away.
 */
const GUEST_APP_PATTERNS: RegExp[] = [
  /^\/create$/,
  /^\/create\/new$/,
  /^\/create\/local-/,
  /^\/create\/invitations(?:\/|$)/,
];

export type ShellKind = 'none' | 'footer' | 'public' | 'app';

export type GuestBrainstormEntry = 'resolving' | 'room' | 'legacy';

/**
 * Decide the logged-out /brainstorm entry without racing URL discovery.
 *
 * The invite code is `undefined` for the server render and first hydrated frame,
 * `null` once the browser has confirmed there is no invite, and a string for an
 * invite. Treating the unresolved frame as legacy used to mount the creation-
 * canvas redirect before the effect could read `?room=`, dropping fresh and
 * incognito invitees out of the shared room.
 */
export function classifyGuestBrainstormEntry(inviteCode: string | null | undefined): GuestBrainstormEntry {
  if (inviteCode === undefined) return 'resolving';
  return inviteCode ? 'room' : 'legacy';
}

/**
 * Classify the shell chrome for a path.
 * Order matters: no-chrome → footer-only → public-marketing → (default) app.
 * The app shell is the DEFAULT (deny-list model): anything not explicitly
 * no-chrome, footer-only, or public-marketing is treated as an authenticated
 * app route, so new pages get the right chrome by default [1557].
 */
export function classifyShell(pathname: string): ShellKind {
  if (NO_CHROME_PREFIXES.some((p) => underPrefix(pathname, p))) return 'none';
  if (FOOTER_ONLY_PATHS.includes(pathname)) return 'footer';
  if (pathname === '/') return 'public';
  // A reference surface is public BY DEFINITION — that is the half of §11.4.5
  // that makes the other half cheap. Reading it off the registry rather than
  // off a second prefix list is what stops the two from disagreeing.
  if (isReferenceSurface(pathname)) return 'public';
  if (PUBLIC_SHELL_PREFIXES.some((p) => underPrefix(pathname, p))) return 'public';
  return 'app';
}

/**
 * Does THIS visitor get the operator shell on THIS route?
 *
 * One predicate with two consumers, deliberately: `ConditionalAppShell` uses it
 * to pick the chrome and `shellHostsCanvasStage` uses it to decide who mounts the
 * board. When those two disagreed — the marketing shell rendering the canvas
 * route while the stage believed it was hosted, or the reverse — the board was
 * either mounted twice or not at all.
 */
export function rendersAppShell(pathname: string, isAuthenticated: boolean): boolean {
  if (isReferenceSurface(pathname) && isAuthenticated) return true;
  if (classifyShell(pathname) !== 'app') return false;
  return isAuthenticated || GUEST_APP_PATTERNS.some((pattern) => pattern.test(pathname));
}

/**
 * The public explainer surfaces that are a PANEL when you are signed in
 * (PRD 21 §11.4.5).
 *
 * `/soc2`, `/integrations` and the nine domain pages were the last controls in
 * the product that navigated a signed-in person AWAY from their board — so
 * someone mid-agent-turn who wanted to check whether an HRMS is supported paid
 * for the answer with their session. They now resolve two ways, from one
 * component:
 *
 *   signed out → an ordinary page, ordinary URL, ordinary SEO. Unchanged, which
 *                is what makes this cheap: no redirect map, no slug migration.
 *   signed in  → the same route inside `ShellPanel`, over a board that stays
 *                mounted. Esc puts you back with the turn still running.
 *
 * DERIVED from the registry's `panel: true` rows rather than retyped here. It
 * was retyped here, and the copy drifted immediately: `/features` and the nine
 * domain pages were reference surfaces in this file but absent from
 * `PUBLIC_SHELL_PREFIXES` below, so `classifyShell` called them app routes and a
 * signed-OUT visitor got the "This is part of Builderforce.ai" teaser instead of
 * the page. The whole public product map — every domain explainer and the
 * features index — was unreachable and unindexable. One list cannot disagree
 * with itself.
 */
export function isReferenceSurface(pathname: string): boolean {
  return PANEL_SURFACES.some((p) => underPrefix(pathname, p));
}
