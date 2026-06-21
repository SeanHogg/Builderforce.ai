import { describe, expect, it } from 'vitest';
import { encryptCredentials, decryptCredentials } from './credentialCrypto';

const SECRET = 'test-base-secret-do-not-use-in-prod';
const SALT_BASE = 'builderforce-integrations';

/**
 * Build a LEGACY v1 blob the way the pre-versioning code did: global salt (no
 * tenant), no version prefix. Mirrors the old encryptCredentials so the test
 * proves real backward compatibility (old rows still decrypt) without reaching
 * into the module internals.
 */
async function legacyV1Encrypt(data: Record<string, unknown>, secret: string): Promise<{ enc: string; iv: string }> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode(SALT_BASE), iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(data)));
  return {
    enc: btoa(String.fromCharCode(...new Uint8Array(ct))), // NO version prefix → legacy v1
    iv: Array.from(iv).map((b) => b.toString(16).padStart(2, '0')).join(''),
  };
}

describe('credentialCrypto per-tenant AES-256-GCM', () => {
  it('v2 encrypt → decrypt round-trips for the SAME tenant', async () => {
    const data = { accessToken: 'tok-abc', refreshToken: 'ref-xyz' };
    const { enc, iv } = await encryptCredentials(data, SECRET, 42);
    expect(enc.startsWith('v2:')).toBe(true);
    const out = await decryptCredentials(enc, iv, SECRET, 42);
    expect(out).toEqual(data);
  });

  it('a DIFFERENT tenant cannot decrypt another tenant\'s v2 ciphertext', async () => {
    const data = { accessToken: 'secret-of-tenant-1' };
    const { enc, iv } = await encryptCredentials(data, SECRET, 1);
    // Same base secret, different tenant id → different derived key → null.
    const out = await decryptCredentials(enc, iv, SECRET, 2);
    expect(out).toBeNull();
  });

  it('a v2 blob is undecryptable without a tenant id', async () => {
    const { enc, iv } = await encryptCredentials({ accessToken: 'x' }, SECRET, 7);
    const out = await decryptCredentials(enc, iv, SECRET); // no tenantId
    expect(out).toBeNull();
  });

  it('a legacy v1 (global-key) blob still decrypts', async () => {
    const data = { accessToken: 'legacy-token', apiToken: 'legacy-api' };
    const legacy = await legacyV1Encrypt(data, SECRET);
    expect(legacy.enc.startsWith('v2:')).toBe(false);
    // No tenantId needed — legacy rows used the global salt.
    const out = await decryptCredentials(legacy.enc, legacy.iv, SECRET);
    expect(out).toEqual(data);
    // ...and decrypting a legacy row WITH a tenantId still works (the marker, not
    // the arg, selects the salt) — so callers can always pass tenantId safely.
    const outWithTenant = await decryptCredentials(legacy.enc, legacy.iv, SECRET, 99);
    expect(outWithTenant).toEqual(data);
  });

  it('an explicit v1: prefixed blob decrypts via the global key', async () => {
    const data = { accessToken: 'prefixed-legacy' };
    const legacy = await legacyV1Encrypt(data, SECRET);
    const out = await decryptCredentials(`v1:${legacy.enc}`, legacy.iv, SECRET);
    expect(out).toEqual(data);
  });
});
