/**
 * The passkey use cases — the decisions, not the byte formats.
 *
 * `webauthn.test.ts` covers parsing and signature verification. What is proved
 * here is the security posture this service claims in its own header:
 *
 *   · a challenge can be consumed exactly once, and the DATABASE settles that;
 *   · an assertion from another origin is refused, which is the whole reason a
 *     passkey is unphishable;
 *   · an assertion for another relying party is refused;
 *   · an assertion produced without the human present is refused;
 *   · a sign-counter regression is RECORDED and does NOT refuse — the one place
 *     this implementation deliberately differs from a strict reading of the spec;
 *   · `beginPasskeyAuthentication` does not become an account-existence oracle.
 *
 * A real P-256 pair signs the assertions, so nothing here is verified against a
 * stub of our own verifier.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  PasskeyError,
  beginPasskeyAuthentication,
  relyingPartyFor,
  verifyPasskeyAssertion,
} from './PasskeyService';
import { base64UrlToBytes, bytesToBase64Url, rpIdHash } from '../../infrastructure/auth/webauthn';
import type { Db } from '../../infrastructure/database/connection';

vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: vi.fn() }));

const RP = relyingPartyFor('https://app.example.com');
const OTHER_ORIGIN = 'https://app.evil.example';

interface CredentialRow {
  id: number;
  userId: string;
  credentialId: string;
  publicKey: string;
  algorithm: number;
  signCount: number;
}

/**
 * A Drizzle chain stub narrow enough to be honest about what it models: one
 * challenge row whose consumption is a single conditional UPDATE, and one
 * credential table read by credential id.
 */
function stubDb(opts: { challengeConsumable: boolean; credential?: CredentialRow }) {
  const credentialUpdates: Record<string, unknown>[] = [];
  let challengeClaims = 0;

  const db = {
    insert: () => ({ values: () => Promise.resolve(), returning: () => Promise.resolve([]) }),
    update: (table: unknown) => ({
      set: (value: Record<string, unknown>) => ({
        where: () => {
          const isChallenge = 'consumedAt' in value;
          if (isChallenge) {
            // The UPDATE is the check: only the FIRST claim returns a row.
            const won = opts.challengeConsumable && challengeClaims === 0;
            challengeClaims += 1;
            return {
              returning: () => Promise.resolve(won ? [{ userRef: null, rpId: RP.id }] : []),
            };
          }
          credentialUpdates.push(value);
          return { returning: () => Promise.resolve([]), then: (r: (v: unknown) => void) => r(undefined) };
        },
      }),
      _table: table,
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(opts.credential ? [opts.credential] : []),
          then: (r: (v: unknown) => void) => r(opts.credential ? [opts.credential] : []),
        }),
      }),
    }),
  } as unknown as Db;

  return { db, credentialUpdates, claims: () => challengeClaims };
}

async function keyPair() {
  // Workers types declare these as unions (`CryptoKey | CryptoKeyPair`,
  // `ArrayBuffer | JsonWebKey`) because the same call serves symmetric keys and
  // raw exports. The arguments here pick the asymmetric/JWK branch, so the
  // assertions state which branch rather than widening every use site.
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'],
  ) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey) as JsonWebKey;
  // COSE_Key for ES256: {1:2, 3:-7, -1:1, -2:x, -3:y}
  const x = base64UrlToBytes(jwk.x!);
  const y = base64UrlToBytes(jwk.y!);
  const coseKey = new Uint8Array([
    0xa5,
    0x01, 0x02,
    0x03, 0x26,
    0x20, 0x01,
    0x21, 0x58, 0x20, ...x,
    0x22, 0x58, 0x20, ...y,
  ]);
  return { ...pair, coseKey };
}

async function buildAssertion(opts: {
  privateKey: CryptoKey;
  challenge: string;
  origin?: string;
  rpId?: string;
  userPresent?: boolean;
  signCount?: number;
  credentialId: string;
}) {
  const hash = await rpIdHash(opts.rpId ?? RP.id);
  const counter = new Uint8Array(4);
  new DataView(counter.buffer).setUint32(0, opts.signCount ?? 0, false);
  const flags = opts.userPresent === false ? 0x00 : 0x05; // present + verified
  const authenticatorData = new Uint8Array([...hash, flags, ...counter]);

  const clientDataJson = new TextEncoder().encode(JSON.stringify({
    type: 'webauthn.get',
    challenge: opts.challenge,
    origin: opts.origin ?? RP.origin,
  }));

  const clientHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataJson));
  const raw = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    opts.privateKey,
    new Uint8Array([...authenticatorData, ...clientHash]),
  ));

  return {
    id: opts.credentialId,
    rawId: opts.credentialId,
    response: {
      clientDataJSON: bytesToBase64Url(clientDataJson),
      authenticatorData: bytesToBase64Url(authenticatorData),
      signature: bytesToBase64Url(rawToDer(raw)),
    },
  };
}

