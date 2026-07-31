import { describe, it, expect } from 'vitest';
import { pkcs1ToPkcs8, pemToPkcs8Der, mintAppJwt, installationTokenCacheKey } from './githubApp';

/**
 * The PKCS#1 → PKCS#8 conversion is the one piece of githubApp.ts that cannot be
 * verified by reading it: a single wrong DER length byte produces an opaque
 * WebCrypto `DataError: Invalid key data` with no indication of which byte is
 * bad, and it would only surface in production the first time a tenant installed
 * the App.
 *
 * The round-trip test below is the strong form of the check. Rather than trusting
 * a hand-written fixture, it generates a real RSA key, exports the genuine PKCS#8
 * DER, strips the envelope down to the inner PKCS#1 body, re-wraps it with our
 * own function, and asserts the bytes come back IDENTICAL to what WebCrypto
 * produced. If our envelope differs from the real one in any byte, this fails.
 */

const te = new TextEncoder();

async function generateRsaKey(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  ) as Promise<CryptoKeyPair>;
}

/**
 * `crypto.subtle.exportKey` is typed as `ArrayBuffer | JsonWebKey` because the
 * format is only known at runtime; the 'pkcs8' format always yields an
 * ArrayBuffer, so narrow it once here rather than casting at nine call sites.
 */
async function exportPkcs8(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array((await crypto.subtle.exportKey('pkcs8', key)) as ArrayBuffer);
}

/** Read a DER length at `offset`; returns the value and how many bytes it used. */
function readDerLength(bytes: Uint8Array, offset: number): { length: number; bytesRead: number } {
  const first = bytes[offset]!;
  if (first < 0x80) return { length: first, bytesRead: 1 };
  const count = first & 0x7f;
  let length = 0;
  for (let i = 0; i < count; i++) length = (length << 8) | bytes[offset + 1 + i]!;
  return { length, bytesRead: 1 + count };
}

/**
 * Pull the inner PKCS#1 RSAPrivateKey out of a PKCS#8 PrivateKeyInfo — i.e. the
 * exact inverse of what pkcs1ToPkcs8 does, so the two composed must be identity.
 */
function extractPkcs1FromPkcs8(pkcs8: Uint8Array): Uint8Array {
  let o = 0;
  expect(pkcs8[o]).toBe(0x30); // outer SEQUENCE
  o += 1 + readDerLength(pkcs8, o + 1).bytesRead;

  expect(pkcs8[o]).toBe(0x02); // version INTEGER
  o += 2 + pkcs8[o + 1]!;

  expect(pkcs8[o]).toBe(0x30); // AlgorithmIdentifier SEQUENCE
  const alg = readDerLength(pkcs8, o + 1);
  o += 1 + alg.bytesRead + alg.length;

  expect(pkcs8[o]).toBe(0x04); // OCTET STRING wrapping the PKCS#1 body
  const oct = readDerLength(pkcs8, o + 1);
  const start = o + 1 + oct.bytesRead;
  return pkcs8.slice(start, start + oct.length);
}

