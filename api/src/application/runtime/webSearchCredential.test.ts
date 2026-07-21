/**
 * BYO search-key resolution — the gate that decides whether a run gets `web_search`.
 *
 * The failure mode this guards is handing the agent a tool that cannot work: EVERY way
 * a stored row can be unusable (disabled, undecryptable, empty, unknown vendor) must
 * resolve to null, because null is what keeps `web.search` off the advertised toolset.
 */
import { describe, expect, it } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { encryptCredentials } from '../integrations/credentialCrypto';
import { resolveWebSearchCredential } from './webSearchCredential';
import { braveSearchVendor } from './webSearchVendors';

const SECRET = 'integration-secret';
const TENANT = 42;
const env = { INTEGRATION_ENCRYPTION_SECRET: SECRET, JWT_SECRET: 'jwt' } as unknown as Env;

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

describe('resolveWebSearchCredential', () => {
  it('resolves a tenant BYO key from the shared integration vault', async () => {
    const got = await resolveWebSearchCredential(env, stubDb([await row({ apiKey: 'brave-key' })]), TENANT);
    expect(got).toEqual({ vendor: braveSearchVendor, apiKey: 'brave-key', source: 'tenant' });
  });

  it('accepts the other key field names the shared vault already uses', async () => {
    for (const field of ['apiToken', 'token', 'accessToken']) {
      const got = await resolveWebSearchCredential(env, stubDb([await row({ [field]: 'k' })]), TENANT);
      expect(got?.apiKey, field).toBe('k');
    }
  });

  it('returns null with no rows and no operator key — the no-search default', async () => {
    expect(await resolveWebSearchCredential(env, stubDb([]), TENANT)).toBeNull();
  });

  it('returns null for a blob with no key in it (a half-configured integration)', async () => {
    expect(await resolveWebSearchCredential(env, stubDb([await row({ apiKey: '  ' })]), TENANT)).toBeNull();
    expect(await resolveWebSearchCredential(env, stubDb([await row({ note: 'nothing here' })]), TENANT)).toBeNull();
  });

  it('returns null when the row belongs to another tenant (per-tenant key derivation)', async () => {
    const foreign = await row({ apiKey: 'brave-key' }, 'brave_search', 999);
    expect(await resolveWebSearchCredential(env, stubDb([foreign]), TENANT)).toBeNull();
  });

  it('returns null for a provider with no wired adapter', async () => {
    expect(await resolveWebSearchCredential(env, stubDb([await row({ apiKey: 'k' }, 'some_future_engine')]), TENANT)).toBeNull();
  });

  it('skips an unusable row and keeps looking', async () => {
    const rows = [await row({ apiKey: '' }), await row({ apiKey: 'good' })];
    expect((await resolveWebSearchCredential(env, stubDb(rows), TENANT))?.apiKey).toBe('good');
  });

  it('falls back to the OPTIONAL operator-wide key only when the tenant has none', async () => {
    const withOperator = { ...env, BRAVE_SEARCH_API_KEY: ' op-key ' } as unknown as Env;
    expect(await resolveWebSearchCredential(withOperator, stubDb([]), TENANT))
      .toEqual({ vendor: braveSearchVendor, apiKey: 'op-key', source: 'operator' });
  });

  it('prefers the tenant key over the operator key', async () => {
    const withOperator = { ...env, BRAVE_SEARCH_API_KEY: 'op-key' } as unknown as Env;
    const got = await resolveWebSearchCredential(withOperator, stubDb([await row({ apiKey: 'tenant-key' })]), TENANT);
    expect(got).toMatchObject({ apiKey: 'tenant-key', source: 'tenant' });
  });

  it('degrades to no-search (never throws) when the lookup fails', async () => {
    expect(await resolveWebSearchCredential(env, stubDb([], { throws: true }), TENANT)).toBeNull();
  });
});