function rawToDer(raw: Uint8Array): Uint8Array {
  const trim = (part: Uint8Array): number[] => {
    let i = 0;
    while (i < part.length - 1 && part[i] === 0) i += 1;
    const slice = [...part.subarray(i)];
    return (slice[0]! & 0x80) ? [0, ...slice] : slice;
  };
  const r = trim(raw.subarray(0, 32));
  const s = trim(raw.subarray(32, 64));
  const body = [0x02, r.length, ...r, 0x02, s.length, ...s];
  return new Uint8Array([0x30, body.length, ...body]);
}

async function fixture(overrides: { signCount?: number } = {}) {
  const pair = await keyPair();
  const credentialId = bytesToBase64Url(new Uint8Array([1, 2, 3, 4, 5, 6]));
  const credential: CredentialRow = {
    id: 7,
    userId: 'user-1',
    credentialId,
    publicKey: bytesToBase64Url(pair.coseKey),
    algorithm: -7,
    signCount: overrides.signCount ?? 0,
  };
  return { pair, credentialId, credential };
}

describe('relyingPartyFor', () => {
  it('derives the RP id and origin from the app base url alone', () => {
    const rp = relyingPartyFor('https://app.example.com/');
    expect(rp).toEqual({ id: 'app.example.com', name: 'Builderforce', origin: 'https://app.example.com' });
  });
});

