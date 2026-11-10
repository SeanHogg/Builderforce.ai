import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Stub the segment resolver at the module boundary: resolveSegmentFromHostToken
// is under test for what it ADDS (verify the token, then feed the VERIFIED
// claims into resolveSegment with the right coordinates). The resolver's own
// lazy-create/caching contract is covered by segmentResolver.test.ts, so we
// assert here only that it was called with the verified claims — not re-derive
// its internals through a fake DB.
vi.mock('../../infrastructure/auth/segmentResolver', () => ({
  resolveSegment: vi.fn(async () => 'seg-acct-1|co-1'),
}));

import { verifyHostOidcToken, resolveSegmentFromHostToken, hostTokenGrantsScope } from './hostOidc';
import { resolveSegment } from '../../infrastructure/auth/segmentResolver';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

// The mocked resolver, captured from the import the mock replaced. vi.mock is
// hoisted, so the mock must be defined inside the factory and read back here.
const resolveSegmentMock = vi.mocked(resolveSegment);

/**
 * The inbound host OIDC verifier is an AUTHORIZATION boundary (spec 05 §2.1):
 * a token that passes has its account/company claims trusted to resolve a
 * Segment, and through it every Segment-scoped row. So the tests are written
 * from an attacker's side — every way to present a token that isn't a genuine,
 * current, issuer-matched host one must be rejected, and the happy path must
 * still feed resolveSegment.
 *
 * Tokens are signed with a real RSA key generated per-run and served through a
 * stubbed JWKS endpoint + a stub DB, so the signature check exercises real
 * WebCrypto and the tenant/idpIssuer lookup exercises the real read path.
 */

const env = { KV: undefined } as unknown as Env;

const ISSUER = 'https://app.burnrateos.com';
const TENANT_ID = 7;

let keyPair: CryptoKeyPair;
let jwk: JsonWebKey;
const KID = 'host-key-1';

/** Minimal fake DB: answers the tenants.idpIssuer read; the segment table is
 *  stubbed so resolveSegment can lazy-create/read through it. */
function makeDb(opts: { idpIssuer?: string | null; settings?: string | null } = {}): { db: Db; segmentRows: Map<string, unknown> } {
  const segmentRows = new Map<string, unknown>();
  const db = {
    select: (fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (_cond: unknown) => ({
          limit: async () => {
            // Distinguish the tenants read from the segments read by which
            // columns were projected: the idpIssuer read names `idpIssuer`.
            if (fields && typeof fields === 'object' && 'idpIssuer' in (fields as object)) {
              return opts.idpIssuer ? [{ idpIssuer: opts.idpIssuer, settings: opts.settings ?? null }] : [];
            }
            // A segment read (findFederated re-read): the resolver only looks up
            // by (externalAccountId, externalCompanyId), which our where-cond
            // carries. Return any row already inserted for those coordinates.
            const cond = String(_cond);
            const row = [...segmentRows.values()].find((r) => {
              const seg = r as { externalAccountId?: string; externalCompanyId?: string };
              return cond.includes(String(seg.externalAccountId)) && cond.includes(String(seg.externalCompanyId));
            });
            return row ? [{ id: (row as { id: string }).id }] : [];
          },
        }),
      }),
    }),
    insert: () => ({
      values: (v: unknown) => {
        const row = v as { externalAccountId?: string; externalCompanyId?: string; id?: string };
        const key = `${row.externalAccountId}|${row.externalCompanyId}`;
        const id = row.id ?? `seg-${key}`;
        segmentRows.set(key, { ...row, id });
        return { onConflictDoNothing: () => ({}) };
      },
    }),
  };
  return { db: db as unknown as Db, segmentRows };
}

function b64url(bytes: Uint8Array | string): string {
  const raw = typeof bytes === 'string' ? bytes : String.fromCharCode(...bytes);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Mint a signed token with the given claims/header overrides. */
async function mintToken(
  claims: Record<string, unknown> = {},
  opts: { kid?: string | null; key?: CryptoKey } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header: Record<string, unknown> = { alg: 'RS256', typ: 'JWT' };
  if (opts.kid !== null) header.kid = opts.kid ?? KID;

  const payload = {
    iss: ISSUER,
    sub: 'host-user-1',
    acct: 'acct-1',
    co: 'co-1',
    exp: now + 300,
    nbf: now - 10,
    ...claims,
  };

  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = new Uint8Array(await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    opts.key ?? keyPair.privateKey,
    new TextEncoder().encode(signingInput),
  ));
  return `${signingInput}.${b64url(signature)}`;
}

