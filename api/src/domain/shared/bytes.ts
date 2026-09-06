/**
 * Byte encodings — hex, base64, base64url — written ONCE.
 *
 * Before this module `bytes → hex` existed twenty times (`HashService` ×4,
 * `MfaService`, `oauthState`, `webauthn`, `readThroughCache`, `digest`,
 * `StripeProvider`, four route files, …) and base64url a dozen more, under names
 * like `toHex`, `hex`, `b64urlEncode`, `base64Url`, `bytesToBase64Url`. They
 * differed only in whether the author spelled the spread `[...bytes]` or
 * `Array.from(bytes)` — and in one detail that matters: some stripped padding
 * with `/=+$/` and some with `/=/g`, which agree on a base64 string and disagree
 * on nothing, so the drift was harmless right up to the day someone changed one.
 *
 * Pure and dependency-free, so domain, application and infrastructure code can
 * all read from here without one layer importing another. `crypto.getRandomValues`
 * is on the global in every runtime this deploys to (Workers, Node 18+, vitest).
 *
 * `String.fromCharCode(...bytes)` is deliberately NOT used: a spread argument list
 * over a large buffer (a 2 MB attachment) exceeds the engine's argument limit and
 * throws `RangeError: Maximum call stack size exceeded`. The loop costs nothing.
 */

type ByteInput = ArrayBuffer | ArrayBufferView;

function asUint8(input: ByteInput): Uint8Array {
  if (input instanceof Uint8Array) return input;
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  return new Uint8Array(input);
}

/** Lowercase, zero-padded hex. */
export function bytesToHex(input: ByteInput): string {
  const bytes = asUint8(input);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i]!.toString(16).padStart(2, '0');
  return out;
}

/** Inverse of {@link bytesToHex}. Odd-length or non-hex input yields an EMPTY
 *  array rather than a half-parsed one, so a caller comparing bytes fails closed. */
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (!clean || clean.length % 2 !== 0 || /[^0-9a-f]/.test(clean)) return new Uint8Array();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) out[i / 2] = Number.parseInt(clean.slice(i, i + 2), 16);
  return out;
}

/** Standard base64 (RFC 4648 §4), padded. */
export function bytesToBase64(input: ByteInput): string {
  const bytes = asUint8(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

/** Inverse of {@link bytesToBase64}. Accepts unpadded input. */
export function base64ToBytes(value: string): Uint8Array {
  const clean = value.replace(/\s+/g, '');
  const binary = atob(clean + '='.repeat((4 - (clean.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** base64url (RFC 4648 §5), UNPADDED — what JWS, PKCE and Gmail's `raw` all specify. */
export function bytesToBase64Url(input: ByteInput): string {
  return bytesToBase64(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Inverse of {@link bytesToBase64Url}. Tolerates padding and standard base64. */
export function base64UrlToBytes(value: string): Uint8Array {
  return base64ToBytes(value.replace(/-/g, '+').replace(/_/g, '/'));
}

/** UTF-8 text → base64url. The one encoding a JSON JWT segment needs. */
export function base64UrlEncode(text: string): string {
  return bytesToBase64Url(new TextEncoder().encode(text));
}

/** base64url → UTF-8 text. Throws on malformed input, like `atob` does. */
export function base64UrlDecode(value: string): string {
  return new TextDecoder().decode(base64UrlToBytes(value));
}

/** `byteLength` cryptographically random bytes. */
export function randomBytes(byteLength: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(byteLength));
}

/** `byteLength` random bytes as hex — `2 × byteLength` characters. */
export function randomHex(byteLength: number): string {
  return bytesToHex(randomBytes(byteLength));
}

/** `byteLength` random bytes as base64url — an opaque URL-safe token. */
export function randomBase64Url(byteLength: number): string {
  return bytesToBase64Url(randomBytes(byteLength));
}