describe('verifyPasskeyAssertion', () => {
  it('accepts a genuine assertion and reports user verification', async () => {
    const { pair, credentialId, credential } = await fixture();
    const { db } = stubDb({ challengeConsumable: true, credential });
    const body = await buildAssertion({ privateKey: pair.privateKey, challenge: 'chal-1', credentialId, signCount: 5 });

    const result = await verifyPasskeyAssertion(db, RP, body);
    expect(result).toMatchObject({ userId: 'user-1', credentialId, userVerified: true, signCountRegressed: false });
  });

  it('refuses an assertion produced for a DIFFERENT origin — the unphishable property', async () => {
    const { pair, credentialId, credential } = await fixture();
    const { db } = stubDb({ challengeConsumable: true, credential });
    const body = await buildAssertion({
      privateKey: pair.privateKey, challenge: 'chal-1', credentialId, origin: OTHER_ORIGIN,
    });

    await expect(verifyPasskeyAssertion(db, RP, body)).rejects.toThrow(/different site/i);
  });

  it('refuses an assertion whose RP-ID hash is for another relying party', async () => {
    const { pair, credentialId, credential } = await fixture();
    const { db } = stubDb({ challengeConsumable: true, credential });
    const body = await buildAssertion({
      privateKey: pair.privateKey, challenge: 'chal-1', credentialId, rpId: 'other.example.com',
    });

    await expect(verifyPasskeyAssertion(db, RP, body)).rejects.toThrow(/different site/i);
  });

  it('refuses when the authenticator did not confirm the human was present', async () => {
    const { pair, credentialId, credential } = await fixture();
    const { db } = stubDb({ challengeConsumable: true, credential });
    const body = await buildAssertion({
      privateKey: pair.privateKey, challenge: 'chal-1', credentialId, userPresent: false,
    });

    await expect(verifyPasskeyAssertion(db, RP, body)).rejects.toThrow(/present/i);
  });

  it('refuses a replayed challenge — the second claim loses at the database', async () => {
    const { pair, credentialId, credential } = await fixture();
    const { db, claims } = stubDb({ challengeConsumable: true, credential });
    const body = await buildAssertion({ privateKey: pair.privateKey, challenge: 'chal-1', credentialId });

    await expect(verifyPasskeyAssertion(db, RP, body)).resolves.toBeTruthy();
    await expect(verifyPasskeyAssertion(db, RP, body)).rejects.toThrow(/expired or was already used/i);
    expect(claims()).toBe(2);
  });

  it('refuses a challenge that was never issued', async () => {
    const { pair, credentialId, credential } = await fixture();
    const { db } = stubDb({ challengeConsumable: false, credential });
    const body = await buildAssertion({ privateKey: pair.privateKey, challenge: 'never-minted', credentialId });

    await expect(verifyPasskeyAssertion(db, RP, body)).rejects.toThrow(/expired or was already used/i);
  });

  it('refuses an unregistered credential', async () => {
    const { pair, credentialId } = await fixture();
    const { db } = stubDb({ challengeConsumable: true });
    const body = await buildAssertion({ privateKey: pair.privateKey, challenge: 'chal-1', credentialId });

    await expect(verifyPasskeyAssertion(db, RP, body)).rejects.toThrow(/not registered/i);
  });

  it('refuses a signature made by a different key', async () => {
    const { credentialId, credential } = await fixture();
    const impostor = await keyPair();
    const { db } = stubDb({ challengeConsumable: true, credential });
    const body = await buildAssertion({ privateKey: impostor.privateKey, challenge: 'chal-1', credentialId });

    await expect(verifyPasskeyAssertion(db, RP, body)).rejects.toThrow(/did not verify/i);
  });

  it('refuses when the user handle names a different account than the stored credential', async () => {
    const { pair, credentialId, credential } = await fixture();
    const { db } = stubDb({ challengeConsumable: true, credential });
    const body = await buildAssertion({ privateKey: pair.privateKey, challenge: 'chal-1', credentialId });
    const withHandle = {
      ...body,
      response: { ...body.response, userHandle: bytesToBase64Url(new TextEncoder().encode('someone-else')) },
    };

    await expect(verifyPasskeyAssertion(db, RP, withHandle)).rejects.toThrow(/does not match the account/i);
  });

  it('RECORDS a sign-counter regression and still lets the sign-in through', async () => {
    const { pair, credentialId, credential } = await fixture({ signCount: 50 });
    const { db, credentialUpdates } = stubDb({ challengeConsumable: true, credential });
    const body = await buildAssertion({ privateKey: pair.privateKey, challenge: 'chal-1', credentialId, signCount: 10 });

    const result = await verifyPasskeyAssertion(db, RP, body);
    expect(result.signCountRegressed).toBe(true);
    expect(credentialUpdates[0]).toHaveProperty('lastSignCountRegressedAt');
    // The stored counter never goes backwards.
    expect(credentialUpdates[0]!.signCount).toBe(50);
  });

  it('treats a counter that stays at zero as normal, not as a regression', async () => {
    const { pair, credentialId, credential } = await fixture({ signCount: 0 });
    const { db, credentialUpdates } = stubDb({ challengeConsumable: true, credential });
    const body = await buildAssertion({ privateKey: pair.privateKey, challenge: 'chal-1', credentialId, signCount: 0 });

    const result = await verifyPasskeyAssertion(db, RP, body);
    expect(result.signCountRegressed).toBe(false);
    expect(credentialUpdates[0]).not.toHaveProperty('lastSignCountRegressedAt');
  });

  it('surfaces failures as PasskeyError with an HTTP status', async () => {
    const { pair, credentialId, credential } = await fixture();
    const { db } = stubDb({ challengeConsumable: true, credential });
    const body = await buildAssertion({
      privateKey: pair.privateKey, challenge: 'chal-1', credentialId, origin: OTHER_ORIGIN,
    });

    await expect(verifyPasskeyAssertion(db, RP, body)).rejects.toBeInstanceOf(PasskeyError);
  });
});

describe('beginPasskeyAuthentication', () => {
  it('is not an account-existence oracle — an unknown email still gets a challenge', async () => {
    const { db } = stubDb({ challengeConsumable: true });
    const options = await beginPasskeyAuthentication(db, RP, { email: 'nobody@example.com' });

    expect(options.challenge).toBeTruthy();
    expect(options.rpId).toBe(RP.id);
    expect(options.allowCredentials).toEqual([]);
  });

  it('offers an empty allow-list for the usernameless flow', async () => {
    const { db } = stubDb({ challengeConsumable: true });
    const options = await beginPasskeyAuthentication(db, RP, {});
    expect(options.allowCredentials).toEqual([]);
    expect(options.userVerification).toBe('preferred');
  });
});
