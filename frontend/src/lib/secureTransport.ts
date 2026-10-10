/**
 * THE ONE answer to "did this request arrive over HTTPS, and where should it be
 * served from?" — read by the middleware (redirect + HSTS) and by
 * `i18n/requestOrigin.ts` (the origin a server render resolves assets against).
 *
 * Why it exists: `http://builderforce.ai/` answered 200 with no redirect, and
 * `http://www.builderforce.ai/` 301'd to `http://builderforce.ai/` — a plain-HTTP
 * page is not a secure context, so `crypto.randomUUID` is undefined there and the
 * app crashed on its first id (`RenderCrash: crypto.randomUUID is not a function`,
 * 69 events). The zone's "Always Use HTTPS" is the edge-level fix; this is the
 * code-level one, and it does not depend on a dashboard toggle staying on.
 *
 * Scope it CANNOT reach: a prerendered path is answered by the assets binding
 * without invoking the Worker (`wrangler.toml` `run_worker_first = ["/"]`), so its
 * first plain-HTTP visit is not redirected here. `public/_headers` sends HSTS on
 * those, which keeps every later visit on HTTPS, and the root layout's
 * `RANDOM_UUID_POLYFILL` keeps the one insecure visit from crashing.
 *
 * Import-free on purpose: the middleware ships in the Worker bundle.
 */

/** No `preload`: that is a one-way submission to browser lists, not a header choice. */
export const HSTS_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

/** Development hosts, which have no certificate and must never be upgraded. */
const LOCAL_HOST = /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\]|::1)$|\.localhost$/;

/** The hostname of a `Host` header value (port stripped, IPv6 brackets kept). */
export function hostnameOf(host: string): string {
  return host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]!;
}

export function isLocalHost(hostname: string): boolean {
  return LOCAL_HOST.test(hostname.toLowerCase());
}

interface HeaderReader { get(name: string): string | null }

/**
 * The scheme the CLIENT used. Cloudflare's `cf-visitor` is authoritative at the
 * edge, `x-forwarded-proto` covers any other proxy, and the request URL's own
 * protocol is the last word (and what `next dev` has).
 */
export function requestScheme(headers: HeaderReader, fallbackProtocol: string): 'http' | 'https' {
  // `cf-visitor` is `{"scheme":"https"}`. Read the one field rather than JSON.parse it,
  // so a malformed header simply falls through to the next signal.
  const visitorScheme = /"scheme"\s*:\s*"(https?)"/i.exec(headers.get('cf-visitor') ?? '')?.[1]?.toLowerCase();
  if (visitorScheme === 'http' || visitorScheme === 'https') return visitorScheme;
  const forwarded = headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  if (forwarded === 'http' || forwarded === 'https') return forwarded;
  return fallbackProtocol.replace(/:$/, '').toLowerCase() === 'http' ? 'http' : 'https';
}

/**
 * Where a request must go instead, or null to serve it: plain HTTP is upgraded to
 * HTTPS, and `www.` is folded onto the apex — in ONE hop, always to `https:`, so
 * the canonical-host redirect can never downgrade the scheme. Same path and query.
 */
export function secureCanonicalRedirect(url: URL, headers: HeaderReader): URL | null {
  if (isLocalHost(url.hostname)) return null;
  const hostname = url.hostname.startsWith('www.') ? url.hostname.slice('www.'.length) : url.hostname;
  if (requestScheme(headers, url.protocol) === 'https' && hostname === url.hostname) return null;
  const target = new URL(url.toString());
  target.protocol = 'https:';
  target.hostname = hostname;
  target.port = '';
  return target;
}
