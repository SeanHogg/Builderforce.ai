/**
 * The byte-format layer under passkeys.
 *
 * These are the parsers that stand between an attacker-supplied blob and a
 * signature check, so the properties that matter are: real structures decode to
 * the right values, and malformed ones THROW rather than yielding a plausible-
 * looking object built out of `undefined`. A truncated attestation that silently
 * produced a zero-length credential id would be the worst possible outcome here.
 *
 * The end-to-end assertion path is exercised with a REAL P-256 key pair generated
 * through WebCrypto, so `verifyWebAuthnSignature` is checked against a signature
 * this test did not fake — including the DER→raw conversion, which is the piece
 * most likely to be subtly wrong.
 */
import { describe, expect, it } from 'vitest';
import {
  COSE_ALG_ES256,
  base64UrlToBytes,
  bytesEqual,
  bytesToBase64Url,
  coseAlgorithmOf,
  decodeCbor,
  importCosePublicKey,
  parseAttestationObject,
  parseAuthenticatorData,
  parseClientData,
  rpIdFromOrigin,
  rpIdHash,
  verifyWebAuthnSignature,
} from './webauthn';

// ---------------------------------------------------------------------------
// Minimal CBOR ENCODER — test-only, so the decoder is checked against something
// other than itself.
// ---------------------------------------------------------------------------

function head(major: number, value: number): number[] {
  if (value < 24) return [(major << 5) | value];
  if (value < 0x100) return [(major << 5) | 24, value];
  if (value < 0x10000) return [(major << 5) | 25, value >> 8, value & 0xff];
  return [(major << 5) | 26, (value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

type Encodable = number | string | Uint8Array | Encodable[] | Map<Encodable, Encodable>;

function encode(value: Encodable): number[] {
  if (typeof value === 'number') {
    return value >= 0 ? head(0, value) : head(1, -1 - value);
  }
  if (typeof value === 'string') {
    const bytes = [...new TextEncoder().encode(value)];
    return [...head(3, bytes.length), ...bytes];
  }
  if (value instanceof Uint8Array) {
    return [...head(2, value.length), ...value];
  }
  if (Array.isArray(value)) {
    return [...head(4, value.length), ...value.flatMap(encode)];
  }
  const entries = [...value.entries()];
  return [...head(5, entries.length), ...entries.flatMap(([k, v]) => [...encode(k), ...encode(v)])];
}

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RP_ID = 'app.example.com';
const ORIGIN = `https://${RP_ID}`;

/** Build authenticator data with the flags and optional attested credential. */
async function authenticatorData(opts: {
  rpId?: string;
  userPresent?: boolean;
  userVerified?: boolean;
  backedUp?: boolean;
  signCount?: number;
  credential?: { id: Uint8Array; coseKey: Uint8Array; aaguid?: Uint8Array };
}): Promise<Uint8Array> {
  const hash = await rpIdHash(opts.rpId ?? RP_ID);
  let flags = 0;
  if (opts.userPresent !== false) flags |= 0x01;
  if (opts.userVerified) flags |= 0x04;
  if (opts.backedUp) flags |= 0x18; // backup eligible + backed up
  if (opts.credential) flags |= 0x40;

  const counter = new Uint8Array(4);
  new DataView(counter.buffer).setUint32(0, opts.signCount ?? 0, false);

  const parts: number[] = [...hash, flags, ...counter];
  if (opts.credential) {
    const idLength = new Uint8Array(2);
    new DataView(idLength.buffer).setUint16(0, opts.credential.id.length, false);
    parts.push(
      ...(opts.credential.aaguid ?? new Uint8Array(16)),
      ...idLength,
      ...opts.credential.id,
      ...opts.credential.coseKey,
    );
  }
  return new Uint8Array(parts);
}

function clientDataJson(input: { type: string; challenge: string; origin: string }): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(input));
}

/** A real P-256 pair, plus its public half as a COSE_Key. */
async function es256KeyPair() {
  // Workers types declare these as unions (`CryptoKey | CryptoKeyPair`,
  // `ArrayBuffer | JsonWebKey`) because the same call serves symmetric keys and
  // raw exports. The arguments here pick the asymmetric/JWK branch, so the
  // assertions state which branch rather than widening every use site.
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'],
  ) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey) as JsonWebKey;
  const coseKey = new Uint8Array(encode(new Map<Encodable, Encodable>([
    [1, 2],                                   // kty: EC2
    [3, COSE_ALG_ES256],                      // alg: ES256
    [-1, 1],                                  // crv: P-256
    [-2, base64UrlToBytes(jwk.x!)],           // x
    [-3, base64UrlToBytes(jwk.y!)],           // y
  ])));
  return { ...pair, coseKey };
}

// ---------------------------------------------------------------------------

