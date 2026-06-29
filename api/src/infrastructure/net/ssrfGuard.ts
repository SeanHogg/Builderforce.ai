/**
 * Shared SSRF guard for any server-side fetch of a user/model-supplied URL.
 *
 * The gateway fetches these URLs from inside the Workers runtime, so a URL that
 * points at a loopback / private / link-local / metadata address must be
 * rejected before the fetch — otherwise a caller could probe the internal
 * network or the cloud metadata endpoint (169.254.169.254).
 *
 * Consumed by the tenant MCP extension guard (https-only) and the Brain web
 * fetch tool (http+https), so the host-blocking lives here once.
 *
 * Residual: a PUBLIC hostname that DNS-resolves to a private IP (DNS rebinding)
 * is not caught here — that needs fetch-time IP pinning, which the Workers
 * runtime doesn't expose pre-fetch. The literal-IP + internal-name checks cover
 * the realistic owner-probing case.
 */

/** Reject an IPv4 literal in a loopback / private / link-local / reserved range
 *  (incl. the cloud metadata endpoint 169.254.169.254). Returns false for
 *  non-IPv4 strings so the caller falls through to hostname checks. */
export function isBlockedIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]), b = Number(m[2]), c = Number(m[3]), d = Number(m[4]);
  if ([a, b, c, d].some((n) => n > 255)) return true; // malformed → reject
  return (
    a === 0 ||                            // 0.0.0.0/8 "this host"
    a === 10 ||                           // 10.0.0.0/8 private
    a === 127 ||                          // 127.0.0.0/8 loopback
    (a === 169 && b === 254) ||           // 169.254.0.0/16 link-local (+ metadata)
    (a === 172 && b >= 16 && b <= 31) ||  // 172.16.0.0/12 private
    (a === 192 && b === 168) ||           // 192.168.0.0/16 private
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT
    a >= 224                              // 224.0.0.0/4 multicast + 240/4 reserved
  );
}

/** True if a (already lower-cased, de-bracketed) host is an internal/loopback/
 *  private/metadata target that must never be fetched server-side. */
export function isBlockedHost(host: string): boolean {
  const blockedNames = new Set(['localhost', 'metadata.google.internal']);
  const blockedSuffixes = ['.local', '.internal', '.lan', '.localhost'];
  const isBlockedIpv6 =
    host === '::1' || host === '::' ||
    host.startsWith('fe80:') ||           // link-local
    host.startsWith('fc') || host.startsWith('fd') || // fc00::/7 unique-local
    host.startsWith('::ffff:127.') ||     // IPv4-mapped loopback
    host.startsWith('::ffff:10.') || host.startsWith('::ffff:192.168.');
  return (
    blockedNames.has(host) ||
    blockedSuffixes.some((s) => host.endsWith(s)) ||
    isBlockedIpv4(host) ||
    isBlockedIpv6
  );
}

/**
 * Validate a server-side-fetchable URL and return the parsed {@link URL}.
 * Throws on a malformed URL, a disallowed protocol, or an internal host.
 *
 * @param allowHttp  allow `http://` in addition to `https://` (default false —
 *                   https only). The Brain web fetch sets this so a user can
 *                   paste a plain-http link.
 */
export function assertSafeUrl(rawUrl: string, opts: { allowHttp?: boolean } = {}): URL {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error('URL must be a valid absolute URL');
  }
  const okProtocol = u.protocol === 'https:' || (opts.allowHttp === true && u.protocol === 'http:');
  if (!okProtocol) {
    throw new Error(opts.allowHttp ? 'URL must use http:// or https://' : 'URL must use https://');
  }
  // Normalise: strip IPv6 brackets, lowercase.
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isBlockedHost(host)) {
    throw new Error('URL must be a public host (internal/loopback/metadata addresses are not allowed)');
  }
  return u;
}
