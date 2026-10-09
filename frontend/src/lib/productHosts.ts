/**
 * The product subdomains this one Next app serves, and where each host's root goes.
 *
 * `studio.builderforce.ai` is the standalone Studio IDE under `/studio`;
 * `spawn.builderforce.ai` is Spawn, the Roblox game builder, under `/spawn`. Each is
 * a zone route on the frontend Worker (`wrangler.toml`) and a reserved site label
 * (`api/src/application/ide/siteHosting.ts`). A new product host is a row here plus
 * those two lines — never another branch in the middleware.
 *
 * The host's root REDIRECTS to the product route rather than rewriting to it. A
 * rewrite would leave the browser on `/`, and every path-based rule in the app (the
 * shell's chrome decision, the floating Brain, route marketing) reads the browser
 * path, so each would mistake the product for the marketing home page. With a
 * redirect the path is the truth everywhere, and the route works the same on the
 * apex and on localhost.
 *
 * ── WORK THAT LIVES IN THE BROWSER LIVES ON ONE ORIGIN ──────────────────────────
 * A guest's canvas (and the Studio sessions built on it) is held in `localStorage`, and
 * the sign-in cookie is host-only — both are per ORIGIN. Studio started without an
 * account on `studio.builderforce.ai` would keep its boards where `builderforce.ai`
 * never sees them (never listed, never claimed by "Keep your work"), and someone signed
 * in on the apex would arrive on the studio host as a guest. So a host whose product keeps
 * its work in the browser is homed on the APEX (`home: 'apex'`): every request to it goes
 * to the SAME path on the apex, and the subdomain is an address for the product rather
 * than a second home for its data. Its `hostPaths` are the exceptions served where they
 * land — the auth callbacks, whose redirect URIs name the host. Listing the exceptions
 * rather than the paths that move is the point: a page nobody thought to list (`/login`,
 * `/dashboard`) would otherwise sign someone in on an origin the rest of the product
 * never reads. (A path the Worker never sees — a prerendered page the assets binding
 * answers — is out of the middleware's reach either way.)
 *
 * Import-free on purpose: the middleware ships in the Worker bundle.
 */

export interface ProductHost {
  /** The subdomain label, e.g. `studio` for `studio.builderforce.ai`. */
  label: string;
  /** The route the product lives under. */
  route: string;
  /** Where the product's pages are served: on the apex origin (see the file note), or on this host. */
  home: 'apex' | 'host';
  /** For an apex-homed host, the path prefixes still served on the host itself. */
  hostPaths: readonly string[];
}

/** Where a product-host request goes instead: a path, and whether on the apex origin. */
export interface ProductHostTarget {
  pathname: string;
  /** The apex hostname to send it to, or null to stay on this host. */
  hostname: string | null;
}

export const PRODUCT_HOSTS: readonly ProductHost[] = [
  // Studio starts guest canvases (`/studio/<sessionId>` is a canvas board) — they live on the apex.
  { label: 'studio', route: '/studio', home: 'apex', hostPaths: ['/auth'] },
  { label: 'spawn', route: '/spawn', home: 'host', hostPaths: [] },
];

/** The product a hostname belongs to, or null for the apex and everything else. */
export function productHostOf(hostname: string): ProductHost | null {
  return PRODUCT_HOSTS.find((host) => hostname.startsWith(`${host.label}.`)) ?? null;
}

const underPath = (pathname: string, prefix: string): boolean =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

/** Where a request for `pathname` on `hostname` should go instead, or null to serve it as is. */
export function productHostRedirect(hostname: string, pathname: string): ProductHostTarget | null {
  const host = productHostOf(hostname);
  if (!host) return null;
  const target = pathname === '/' ? host.route : pathname;
  if (host.home === 'apex' && !host.hostPaths.some((prefix) => underPath(pathname, prefix))) {
    return { pathname: target, hostname: hostname.slice(host.label.length + 1) };
  }
  return pathname === '/' ? { pathname: target, hostname: null } : null;
}