describe('CBOR decoding', () => {
  it('round-trips the shapes WebAuthn actually uses', () => {
    const map = new Map<Encodable, Encodable>([
      ['fmt', 'none'],
      ['attStmt', new Map()],
      ['authData', bytes(1, 2, 3, 250)],
      ['count', 70_000],
      ['negative', -7],
    ]);
    const { value, bytesRead } = decodeCbor(new Uint8Array(encode(map)));

    expect(bytesRead).toBe(encode(map).length);
    expect(value).toBeInstanceOf(Map);
    const decoded = value as Map<unknown, unknown>;
    expect(decoded.get('fmt')).toBe('none');
    expect(decoded.get('count')).toBe(70_000);
    expect(decoded.get('negative')).toBe(-7);
    expect(bytesEqual(decoded.get('authData') as Uint8Array, bytes(1, 2, 3, 250))).toBe(true);
  });

  it('reports how many bytes ONE item consumed, so a trailing extension is not swallowed', () => {
    const item = encode(new Map<Encodable, Encodable>([[1, 2]]));
    const withTrailer = new Uint8Array([...item, 0xff, 0xff, 0xff]);
    expect(decodeCbor(withTrailer).bytesRead).toBe(item.length);
  });

  it('throws on a truncated byte string rather than returning a short one', () => {
    // Header says 8 bytes, only 2 follow.
    expect(() => decodeCbor(bytes(0x48, 0x01, 0x02))).toThrow(/truncated/i);
  });

  it('throws on empty input', () => {
    expect(() => decodeCbor(new Uint8Array())).toThrow(/truncated/i);
  });
});

describe('authenticator data', () => {
  it('reads flags, counter and the attested credential', async () => {
    const { coseKey } = await es256KeyPair();
    const id = bytes(9, 8, 7, 6, 5);
    const aaguid = new Uint8Array(16).fill(0xab);
    const data = await authenticatorData({ userVerified: true, backedUp: true, signCount: 42, credential: { id, coseKey, aaguid } });

    const parsed = parseAuthenticatorData(data);
    expect(parsed.userPresent).toBe(true);
    expect(parsed.userVerified).toBe(true);
    expect(parsed.backupEligible).toBe(true);
    expect(parsed.backedUp).toBe(true);
    expect(parsed.signCount).toBe(42);
    expect(parsed.aaguid).toBe('abababab-abab-abab-abab-abababababab');
    expect(bytesEqual(parsed.credentialId!, id)).toBe(true);
    // The COSE key is taken by the length the decoder consumed, not "the rest".
    expect(bytesEqual(parsed.credentialPublicKey!, coseKey)).toBe(true);
  });

  it('leaves the credential null when the attested-data flag is clear', async () => {
    const parsed = parseAuthenticatorData(await authenticatorData({ signCount: 3 }));
    expect(parsed.credentialId).toBeNull();
    expect(parsed.credentialPublicKey).toBeNull();
  });

  it('throws when the buffer is shorter than the fixed header', () => {
    expect(() => parseAuthenticatorData(new Uint8Array(30))).toThrow(/too short/i);
  });

  it('throws when the credential id runs past the end', async () => {
    const hash = await rpIdHash(RP_ID);
    const idLength = bytes(0xff, 0xff); // claims 65535 bytes
    const truncated = new Uint8Array([...hash, 0x41, 0, 0, 0, 0, ...new Uint8Array(16), ...idLength, 1, 2]);
    expect(() => parseAuthenticatorData(truncated)).toThrow(/truncated/i);
  });
});

describe('COSE keys', () => {
  it('imports a real ES256 key and reports its algorithm', async () => {
    const { coseKey } = await es256KeyPair();
    expect(coseAlgorithmOf(coseKey)).toBe(COSE_ALG_ES256);
    const { key, algorithm } = await importCosePublicKey(coseKey);
    expect(algorithm).toBe(COSE_ALG_ES256);
    expect(key.type).toBe('public');
  });

  it('refuses an algorithm this platform does not accept', async () => {
    const eddsa = new Uint8Array(encode(new Map<Encodable, Encodable>([[1, 1], [3, -8], [-1, 6], [-2, new Uint8Array(32)]])));
    await expect(importCosePublicKey(eddsa)).rejects.toThrow(/Unsupported COSE algorithm/);
  });

  it('refuses an ES256 key that claims the wrong curve', async () => {
    const wrongCurve = new Uint8Array(encode(new Map<Encodable, Encodable>([
      [1, 2], [3, COSE_ALG_ES256], [-1, 2], [-2, new Uint8Array(32)], [-3, new Uint8Array(32)],
    ])));
    await expect(importCosePublicKey(wrongCurve)).rejects.toThrow(/P-256/);
  });
});

