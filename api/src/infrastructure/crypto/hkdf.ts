/**
 * HKDF-SHA256 over Web Crypto — derive a purpose-bound key from a master secret.
 *
 * Use this when a feature must not sign or encrypt with a secret that already
 * has another job (the JWT key): the `info` label binds the derived key to one
 * purpose, so a leak of the derived key does not reveal the master and the same
 * master yields unrelated keys for unrelated labels.
 */

const encoder = new TextEncoder();

export async function hkdfSha256(secret: string, info: string, lengthBytes = 32): Promise<Uint8Array> {
  const ikm = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: encoder.encode(info) },
    ikm,
    lengthBytes * 8,
  );
  return new Uint8Array(bits);
}
