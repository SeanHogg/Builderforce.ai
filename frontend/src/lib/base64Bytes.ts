/**
 * Bytes ↔ base64, both directions, plus the URL-safe (base64url, unpadded) spelling —
 * the ONE copy for the frontend. `btoa`/`atob` speak "binary strings", so every caller
 * used to hand-roll the byte loop around them (skill folders, model uploads, passkeys,
 * diagrams, visitor tokens).
 *
 * Encoding goes in 32 KB chunks: spreading a whole large buffer into
 * `String.fromCharCode(...)` overflows the call stack.
 */

const CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

/** Throws on input that is not base64 (as `atob` does); callers that tolerate junk catch. */
export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return base64ToBytes(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='));
}