describe('signature verification', () => {
  it('accepts a signature this test really produced, DER conversion included', async () => {
    const { privateKey, coseKey } = await es256KeyPair();
    const authData = await authenticatorData({ signCount: 1 });
    const clientData = clientDataJson({ type: 'webauthn.get', challenge: 'abc', origin: ORIGIN });

    const clientHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientData));
    const payload = new Uint8Array([...authData, ...clientHash]);
    // WebCrypto signs raw r‖s; the authenticator would send DER, so re-encode to
    // exercise the branch the real path takes.
    const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, payload));
    const der = rawToDer(raw);

    await expect(verifyWebAuthnSignature({
      coseKey, signature: der, authenticatorData: authData, clientDataJson: clientData,
    })).resolves.toBe(true);
  });

  it('rejects a signature over different authenticator data', async () => {
    const { privateKey, coseKey } = await es256KeyPair();
    const signed = await authenticatorData({ signCount: 1 });
    const presented = await authenticatorData({ signCount: 2 });
    const clientData = clientDataJson({ type: 'webauthn.get', challenge: 'abc', origin: ORIGIN });

    const clientHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientData));
    const raw = new Uint8Array(await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' }, privateKey, new Uint8Array([...signed, ...clientHash]),
    ));

    await expect(verifyWebAuthnSignature({
      coseKey, signature: rawToDer(raw), authenticatorData: presented, clientDataJson: clientData,
    })).resolves.toBe(false);
  });
});

describe('clientDataJSON and the relying party', () => {
  it('reads the three members that are load-bearing', () => {
    const parsed = parseClientData(clientDataJson({ type: 'webauthn.create', challenge: 'xyz', origin: ORIGIN }));
    expect(parsed).toMatchObject({ type: 'webauthn.create', challenge: 'xyz', origin: ORIGIN });
  });

  it('throws when a required member is missing', () => {
    const missing = new TextEncoder().encode(JSON.stringify({ type: 'webauthn.get', origin: ORIGIN }));
    expect(() => parseClientData(missing)).toThrow(/missing a required member/i);
  });

  it('derives the RP id from the app origin, not from anything the client sends', () => {
    expect(rpIdFromOrigin('https://app.example.com/some/path')).toBe('app.example.com');
    expect(rpIdFromOrigin('https://example.com')).toBe('example.com');
  });

  it('compares byte strings in constant time and length-safely', () => {
    expect(bytesEqual(bytes(1, 2, 3), bytes(1, 2, 3))).toBe(true);
    expect(bytesEqual(bytes(1, 2, 3), bytes(1, 2, 4))).toBe(false);
    expect(bytesEqual(bytes(1, 2), bytes(1, 2, 3))).toBe(false);
  });
});

describe('attestation objects', () => {
  it('pulls the credential out of a "none" attestation', async () => {
    const { coseKey } = await es256KeyPair();
    const id = bytes(4, 4, 4, 4);
    const authData = await authenticatorData({ credential: { id, coseKey } });
    const attestation = new Uint8Array(encode(new Map<Encodable, Encodable>([
      ['fmt', 'none'], ['attStmt', new Map()], ['authData', authData],
    ])));

    const parsed = parseAttestationObject(attestation);
    expect(parsed.format).toBe('none');
    expect(bytesEqual(parsed.authenticatorData.credentialId!, id)).toBe(true);
    expect(bytesEqual(parsed.rawAuthenticatorData, authData)).toBe(true);
  });

  it('throws when authData is absent', () => {
    const noAuthData = new Uint8Array(encode(new Map<Encodable, Encodable>([['fmt', 'none']])));
    expect(() => parseAttestationObject(noAuthData)).toThrow(/no authData/i);
  });
});

describe('base64url', () => {
  it('round-trips bytes that need padding and contain URL-unsafe characters', () => {
    for (const length of [1, 2, 3, 31, 32, 64]) {
      const value = new Uint8Array(length);
      crypto.getRandomValues(value);
      const encoded = bytesToBase64Url(value);
      expect(encoded).not.toMatch(/[+/=]/);
      expect(bytesEqual(base64UrlToBytes(encoded), value)).toBe(true);
    }
  });
});

/** Raw r‖s → DER, so the test can hand the verifier what an authenticator sends. */
function rawToDer(raw: Uint8Array): Uint8Array {
  const trim = (part: Uint8Array): number[] => {
    let i = 0;
    while (i < part.length - 1 && part[i] === 0) i += 1;
    const slice = [...part.subarray(i)];
    // DER integers are signed: a leading high bit needs a zero byte in front.
    return (slice[0]! & 0x80) ? [0, ...slice] : slice;
  };
  const r = trim(raw.subarray(0, 32));
  const s = trim(raw.subarray(32, 64));
  const body = [0x02, r.length, ...r, 0x02, s.length, ...s];
  return new Uint8Array([0x30, body.length, ...body]);
}
