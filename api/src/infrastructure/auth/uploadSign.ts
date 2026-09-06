/**
 * Short-lived signed URLs for R2 uploads.
 *
 * The authenticated `GET /api/brain/uploads/:key` path requires a tenant JWT —
 * fine for the browser rendering its own history, but an upstream LLM provider
 * fetching an `image_url` has no token. For the rare image too large to inline
 * as a data URL, we instead hand the provider a time-boxed, HMAC-signed URL on a
 * public route (`/api/brain-files/...`) that proves the bearer was authorized to
 * read this exact key for a short window — without exposing the whole bucket.
 *
 * The HMAC is keyed by `JWT_SECRET` (already a deployed secret); the signed
 * payload is `key|exp` so a signature can't be replayed against a different
 * object or past its expiry.
 */

import { timingSafeEqual } from '../crypto/constantTime';
import { hmacBase64Url } from '../crypto/hmac';

/** The signature is base64url — URL-safe, no padding. */
const hmac = (secret: string, message: string): Promise<string> => hmacBase64Url(secret, message);

/** Default validity window for a signed upload URL. */
export const SIGNED_URL_TTL_SECONDS = 600;

/** Produce `{ exp, sig }` for `key`, valid for `ttlSeconds` from now. */
export async function signUpload(
  key: string,
  secret: string,
  ttlSeconds = SIGNED_URL_TTL_SECONDS,
): Promise<{ exp: number; sig: string }> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = await hmac(secret, `${key}|${exp}`);
  return { exp, sig };
}

/** Constant-time-ish verify of a signed-upload triple. Rejects on expiry or mismatch. */
export async function verifyUpload(
  key: string,
  exp: number,
  sig: string,
  secret: string,
): Promise<boolean> {
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  return timingSafeEqual(await hmac(secret, `${key}|${exp}`), sig);
}
