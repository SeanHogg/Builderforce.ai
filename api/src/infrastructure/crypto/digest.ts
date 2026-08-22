/**
 * SHA-256, in the two encodings this codebase actually asks for.
 *
 * Eleven modules had written the same three lines — `crypto.subtle.digest`, then
 * a `Uint8Array` walked into padded hex — and several had quietly added a
 * `.slice(…)` to shorten the result, which is the version that matters: a
 * fingerprint truncated to 16 hex characters in one file and 40 in another looks
 * like a preference and is really a collision budget, and nowhere said so.
 *
 * Workers-native: `crypto.subtle` is on the global in every runtime this deploys
 * to, so this needs no dependency and works identically in the isolate, in a
 * Durable Object and under vitest.
 *
 * NOT a password primitive. A raw digest is fast by design, which is exactly what
 * makes it wrong for anything an attacker can guess at — passwords and API
 * secrets go through the platform's credential crypto, never through here.
 */

type Digestible = string | ArrayBuffer | ArrayBufferView;

function bytes(value: Digestible): ArrayBuffer | ArrayBufferView {
  return typeof value === 'string' ? new TextEncoder().encode(value) : value;
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The full digest as 64 lowercase hex characters. */
export async function sha256Hex(value: Digestible): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', bytes(value) as BufferSource));
}

/**
 * A shortened fingerprint — the first `length` hex characters.
 *
 * Truncation is a collision budget, so state it at the call site rather than
 * leaving a bare `.slice(16)` for the next reader to price. 16 characters is 64
 * bits, fine for a cache key or a de-duplication slug within one tenant; 40 is
 * SHA-1's width, which is what a caller mirroring an external format usually
 * wants. Below 16 the birthday bound starts to matter at ordinary volumes, so
 * this refuses rather than silently issuing a key that will collide.
 */
export async function sha256Fingerprint(value: Digestible, length = 16): Promise<string> {
  if (length < 16 || length > 64) {
    throw new Error(`sha256Fingerprint: length must be 16–64 hex chars, got ${length}`);
  }
  return (await sha256Hex(value)).slice(0, length);
}

/** Base64url, unpadded — the encoding OAuth PKCE and JWS both specify. */
export async function sha256Base64Url(value: Digestible): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes(value) as BufferSource);
  let binary = '';
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
