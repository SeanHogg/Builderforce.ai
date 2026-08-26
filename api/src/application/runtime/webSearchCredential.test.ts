/**
 * Search-backing resolution — which vendor answers a query, and with whose key.
 *
 * The behaviour this pins is that it ALWAYS resolves. It used to return null (and
 * therefore withhold `web_search` entirely) for every way a stored row can be unusable;
 * now each of those ways must fall through to the platform floor instead, because a
 * workspace with a broken integration should research against a narrower index, not
 * lose research altogether. The precedence — tenant key, then the operator's own funded
 * Tavily key, then the operator's own SearXNG instance, then keyless — is the other
 * half, and it must not invert.
 */
import { describe, expect, it } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { encryptCredentials } from '../integrations/credentialCrypto';
import { platformWebSearchBacking, resolveWebSearchBacking } from './webSearchCredential';
import { exaSearchVendor, ollamaSearchVendor, searxngSearchVendor, tavilySearchVendor, wikipediaSearchVendor } from './webSearchVendors';

const SECRET = 'integration-secret';
const TENANT = 42;
const env = { INTEGRATION_ENCRYPTION_SECRET: SECRET, JWT_SECRET: 'jwt' } as unknown as Env;

/** The answer every "unusable row" case must degrade to. */
const KEYLESS = { vendor: wikipediaSearchVendor, auth: { apiKey: null }, source: 'keyless' };

/** An operator running their own SearXNG. */
const SEARXNG = { vendor: searxngSearchVendor, auth: { apiKey: null, baseUrl: 'http://searxng:8080' }, source: 'operator' };

/** An operator funding a shared Tavily key. */
const OPERATOR_TAVILY = { vendor: tavilySearchVendor, auth: { apiKey: 'operator-tavily-key' }, source: 'operator' };

/** An operator funding a shared Ollama key — the BACKUP operator tier. */
const OPERATOR_OLLAMA = { vendor: ollamaSearchVendor, auth: { apiKey: 'operator-ollama-key' }, source: 'operator' };

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

  it('uses the operator’s funded Tavily key when one is configured', () => {
    const withTavily = { ...env, TAVILY_API_KEY: ' operator-tavily-key ' } as unknown as Env;
    expect(platformWebSearchBacking(withTavily)).toEqual(OPERATOR_TAVILY);
  });

  it('prefers the funded Tavily key over SearXNG when both are configured', () => {
    const both = { ...env, TAVILY_API_KEY: 'operator-tavily-key', SEARXNG_URL: 'http://searxng:8080' } as unknown as Env;
    expect(platformWebSearchBacking(both)).toEqual(OPERATOR_TAVILY);
  });

  it('uses the operator’s funded Ollama key when Tavily is not configured', () => {
    const withOllama = { ...env, OLLAMA_API_KEY: ' operator-ollama-key ' } as unknown as Env;
    expect(platformWebSearchBacking(withOllama)).toEqual(OPERATOR_OLLAMA);
  });

  it('prefers the funded Tavily key over the funded Ollama key', () => {
    const both = { ...env, TAVILY_API_KEY: 'operator-tavily-key', OLLAMA_API_KEY: 'operator-ollama-key' } as unknown as Env;
    expect(platformWebSearchBacking(both)).toEqual(OPERATOR_TAVILY);
  });

  it('prefers the funded Ollama key over SearXNG', () => {
    const both = { ...env, OLLAMA_API_KEY: 'operator-ollama-key', SEARXNG_URL: 'http://searxng:8080' } as unknown as Env;
    expect(platformWebSearchBacking(both)).toEqual(OPERATOR_OLLAMA);
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

  it('picks a tenant’s Ollama key as the BACKUP — behind Tavily, ahead of Exa/Linkup', async () => {
    const rows = [await row({ apiKey: 'exa-key' }, 'exa'), await row({ apiKey: 'ollama-key' }, 'ollama')];
    expect(await resolveWebSearchBacking(env, stubDb(rows), TENANT))
      .toEqual({ vendor: ollamaSearchVendor, auth: { apiKey: 'ollama-key' }, source: 'tenant' });
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

  it('falls back to the operator’s funded Tavily key when the tenant has no key', async () => {
    const withTavily = { ...env, TAVILY_API_KEY: 'operator-tavily-key' } as unknown as Env;
    expect(await resolveWebSearchBacking(withTavily, stubDb([]), TENANT)).toEqual(OPERATOR_TAVILY);
  });

  it('prefers the operator’s funded Tavily key over SearXNG', async () => {
    const both = { ...env, TAVILY_API_KEY: 'operator-tavily-key', SEARXNG_URL: 'http://searxng:8080' } as unknown as Env;
    expect(await resolveWebSearchBacking(both, stubDb([]), TENANT)).toEqual(OPERATOR_TAVILY);
  });

  it('prefers the tenant key over the operator’s funded Tavily key', async () => {
    const withTavily = { ...env, TAVILY_API_KEY: 'operator-tavily-key' } as unknown as Env;
    const got = await resolveWebSearchBacking(withTavily, stubDb([await row({ apiKey: 'tenant-key' })]), TENANT);
    expect(got).toMatchObject({ auth: { apiKey: 'tenant-key' }, source: 'tenant' });
  });

  it('falls back to the operator’s funded Ollama key when the tenant has no key and Tavily is unset', async () => {
    const withOllama = { ...env, OLLAMA_API_KEY: 'operator-ollama-key' } as unknown as Env;
    expect(await resolveWebSearchBacking(withOllama, stubDb([]), TENANT)).toEqual(OPERATOR_OLLAMA);
  });

  it('prefers the operator’s funded Tavily key over the operator’s funded Ollama key', async () => {
    const both = { ...env, TAVILY_API_KEY: 'operator-tavily-key', OLLAMA_API_KEY: 'operator-ollama-key' } as unknown as Env;
    expect(await resolveWebSearchBacking(both, stubDb([]), TENANT)).toEqual(OPERATOR_TAVILY);
  });
});