function toPem(label: string, der: Uint8Array): string {
  let bin = '';
  for (const b of der) bin += String.fromCharCode(b);
  const b64 = btoa(bin).replace(/(.{64})/g, '$1\n');
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`;
}

describe('pkcs1ToPkcs8', () => {
  it('re-wraps a PKCS#1 body into byte-identical PKCS#8', async () => {
    const { privateKey } = await generateRsaKey();
    const realPkcs8 = await exportPkcs8(privateKey);

    const pkcs1 = extractPkcs1FromPkcs8(realPkcs8);
    const rebuilt = pkcs1ToPkcs8(pkcs1);

    expect(Array.from(rebuilt)).toEqual(Array.from(realPkcs8));
  });

  it('produces DER that WebCrypto actually accepts', async () => {
    const { privateKey } = await generateRsaKey();
    const realPkcs8 = await exportPkcs8(privateKey);
    const rebuilt = pkcs1ToPkcs8(extractPkcs1FromPkcs8(realPkcs8));

    // The real assertion: importKey does not throw. This is the failure mode the
    // conversion exists to prevent.
    await expect(
      crypto.subtle.importKey(
        'pkcs8',
        rebuilt.slice().buffer as ArrayBuffer,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign'],
      ),
    ).resolves.toBeDefined();
  });

  it('uses DER long-form length encoding for a 2048-bit key', async () => {
    // A 2048-bit PKCS#1 body is ~1190 bytes, well over the 127-byte short-form
    // limit — so this exercises the multi-byte length path, which is where a
    // naive implementation breaks.
    const { privateKey } = await generateRsaKey();
    const realPkcs8 = await exportPkcs8(privateKey);
    const pkcs1 = extractPkcs1FromPkcs8(realPkcs8);

    expect(pkcs1.length).toBeGreaterThan(127);
    const rebuilt = pkcs1ToPkcs8(pkcs1);
    expect(rebuilt[1]! & 0x80).toBe(0x80); // long form flag set
  });
});

describe('pemToPkcs8Der', () => {
  it('accepts a PKCS#1 PEM (the form GitHub issues)', async () => {
    const { privateKey } = await generateRsaKey();
    const realPkcs8 = await exportPkcs8(privateKey);
    const pem = toPem('RSA PRIVATE KEY', extractPkcs1FromPkcs8(realPkcs8));

    const out = pemToPkcs8Der(pem);
    expect(out.ok).toBe(true);
    if (out.ok) expect(Array.from(out.der)).toEqual(Array.from(realPkcs8));
  });

  it('accepts a PKCS#8 PEM unchanged', async () => {
    const { privateKey } = await generateRsaKey();
    const realPkcs8 = await exportPkcs8(privateKey);

    const out = pemToPkcs8Der(toPem('PRIVATE KEY', realPkcs8));
    expect(out.ok).toBe(true);
    if (out.ok) expect(Array.from(out.der)).toEqual(Array.from(realPkcs8));
  });

  it('tolerates escaped newlines from secret stores that mangle PEMs', async () => {
    const { privateKey } = await generateRsaKey();
    const realPkcs8 = await exportPkcs8(privateKey);
    const mangled = toPem('PRIVATE KEY', realPkcs8).replace(/\n/g, '\\n');

    const out = pemToPkcs8Der(mangled);
    expect(out.ok).toBe(true);
  });

  it('rejects a non-PEM with a reason rather than throwing', () => {
    const out = pemToPkcs8Der('not a key at all');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/not a recognised PEM/i);
  });
});

describe('mintAppJwt', () => {
  it('mints a JWT that verifies against the matching public key', async () => {
    const { privateKey, publicKey } = await generateRsaKey();
    const pem = toPem('PRIVATE KEY', await exportPkcs8(privateKey));

    const now = 1_700_000_000;
    const res = await mintAppJwt({ appId: '12345', privateKeyPem: pem }, now);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const [h, p, s] = res.value.split('.');
    expect(h && p && s).toBeTruthy();

    const sig = Uint8Array.from(
      atob(s!.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s!.length % 4)) % 4)),
      (c) => c.charCodeAt(0),
    );
    const verified = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      sig,
      te.encode(`${h}.${p}`),
    );
    expect(verified).toBe(true);
  });

  it('backdates iat and stays inside GitHub’s 10-minute exp ceiling', async () => {
    const { privateKey } = await generateRsaKey();
    const pem = toPem('PRIVATE KEY', await exportPkcs8(privateKey));

    const now = 1_700_000_000;
    const res = await mintAppJwt({ appId: '999', privateKeyPem: pem }, now);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const payload = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(res.value.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
      ),
    ) as { iat: number; exp: number; iss: string };

    expect(payload.iss).toBe('999');
    // Backdated against clock skew — GitHub rejects a future iat outright.
    expect(payload.iat).toBeLessThan(now);
    // GitHub rejects anything over 10 minutes.
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(600);
  });

  it('returns a tagged bad_key error instead of throwing on a garbage key', async () => {
    const res = await mintAppJwt({ appId: '1', privateKeyPem: 'garbage' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('bad_key');
  });
});

describe('installationTokenCacheKey', () => {
  it('scopes the key by app AND installation so two apps never collide', () => {
    expect(installationTokenCacheKey('app1', 7)).toBe('gh-app-token:app1:7');
    expect(installationTokenCacheKey('app2', 7)).not.toBe(installationTokenCacheKey('app1', 7));
  });
});
