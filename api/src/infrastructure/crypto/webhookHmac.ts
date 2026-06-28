/**
 * Shared inbound-webhook HMAC primitives (Web Crypto — Worker-compatible).
 *
 * The single home for the low-level HMAC-SHA256 helpers used to verify signed
 * webhook bodies. Both the boardsync webhook ingest (Jira/GitHub/Sentry/…) and
 * the Quality error-ingest adapters (Sentry/PostHog/LogRocket) verify against a
 * per-connection/per-source secret — they share these primitives instead of each
 * re-deriving HMAC (DRY; a drift here would make one path silently accept forged
 * payloads the other rejects).
 */

/** Compute HMAC-SHA256(secret, body) as a lowercase hex string. */
export async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Compute HMAC-SHA256(secret, body) as a base64url string (no padding) — JWT HS256 form. */
export async function hmacSha256Base64Url(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  let bin = '';
  for (const b of new Uint8Array(mac)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Constant-time-ish equal-length string compare (avoids early-exit). */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Verify that `candidateHex` is a valid HMAC-SHA256 hex digest of `rawBody` under
 * `secret`. The candidate may carry a scheme prefix (e.g. `sha256=<hex>`); pass
 * `stripPrefix` to drop it first. Returns false on any malformed input rather than
 * throwing.
 */
export async function verifyHmacHex(
  rawBody: string,
  candidateHex: string,
  secret: string,
  stripPrefix?: string,
): Promise<boolean> {
  try {
    let expected = candidateHex.trim();
    if (stripPrefix) {
      if (!expected.startsWith(stripPrefix)) return false;
      expected = expected.slice(stripPrefix.length);
    }
    if (!expected) return false;
    return timingSafeEqualHex(await hmacSha256Hex(secret, rawBody), expected);
  } catch {
    return false;
  }
}
