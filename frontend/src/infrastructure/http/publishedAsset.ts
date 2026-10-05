/**
 * THE ONE reader for a static asset this deploy publishes (a message catalog, a
 * blog body), on the server and on the client.
 *
 * On the deployed worker it reads through the `ASSETS` binding (`wrangler.toml`),
 * never through the network. The network route was a fetch from the worker to its
 * own public hostname with `cache: 'force-cache'` — and workerd rejects that cache
 * mode, so EVERY server read failed in production: every blog article threw
 * (2026-10-05, digest 10747649 on all posts) and every non-English catalog
 * silently degraded to English. The binding is the asset layer itself: no
 * self-subrequest, no hostname/route dependency, no cache-mode semantics.
 *
 * Elsewhere — the browser, `next dev`, tests — it is a plain fetch of
 * `${origin}${path}`. No `cache` mode: every published path is build-versioned
 * and marked immutable in `public/_headers`, so the HTTP cache already does it.
 *
 * @param path Root-relative asset path (query string allowed).
 * @param origin Absolute origin for the network fallback; `''` on the client.
 */
export function fetchPublishedAsset(path: string, origin = '', signal?: AbortSignal): Promise<Response> {
  const assets = typeof window === 'undefined' ? assetsBinding() : undefined;
  if (assets) return assets.fetch(new URL(path, origin || 'https://assets.invalid'), { signal });
  return fetch(`${origin}${path}`, { signal });
}

interface AssetsFetcher {
  fetch(input: URL, init?: RequestInit): Promise<Response>;
}

/**
 * The slot next-on-pages stores each request's `{ env, ctx }` in — what its
 * `getOptionalRequestContext()` reads. Read directly rather than imported: the
 * package entry `require`s `server-only`, and this module is also reached from the
 * client (`LocaleProvider` → `loadCatalog`) and from the root layout's closure.
 */
const REQUEST_CONTEXT = Symbol.for('__cloudflare-request-context__');

function assetsBinding(): AssetsFetcher | undefined {
  const context = (globalThis as Record<symbol, { env?: { ASSETS?: AssetsFetcher } } | undefined>)[REQUEST_CONTEXT];
  return context?.env?.ASSETS;
}
