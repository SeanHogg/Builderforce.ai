/**
 * HMAC over Web Crypto — the ONE `importKey` + `sign`.
 *
 * Fourteen modules had written these lines: nine in application code (guest
 * tokens, preview and container-run tokens, outbound webhook signing, the
 * NetSuite OAuth 1.0a signer, AWS SigV4, Twilio verification, the workflow
 * trigger verifier) and five in infrastructure (JWTs, MFA, OAuth state, upload
 * URLs, Stripe). Each was correct; each was a place the next reader had to
 * re-verify was correct. A MAC primitive with fourteen copies is fourteen
 * chances to pass `['verify']` where `['sign']` was meant, or SHA-1 where the
 * vendor moved to SHA-256.
 *
 * Encodings come from `domain/shared/bytes` so this file holds nothing but the
 * key import and the sign call. Constant-time comparison is `constantTime.ts`;
 * webhook-shaped verification (`sha256=<hex>` headers) is `webhookHmac.ts`.
 */
import { bytesToBase64, bytesToBase64Url, bytesToHex } from '../../domain/shared/bytes';

export type HmacHash = 'SHA-1' | 'SHA-256' | 'SHA-512';

type Secret = string | ArrayBuffer | ArrayBufferView;
type Message = string | ArrayBuffer | ArrayBufferView;

const encoder = new TextEncoder();

function keyBytes(secret: Secret): BufferSource {
  return typeof secret === 'string' ? encoder.encode(secret) : (secret as BufferSource);
}

function messageBytes(message: Message): BufferSource {
  return typeof message === 'string' ? encoder.encode(message) : (message as BufferSource);
}

/** Import `secret` as an HMAC key. Non-extractable, like every caller wanted. */
export function importHmacKey(
  secret: Secret,
  usages: ('sign' | 'verify')[] = ['sign'],
  hash: HmacHash = 'SHA-256',
): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', keyBytes(secret), { name: 'HMAC', hash }, false, usages);
}

/** Raw MAC bytes. */
export async function hmacSign(secret: Secret, message: Message, hash: HmacHash = 'SHA-256'): Promise<ArrayBuffer> {
  const key = await importHmacKey(secret, ['sign'], hash);
  return crypto.subtle.sign('HMAC', key, messageBytes(message));
}

/** MAC as lowercase hex — the webhook-header form. */
export async function hmacHex(secret: Secret, message: Message, hash: HmacHash = 'SHA-256'): Promise<string> {
  return bytesToHex(await hmacSign(secret, message, hash));
}

/** MAC as unpadded base64url — the JWS HS256 form. */
export async function hmacBase64Url(secret: Secret, message: Message, hash: HmacHash = 'SHA-256'): Promise<string> {
  return bytesToBase64Url(await hmacSign(secret, message, hash));
}

/** MAC as padded base64 — the OAuth 1.0a and Twilio form. */
export async function hmacBase64(secret: Secret, message: Message, hash: HmacHash = 'SHA-256'): Promise<string> {
  return bytesToBase64(await hmacSign(secret, message, hash));
}

/** Verify raw signature bytes against `message` under `secret`. */
export async function hmacVerify(
  secret: Secret,
  message: Message,
  signature: ArrayBuffer | ArrayBufferView,
  hash: HmacHash = 'SHA-256',
): Promise<boolean> {
  const key = await importHmacKey(secret, ['verify'], hash);
  return crypto.subtle.verify('HMAC', key, signature as BufferSource, messageBytes(message));
}
