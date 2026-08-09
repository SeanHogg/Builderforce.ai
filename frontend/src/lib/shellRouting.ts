/**
 * Shell chrome routing — the single source of truth for which chrome a pathname
 * gets. Pure (no React) so it can be unit-tested without mounting the whole app
 * provider tree; consumed by ConditionalAppShell.
 */

/**
 * Standalone auth-flow screens. They render their own card UI and own their auth
 * handling (sign in, sign up, editor activation), so they must mount for LOGGED-OUT
 * visitors too. `/activate` belongs here: as a default app-shell route a signed-out
 * visitor hitting the VS Code device link (/activate?code=XXXX-XXXX) got the generic
 * "This is part of Builderforce.ai" marketing teaser — the page never mounted, so its
 * own sign-in redirect never fired and the device flow dead-ended.
 */
const FOOTER_ONLY_PATHS = ['/login', '/register', '/activate'];

/** Full-screen routes that render their own UI with no shell chrome. */
const NO_CHROME_PREFIXES = ['/embed', '/webcontainer', '/auth/'];

/**
 * Marketing + public-browse routes. These render in PublicShell (auth-aware
 * sidebar) for EVERYONE: logged-out visitors get the marketing nav + product
 * map, signed-in users get the app nav — but the page stays publicly viewable.
 * This is a DENY-LIST against the app shell: every route NOT listed here (nor
 * no-chrome / footer-only) defaults to the authenticated app shell, so a new
 * authed page gets correct chrome without being added to a list [1557]. Keep
 * this list current as marketing/public routes are added.
 */
const PUBLIC_SHELL_PREFIXES = ['/legal', '/product', '/blog', '/tutorials', '/agents', '/pricing', '/compare', '/marketplace', '/talent', '/prompts', '/models', '/integrations', '/diagnostics', '/tools', '/evermind', '/soc2', '/media', '/sell-builderforce', '/book-demo', '/demo'];

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
  if (NO_CHROME_PREFIXES.some((p) => pathname.startsWith(p))) return 'none';
  if (FOOTER_ONLY_PATHS.includes(pathname)) return 'footer';
  if (pathname === '/') return 'public';
  if (PUBLIC_SHELL_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return 'public';
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
  if (classifyShell(pathname) !== 'app') return false;
  return isAuthenticated || GUEST_APP_PATTERNS.some((pattern) => pattern.test(pathname));
}
