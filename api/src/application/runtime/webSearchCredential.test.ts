/**
 * Search-backing resolution — which vendor answers a query, and with whose key.
 *
 * The behaviour this pins is that it ALWAYS resolves. It used to return null (and
 * therefore withhold `web_search` entirely) for every way a stored row can be unusable;
 * now each of those ways must fall through to the platform floor instead, because a
 * workspace with a broken integration should research against a narrower index, not
 * lose research altogether. The precedence — tenant key, then operator key, then
 * keyless — is the other half, and it must not invert.
 */
import { describe, expect, it } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { encryptCredentials } from '../integrations/credentialCrypto';
import { platformWebSearchBacking, resolveWebSearchBacking } from './webSearchCredential';
import { braveSearchVendor, wikipediaSearchVendor } from './webSearchVendors';

const SECRET = 'integration-secret';
const TENANT = 42;
const env = { INTEGRATION_ENCRYPTION_SECRET: SECRET, JWT_SECRET: 'jwt' } as unknown as Env;

/** The answer every "unusable row" case must degrade to. */
const KEYLESS = { vendor: wikipediaSearchVendor, apiKey: null, source: 'keyless' };

/** Minimal drizzle-shaped stub: `.select().from().where()` resolves to `rows`. The
 *  resolver issues exactly one such query, so this is the whole surface it touches. */
function stubDb(rows: unknown[], opts?: { throws?: boolean }): Db {
  return {
    select: () => ({
      from: () => ({
        where: async () => {
          if (opts?.throws) throw new Error('db down');
          return rows;
        },
      }),
    }),
  } as unknown as Db;
}

/** A realistic stored row: the blob is sealed with the REAL per-tenant crypto, so this
 *  exercises the actual decrypt path rather than a stand-in. */
async function row(creds: Record<string, unknown>, provider = 'brave_search', tenantId = TENANT) {
  const { enc, iv } = await encryptCredentials(creds, SECRET, tenantId);
  return { provider, credentialsEnc: enc, iv };
}

describe('platformWebSearchBacking', () => {
  it('is the KEYLESS vendor when the deployment funds no key — research always works', () => {
    expect(platformWebSearchBacking(env)).toEqual(KEYLESS);
    expect(platformWebSearchBacking(undefined)).toEqual(KEYLESS);
  });

  it('uses the operator-wide key when one is configured', () => {
    const withOperator = { ...env, BRAVE_SEARCH_API_KEY: ' op-key ' } as unknown as Env;
    expect(platformWebSearchBacking(withOperator))
      .toEqual({ vendor: braveSearchVendor, apiKey: 'op-key', source: 'operator' });
  });
});

describe('resolveWebSearchBacking', () => {
  it('resolves a tenant BYO key from the shared integration vault', async () => {
    const got = await resolveWebSearchBacking(env, stubDb([await row({ apiKey: 'brave-key' })]), TENANT);
    expect(got).toEqual({ vendor: braveSearchVendor, apiKey: 'brave-key', source: 'tenant' });
  });

  it('accepts the other key field names the shared vault already uses', async () => {
    for (const field of ['apiToken', 'token', 'accessToken']) {
      const got = await resolveWebSearchBacking(env, stubDb([await row({ [field]: 'k' })]), TENANT);
      expect(got.apiKey, field).toBe('k');
    }
  });

  it('falls back to keyless with no rows and no operator key — the default workspace', async () => {
    expect(await resolveWebSearchBacking(env, stubDb([]), TENANT)).toEqual(KEYLESS);
  });

  it('falls back to keyless for a blob with no key in it (a half-configured integration)', async () => {
    expect(await resolveWebSearchBacking(env, stubDb([await row({ apiKey: '  ' })]), TENANT)).toEqual(KEYLESS);
    expect(await resolveWebSearchBacking(env, stubDb([await row({ note: 'nothing here' })]), TENANT)).toEqual(KEYLESS);
  });

  it('falls back to keyless when the row belongs to another tenant (per-tenant key derivation)', async () => {
    const foreign = await row({ apiKey: 'brave-key' }, 'brave_search', 999);
    expect(await resolveWebSearchBacking(env, stubDb([foreign]), TENANT)).toEqual(KEYLESS);
  });

  it('falls back to keyless for a provider with no wired adapter', async () => {
    expect(await resolveWebSearchBacking(env, stubDb([await row({ apiKey: 'k' }, 'some_future_engine')]), TENANT))
      .toEqual(KEYLESS);
  });

  it('skips an unusable row and keeps looking', async () => {
    const rows = [await row({ apiKey: '' }), await row({ apiKey: 'good' })];
    expect((await resolveWebSearchBacking(env, stubDb(rows), TENANT)).apiKey).toBe('good');
  });

  it('prefers the operator key over keyless when the tenant has none', async () => {
    const withOperator = { ...env, BRAVE_SEARCH_API_KEY: ' op-key ' } as unknown as Env;
    expect(await resolveWebSearchBacking(withOperator, stubDb([]), TENANT))
      .toEqual({ vendor: braveSearchVendor, apiKey: 'op-key', source: 'operator' });
  });

  it('prefers the tenant key over the operator key', async () => {
    const withOperator = { ...env, BRAVE_SEARCH_API_KEY: 'op-key' } as unknown as Env;
    const got = await resolveWebSearchBacking(withOperator, stubDb([await row({ apiKey: 'tenant-key' })]), TENANT);
    expect(got).toMatchObject({ apiKey: 'tenant-key', source: 'tenant' });
  });

  it('degrades to the floor (never throws) when the lookup fails', async () => {
    expect(await resolveWebSearchBacking(env, stubDb([], { throws: true }), TENANT)).toEqual(KEYLESS);
  });
});
