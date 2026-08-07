/**
 * Search-backing resolution — which vendor answers a query, and with whose key.
 *
 * The behaviour this pins is that it ALWAYS resolves. It used to return null (and
 * therefore withhold `web_search` entirely) for every way a stored row can be unusable;
 * now each of those ways must fall through to the platform floor instead, because a
 * workspace with a broken integration should research against a narrower index, not
 * lose research altogether. The precedence — tenant key, then the operator's own SearXNG
 * instance, then keyless — is the other half, and it must not invert.
 */
import { describe, expect, it } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { encryptCredentials } from '../integrations/credentialCrypto';
import { platformWebSearchBacking, resolveWebSearchBacking } from './webSearchCredential';
import { exaSearchVendor, searxngSearchVendor, tavilySearchVendor, wikipediaSearchVendor } from './webSearchVendors';

const SECRET = 'integration-secret';
const TENANT = 42;
const env = { INTEGRATION_ENCRYPTION_SECRET: SECRET, JWT_SECRET: 'jwt' } as unknown as Env;

/** The answer every "unusable row" case must degrade to. */
const KEYLESS = { vendor: wikipediaSearchVendor, auth: { apiKey: null }, source: 'keyless' };

/** An operator running their own SearXNG. */
const SEARXNG = { vendor: searxngSearchVendor, auth: { apiKey: null, baseUrl: 'http://searxng:8080' }, source: 'operator' };

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
async function row(creds: Record<string, unknown>, provider = 'tavily', tenantId = TENANT) {
  const { enc, iv } = await encryptCredentials(creds, SECRET, tenantId);
  return { provider, credentialsEnc: enc, iv };
}

describe('platformWebSearchBacking', () => {
  it('is the KEYLESS vendor when the deployment funds no key — research always works', () => {
    expect(platformWebSearchBacking(env)).toEqual(KEYLESS);
    expect(platformWebSearchBacking(undefined)).toEqual(KEYLESS);
  });

  it('uses the operator’s own SearXNG instance when one is configured', () => {
    const withOperator = { ...env, SEARXNG_URL: ' http://searxng:8080 ' } as unknown as Env;
    expect(platformWebSearchBacking(withOperator)).toEqual(SEARXNG);
  });
});

describe('resolveWebSearchBacking', () => {
  it('resolves a tenant BYO key from the shared integration vault', async () => {
    const got = await resolveWebSearchBacking(env, stubDb([await row({ apiKey: 'tavily-key' })]), TENANT);
    expect(got).toEqual({ vendor: tavilySearchVendor, auth: { apiKey: 'tavily-key' }, source: 'tenant' });
  });

  it('accepts the other key field names the shared vault already uses', async () => {
    for (const field of ['apiToken', 'token', 'accessToken']) {
      const got = await resolveWebSearchBacking(env, stubDb([await row({ [field]: 'k' })]), TENANT);
      expect(got.auth.apiKey, field).toBe('k');
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
    const foreign = await row({ apiKey: 'tavily-key' }, 'tavily', 999);
    expect(await resolveWebSearchBacking(env, stubDb([foreign]), TENANT)).toEqual(KEYLESS);
  });

  it('falls back to keyless for a provider with no wired adapter', async () => {
    expect(await resolveWebSearchBacking(env, stubDb([await row({ apiKey: 'k' }, 'some_future_engine')]), TENANT))
      .toEqual(KEYLESS);
  });

  it('falls back to keyless for a RETIRED provider — a leftover Brave row is not a backing', async () => {
    // The enum label survives (PostgreSQL cannot drop one), so a tenant who connected
    // Brave before it was dropped still has the row. It must resolve to nothing.
    expect(await resolveWebSearchBacking(env, stubDb([await row({ apiKey: 'k' }, 'brave_search')]), TENANT))
      .toEqual(KEYLESS);
  });

  it('follows the port’s documented precedence when a tenant connects more than one', async () => {
    // Rows come back in whatever order the planner chose; the winner must be decided by
    // CREDENTIALED_WEB_SEARCH_VENDOR_IDS, not by that order.
    const rows = [await row({ apiKey: 'exa-key' }, 'exa'), await row({ apiKey: 'tavily-key' }, 'tavily')];
    expect(await resolveWebSearchBacking(env, stubDb(rows), TENANT))
      .toEqual({ vendor: tavilySearchVendor, auth: { apiKey: 'tavily-key' }, source: 'tenant' });
    expect(await resolveWebSearchBacking(env, stubDb([rows[0]!]), TENANT))
      .toEqual({ vendor: exaSearchVendor, auth: { apiKey: 'exa-key' }, source: 'tenant' });
  });

  it('skips an unusable row and keeps looking', async () => {
    const rows = [await row({ apiKey: '' }, 'tavily'), await row({ apiKey: 'good' }, 'exa')];
    expect((await resolveWebSearchBacking(env, stubDb(rows), TENANT)).auth.apiKey).toBe('good');
  });

  it('prefers the operator’s SearXNG over keyless when the tenant has no key', async () => {
    const withOperator = { ...env, SEARXNG_URL: 'http://searxng:8080' } as unknown as Env;
    expect(await resolveWebSearchBacking(withOperator, stubDb([]), TENANT)).toEqual(SEARXNG);
  });

  it('prefers the tenant key over the operator’s SearXNG', async () => {
    const withOperator = { ...env, SEARXNG_URL: 'http://searxng:8080' } as unknown as Env;
    const got = await resolveWebSearchBacking(withOperator, stubDb([await row({ apiKey: 'tenant-key' })]), TENANT);
    expect(got).toMatchObject({ auth: { apiKey: 'tenant-key' }, source: 'tenant' });
  });

  it('degrades to the floor (never throws) when the lookup fails', async () => {
    expect(await resolveWebSearchBacking(env, stubDb([], { throws: true }), TENANT)).toEqual(KEYLESS);
  });
});
