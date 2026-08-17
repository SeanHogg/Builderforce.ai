/**
 * AES-256-GCM encryption for arbitrary file BYTES (Web Crypto — Cloudflare Workers).
 *
 * `credentialCrypto.ts` proved the KDF (PBKDF2, 100k, SHA-256, per-tenant salt) for
 * a JSON credential blob; it JSON.stringifies its payload before sealing, which
 * makes it wrong for a binary upload. `deriveTenantAesKey` is the exported
 * extension point for exactly this — a second container format sharing the same
 * key derivation rather than a second KDF. This is that second container: raw
 * `Uint8Array` in, raw `Uint8Array` out, IV carried in the ciphertext rather than
 * beside it (a file has no sibling column to hold one).
 *
 * Callers pass their OWN secret via `credentialSecret(env)` (same resolution order
 * as every other at-rest secret: CREDENTIAL_ENCRYPTION_SECRET ??
 * INTEGRATION_ENCRYPTION_SECRET ?? JWT_SECRET) — no new secret to provision.
 */

import { deriveTenantAesKey } from '../integrations/credentialCrypto';

/** Version byte prefixed to every sealed blob, so a future KDF/cipher change can
 *  be introduced without breaking rows sealed under this one. */
const VERSION_V1 = 1;
const IV_BYTES = 12;

/**
 * Encrypt `bytes` under a key derived from `secret` and `tenantId`. Output layout:
 * `[version:1][iv:12][ciphertext+tag:...]` — self-describing, so `unsealBytes`
 * needs nothing but the sealed blob and the same secret/tenant.
 */
export async function sealBytes(bytes: Uint8Array, secret: string, tenantId: number): Promise<Uint8Array> {
  const key = await deriveTenantAesKey(secret, tenantId);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  const cipher = new Uint8Array(cipherBuf);

  const out = new Uint8Array(1 + IV_BYTES + cipher.byteLength);
  out[0] = VERSION_V1;
  out.set(iv, 1);
  out.set(cipher, 1 + IV_BYTES);
  return out;
}

/**
 * Decrypt a blob produced by {@link sealBytes}. Throws on a wrong key, a
 * tampered blob, or an unrecognised version byte — there is no silent partial
 * result for file content the way `decryptCredentials` can return `null` for a
 * best-effort JSON read.
 */
export async function unsealBytes(sealed: Uint8Array, secret: string, tenantId: number): Promise<Uint8Array> {
  if (sealed.byteLength < 1 + IV_BYTES) throw new Error('Sealed blob is too short to contain a version and an IV.');
  const version = sealed[0];
  if (version !== VERSION_V1) throw new Error(`Unrecognised seal version: ${version}`);
  const iv = sealed.subarray(1, 1 + IV_BYTES);
  const cipher = sealed.subarray(1 + IV_BYTES);

  const key = await deriveTenantAesKey(secret, tenantId);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return new Uint8Array(plainBuf);
}
