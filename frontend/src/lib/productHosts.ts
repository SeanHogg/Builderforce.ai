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
 * Import-free on purpose: the middleware ships in the Worker bundle.
 */

export interface ProductHost {
  /** The subdomain label, e.g. `studio` for `studio.builderforce.ai`. */
  label: string;
  /** The route the product lives under. */
  route: string;
}

export const PRODUCT_HOSTS: readonly ProductHost[] = [
  { label: 'studio', route: '/studio' },
  { label: 'spawn', route: '/spawn' },
];

/** The product a hostname belongs to, or null for the apex and everything else. */
export function productHostOf(hostname: string): ProductHost | null {
  return PRODUCT_HOSTS.find((host) => hostname.startsWith(`${host.label}.`)) ?? null;
}

/** Where a request for `pathname` on `hostname` should go instead, or null to serve it as is. */
export function productHostRedirect(hostname: string, pathname: string): string | null {
  const host = productHostOf(hostname);
  return host && pathname === '/' ? host.route : null;
}
