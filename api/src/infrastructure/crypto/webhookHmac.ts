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

import { timingSafeEqual } from './constantTime';
import { hmacBase64Url, hmacHex } from './hmac';

/** HMAC-SHA256(secret, body) as lowercase hex. The webhook-header form of {@link hmacHex}. */
export function hmacSha256Hex(secret: string, body: string): Promise<string> {
  return hmacHex(secret, body);
}

/** HMAC-SHA256(secret, body) as unpadded base64url — the JWT HS256 form of {@link hmacBase64Url}. */
export function hmacSha256Base64Url(secret: string, body: string): Promise<string> {
  return hmacBase64Url(secret, body);
}

/** Constant-time equal-length compare — {@link timingSafeEqual} under the name the
 *  webhook verifiers were written against. */
export const timingSafeEqualHex = timingSafeEqual;

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
