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

/** Reject an IPv6 literal in a loopback / link-local / unique-local / IPv4-mapped
 *  private range. Input should be lower-cased + de-bracketed. Returns false for a
 *  non-matching / non-IPv6 string. */
export function isBlockedIpv6(host: string): boolean {
  return (
    host === '::1' || host === '::' ||
    host.startsWith('fe80:') ||           // link-local
    host.startsWith('fc') || host.startsWith('fd') || // fc00::/7 unique-local
    host.startsWith('::ffff:127.') ||     // IPv4-mapped loopback
    host.startsWith('::ffff:10.') || host.startsWith('::ffff:192.168.') ||
    host.startsWith('::ffff:169.254.')    // IPv4-mapped link-local / metadata
  );
}

/** True if a (already lower-cased, de-bracketed) host is an internal/loopback/
 *  private/metadata target that must never be fetched server-side. */
export function isBlockedHost(host: string): boolean {
  const blockedNames = new Set(['localhost', 'metadata.google.internal']);
  const blockedSuffixes = ['.local', '.internal', '.lan', '.localhost'];
  return (
    blockedNames.has(host) ||
    blockedSuffixes.some((s) => host.endsWith(s)) ||
    isBlockedIpv4(host) ||
    isBlockedIpv6(host)
  );
}

/** Thrown when a URL/host resolves (literally or via DNS) to a blocked address. */
export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedUrlError';
  }
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

/**
 * DNS-rebinding guard (best-effort). Closes the residual documented above: a
 * PUBLIC hostname that DNS-resolves to a PRIVATE IP passes {@link assertSafeUrl}
 * (which only sees the literal name) but must never be fetched. The Workers
 * runtime doesn't expose fetch-time IP pinning, so we resolve the name OURSELVES
 * over DNS-over-HTTPS (Cloudflare `dns-query`, JSON), then run the same
 * {@link isBlockedIpv4}/{@link isBlockedIpv6} range checks on every answer.
 *
 * FAILS OPEN by design: a DoH lookup that errors/times out does NOT block the
 * request — {@link assertSafeUrl} already rejects literal private IPs and internal
 * names, so this is a defence-in-depth layer, not the primary guard. It throws
 * {@link BlockedUrlError} ONLY when it positively resolves a private address.
 *
 * @throws {BlockedUrlError} when any resolved A/AAAA record is a private/blocked IP.
 */
export async function resolveAndAssertPublic(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  // A literal IP is already covered by assertSafeUrl — no name to resolve.
  if (isBlockedIpv4(host) || isBlockedIpv6(host) || host === 'localhost') return;

  const ips = await resolveHostIps(host);
  // Empty = the DoH lookup failed or returned nothing → fail OPEN (see doc above).
  for (const ip of ips) {
    const norm = ip.toLowerCase();
    if (isBlockedIpv4(norm) || isBlockedIpv6(norm)) {
      throw new BlockedUrlError(
        `Host ${host} resolves to a private address (${ip}) — refusing to fetch (possible DNS rebinding).`,
      );
    }
  }
}

/** Resolve a hostname's A + AAAA records via DNS-over-HTTPS. Returns [] on any
 *  failure (network error, timeout, non-OK, malformed) so callers fail OPEN. */
async function resolveHostIps(host: string): Promise<string[]> {
  const query = async (type: 'A' | 'AAAA'): Promise<string[]> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOH_TIMEOUT_MS);
    try {
      const res = await fetch(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`,
        { headers: { Accept: 'application/dns-json' }, signal: controller.signal },
      );
      if (!res.ok) return [];
      const body = (await res.json()) as { Answer?: Array<{ type?: number; data?: string }> };
      // A = record type 1, AAAA = 28. Only take address answers (skip CNAME chains).
      return (body.Answer ?? [])
        .filter((a) => (type === 'A' ? a.type === 1 : a.type === 28) && typeof a.data === 'string')
        .map((a) => (a.data as string).trim());
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  };
  const [a, aaaa] = await Promise.all([query('A'), query('AAAA')]);
  return [...a, ...aaaa];
}

const DOH_TIMEOUT_MS = 3_000;