beforeEach(async () => {
  keyPair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair;
  jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey) as JsonWebKey;

  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/.well-known/jwks')) {
      return new Response(JSON.stringify({ keys: [{ ...jwk, kid: KID, alg: 'RS256' }] }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }));
});

afterEach(() => vi.unstubAllGlobals());

describe('verifyHostOidcToken', () => {
  it('accepts a well-formed host token and returns its account/company claims', async () => {
    const { db } = makeDb({ idpIssuer: ISSUER });
    const result = await verifyHostOidcToken(env, db, TENANT_ID, await mintToken());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claims.iss).toBe(ISSUER);
    expect(result.claims.accountId).toBe('acct-1');
    expect(result.claims.companyId).toBe('co-1');
  });

  it('rejects a tenant with no configured idpIssuer (fails closed)', async () => {
    const { db } = makeDb({ idpIssuer: null });
    const result = await verifyHostOidcToken(env, db, TENANT_ID, await mintToken());
    expect(result).toEqual({ ok: false, error: 'This workspace does not trust an external identity provider.' });
  });

  it('rejects a token from a DIFFERENT issuer than the tenant trusts', async () => {
    const { db } = makeDb({ idpIssuer: 'https://other-idp.example.com' });
    const result = await verifyHostOidcToken(env, db, TENANT_ID, await mintToken());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('not issued by the trusted identity provider');
  });

  it('rejects a token signed by a DIFFERENT key (the core forgery case)', async () => {
    const { db } = makeDb({ idpIssuer: ISSUER });
    const attacker = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    ) as CryptoKeyPair;
    const result = await verifyHostOidcToken(env, db, TENANT_ID, await mintToken({}, { key: attacker.privateKey }));
    expect(result).toEqual({ ok: false, error: 'Token signature is not valid.' });
  });

  it('rejects an expired token', async () => {
    const { db } = makeDb({ idpIssuer: ISSUER });
    const now = Math.floor(Date.now() / 1000);
    const result = await verifyHostOidcToken(env, db, TENANT_ID, await mintToken({ exp: now - 120 }));
    expect(result).toEqual({ ok: false, error: 'Token has expired.' });
  });

  it('rejects a token with no key id in the header', async () => {
    const { db } = makeDb({ idpIssuer: ISSUER });
    const result = await verifyHostOidcToken(env, db, TENANT_ID, await mintToken({}, { kid: null }));
    expect(result).toEqual({ ok: false, error: 'Token header has no key id.' });
  });

  it('rejects a token with no account/company claims', async () => {
    const { db } = makeDb({ idpIssuer: ISSUER });
    const result = await verifyHostOidcToken(env, db, TENANT_ID, await mintToken({ acct: undefined, co: undefined }));
    expect(result).toEqual({ ok: false, error: 'Token carries no account/company claims.' });
  });

  it('rejects a malformed token', async () => {
    const { db } = makeDb({ idpIssuer: ISSUER });
    const result = await verifyHostOidcToken(env, db, TENANT_ID, 'not-a-jwt');
    expect(result).toEqual({ ok: false, error: 'Malformed token.' });
  });
});

