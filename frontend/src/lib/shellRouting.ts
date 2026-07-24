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
const PUBLIC_SHELL_PREFIXES = ['/product', '/blog', '/agents', '/pricing', '/compare', '/marketplace', '/talent', '/prompts', '/models', '/integrations', '/diagnostics', '/tools', '/evermind', '/soc2', '/media', '/book-demo', '/marketing'];

export type ShellKind = 'none' | 'footer' | 'public' | 'app';

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
