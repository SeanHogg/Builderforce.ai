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
import { hkdfSha256 } from '../crypto/hkdf';

/** The signature is base64url — URL-safe, no padding. */
const hmac = (secret: string, message: string): Promise<string> => hmacBase64Url(secret, message);

/** Default validity window for a signed upload URL. */
export const SIGNED_URL_TTL_SECONDS = 600;

/** Validity of a PUBLISH signature (a podcast feed's audio and chapters): five years. See `signPublishAsset`. */
export const PUBLISH_URL_TTL_SECONDS = 5 * 365 * 24 * 60 * 60;

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

/** HKDF label of the dedicated PUBLISH-URL signing key. */
const PUBLISH_KEY_LABEL = 'bf-publish-url-v1';

/**
 * Sign a PUBLISH url (a podcast feed's audio / chapters, five-year expiry). It is keyed by an
 * HKDF-derived key, not `JWT_SECRET`, and the signed message carries a `publish|` domain
 * prefix, so a leaked long-lived link never helps forge a session token, and a ten-minute
 * upload signature can never be accepted as a publish one (or the reverse).
 */
export async function signPublishUpload(key: string, secret: string): Promise<{ exp: number; sig: string }> {
  const exp = Math.floor(Date.now() / 1000) + PUBLISH_URL_TTL_SECONDS;
  const sig = await hmacBase64Url(await hkdfSha256(secret, PUBLISH_KEY_LABEL), `publish|${key}|${exp}`);
  return { exp, sig };
}

/** Verify a {@link signPublishUpload} triple. Rejects on expiry or mismatch. */
export async function verifyPublishUpload(key: string, exp: number, sig: string, secret: string): Promise<boolean> {
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = await hmacBase64Url(await hkdfSha256(secret, PUBLISH_KEY_LABEL), `publish|${key}|${exp}`);
  return timingSafeEqual(expected, sig);
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