describe('resolveSegmentFromHostToken', () => {
  beforeEach(() => resolveSegmentMock.mockClear());

  it('feeds VERIFIED claims into resolveSegment and returns the segment id', async () => {
    const { db } = makeDb({ idpIssuer: ISSUER });
    const result = await resolveSegmentFromHostToken(env, db, TENANT_ID, await mintToken(), 'ingest:feedback');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.segmentId).toBe('seg-acct-1|co-1');
    expect(result.claims.accountId).toBe('acct-1');
    // The resolver is the ONE chokepoint — it must receive exactly the VERIFIED
    // account/company coordinates, for THIS tenant, with env so the resolved
    // mapping is cached/invalidated through the canonical path.
    expect(resolveSegmentMock).toHaveBeenCalledWith(db, TENANT_ID, { accountId: 'acct-1', companyId: 'co-1' }, env);
  });

  it('does NOT resolve when the token fails verification (resolveSegment never runs)', async () => {
    const { db } = makeDb({ idpIssuer: ISSUER });
    // Well past the verifier's 60s clock-skew leeway so it is unambiguously expired.
    const now = Math.floor(Date.now() / 1000);
    const result = await resolveSegmentFromHostToken(env, db, TENANT_ID, await mintToken({ exp: now - 120 }), 'ingest:feedback');
    expect(result.ok).toBe(false);
    expect(resolveSegmentMock).not.toHaveBeenCalled();
  });

  it('regression: a host token with no scope claim is refused segments:manage (403) and resolves nothing', async () => {
    const { db } = makeDb({ idpIssuer: ISSUER });
    const result = await resolveSegmentFromHostToken(env, db, TENANT_ID, await mintToken(), 'segments:manage');
    expect(result).toEqual({
      ok: false,
      status: 403,
      error: "This identity token is not authorized for the 'segments:manage' scope.",
    });
    expect(resolveSegmentMock).not.toHaveBeenCalled();
  });

  it('regression: a host token with no scope claim is refused webhooks:manage (403)', async () => {
    const { db } = makeDb({ idpIssuer: ISSUER });
    const result = await resolveSegmentFromHostToken(env, db, TENANT_ID, await mintToken(), 'webhooks:manage');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(403);
  });

  it('grants segments:manage only when the verified scope claim names it explicitly', async () => {
    const { db } = makeDb({ idpIssuer: ISSUER });
    const result = await resolveSegmentFromHostToken(
      env, db, TENANT_ID, await mintToken({ scope: 'openid segments:manage' }), 'segments:manage',
    );
    expect(result.ok).toBe(true);
  });

  it('a verification failure answers 401, not 403', async () => {
    const { db } = makeDb({ idpIssuer: ISSUER });
    const result = await resolveSegmentFromHostToken(env, db, TENANT_ID, 'not-a-jwt', 'ingest:feedback');
    expect(result).toEqual({ ok: false, status: 401, error: 'Malformed token.' });
  });
});

describe('hostTokenGrantsScope', () => {
  it('grants ingest:feedback by default and nothing else', () => {
    expect(hostTokenGrantsScope({ scopes: [] }, 'ingest:feedback')).toBe(true);
    expect(hostTokenGrantsScope({ scopes: [] }, 'segments:manage')).toBe(false);
    expect(hostTokenGrantsScope({ scopes: [] }, 'webhooks:manage')).toBe(false);
  });

  it('ignores claimed scopes outside the seam set (scp cannot grant write:packages)', async () => {
    const { db } = makeDb({ idpIssuer: ISSUER });
    const result = await verifyHostOidcToken(env, db, TENANT_ID, await mintToken({ scp: ['write:packages', 'webhooks:manage'] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claims.scopes).toEqual(['webhooks:manage']);
  });
});

describe('verifyHostOidcToken — expiry and audience', () => {
  it('regression: rejects a token with no exp claim', async () => {
    const { db } = makeDb({ idpIssuer: ISSUER });
    const result = await verifyHostOidcToken(env, db, TENANT_ID, await mintToken({ exp: undefined }));
    expect(result).toEqual({ ok: false, error: 'Token has no expiry.' });
  });

  it('regression: rejects a token whose aud is not the configured idpAudience', async () => {
    const { db } = makeDb({ idpIssuer: ISSUER, settings: JSON.stringify({ idpAudience: 'https://builderforce.ai' }) });
    const result = await verifyHostOidcToken(env, db, TENANT_ID, await mintToken({ aud: 'https://other-rp.example.com' }));
    expect(result).toEqual({ ok: false, error: 'Token was not issued for this audience.' });
  });

  it('rejects a token with no aud when an audience is configured', async () => {
    const { db } = makeDb({ idpIssuer: ISSUER, settings: JSON.stringify({ idpAudience: 'https://builderforce.ai' }) });
    const result = await verifyHostOidcToken(env, db, TENANT_ID, await mintToken());
    expect(result).toEqual({ ok: false, error: 'Token was not issued for this audience.' });
  });

  it('accepts a matching aud (string or array) when an audience is configured', async () => {
    const { db } = makeDb({ idpIssuer: ISSUER, settings: JSON.stringify({ idpAudience: 'https://builderforce.ai' }) });
    expect((await verifyHostOidcToken(env, db, TENANT_ID, await mintToken({ aud: 'https://builderforce.ai' }))).ok).toBe(true);
    expect((await verifyHostOidcToken(env, db, TENANT_ID, await mintToken({ aud: ['x', 'https://builderforce.ai'] }))).ok).toBe(true);
  });

  it('fails closed when the tenant settings JSON is unreadable', async () => {
    const { db } = makeDb({ idpIssuer: ISSUER, settings: '{not json' });
    const result = await verifyHostOidcToken(env, db, TENANT_ID, await mintToken());
    expect(result.ok).toBe(false);
  });
});
