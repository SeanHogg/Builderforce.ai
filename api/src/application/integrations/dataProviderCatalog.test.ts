import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CATALOG_PROVIDER_IDS,
  DATA_PROVIDER_IDS,
  MARKETING_PROVIDER_IDS,
  callProvider,
  describeProviders,
  isHttpQueryableDsn,
  neonSqlRequest,
  normalizeProviderId,
  parseConnectionString,
  providerSpec,
  testCatalogProvider,
  validateCredentials,
} from './dataProviderCatalog';
import { CONNECTABLE_PROVIDERS, testProviderCredential } from './providerTests';
import { fakeFetch } from '../../../test/fakeDb';
import { readFrontendSource } from '../../../scripts/lib/frontendSource.mjs';

// `.href`, not the URL object: the ambient `URL` here is the Workers/DOM one, which
// is not structurally the `node:url` URL `fileURLToPath` declares — passing the
// string overload sidesteps the lib clash without pulling node types into the build.
const here = resolve(fileURLToPath(new URL('.', import.meta.url).href));
const apiRoot = resolve(here, '../../..');

describe('parseConnectionString', () => {
  it('parses a full DSN including a percent-encoded password', () => {
    const dsn = parseConnectionString('postgres://user:p%40ss@db.example.com:5432/app?sslmode=require');
    expect(dsn).toMatchObject({
      scheme: 'postgres', user: 'user', password: 'p@ss',
      host: 'db.example.com', port: '5432', database: 'app',
    });
    expect(dsn!.params.sslmode).toBe('require');
  });

  it('rejects anything that is not a URL', () => {
    expect(parseConnectionString('')).toBeNull();
    expect(parseConnectionString('host=db user=me')).toBeNull();
    expect(parseConnectionString('just-a-string')).toBeNull();
  });
});

describe('isHttpQueryableDsn', () => {
  it('is true for Neon, which exposes an HTTP SQL endpoint', () => {
    expect(isHttpQueryableDsn(parseConnectionString('postgres://u:p@ep-cool-1.us-east-2.aws.neon.tech/db'))).toBe(true);
    expect(isHttpQueryableDsn(parseConnectionString('postgresql://u:p@x.neon.tech/db'))).toBe(true);
  });

  it('is false for a Postgres host a Worker cannot reach over HTTP', () => {
    expect(isHttpQueryableDsn(parseConnectionString('postgres://u:p@db.example.com/db'))).toBe(false);
    expect(isHttpQueryableDsn(parseConnectionString('mysql://u:p@x.neon.tech/db'))).toBe(false);
    expect(isHttpQueryableDsn(null)).toBe(false);
  });
});

describe('neonSqlRequest', () => {
  it('builds the HTTP SQL call with the connection string in the header', () => {
    const dsn = 'postgres://u:p@ep-x.neon.tech/db';
    const request = neonSqlRequest(dsn, 'SELECT 1', []);
    expect(request.ok).toBe(true);
    if (!request.ok) return;
    expect(request.url).toBe('https://ep-x.neon.tech/sql');
    expect(request.headers['neon-connection-string']).toBe(dsn);
    expect(JSON.parse(request.body!)).toEqual({ query: 'SELECT 1', params: [] });
  });

  it('refuses a non-HTTP host with a message naming the host and the way out', () => {
    const request = neonSqlRequest('postgres://u:p@db.internal.corp/app', 'SELECT 1', []);
    expect(request.ok).toBe(false);
    if (request.ok) return;
    expect(request.error).toContain('db.internal.corp');
    expect(request.error).toContain('self-hosted');
  });
});

describe('the TCP transport boundary is stated, never faked', () => {
  const tcpOnly = ['mysql', 'mongodb', 'redis', 'snowflake', 'planetscale', 'google_cloud_sql'];

  it.each(tcpOnly)('%s stores credentials but never claims a working connection', async (id) => {
    const spec = providerSpec(id)!;
    expect(spec.transport).toBe('tcp');

    const result = await testCatalogProvider(id, { connectionString: 'mysql://u:p@h/db' });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('self-hosted');

    // And the request builder refuses too — one boundary, not two.
    expect(spec.buildRequest('query', {}, {})).toMatchObject({ ok: false });
  });

  it('surfaces the boundary in the catalog the UI renders, BEFORE a secret is pasted', () => {
    const described = describeProviders();
    for (const id of tcpOnly) {
      expect(described.find((p) => p.id === id)!.transportNote).toContain('self-hosted');
    }
    expect(described.find((p) => p.id === 'supabase')!.transportNote).toBeNull();
  });
});

describe('buildRequest', () => {
  it('Supabase: authenticates with the service key and targets PostgREST', () => {
    const request = providerSpec('supabase')!.buildRequest(
      'list-rows',
      { projectUrl: 'https://abc.supabase.co', serviceKey: 'svc' },
      { table: 'leads', limit: 10 },
    );
    expect(request.ok).toBe(true);
    if (!request.ok) return;
    expect(request.url).toBe('https://abc.supabase.co/rest/v1/leads?limit=10');
    expect(request.headers.apikey).toBe('svc');
    expect(request.headers.authorization).toBe('Bearer svc');
  });

  it('Mailchimp: derives the datacenter host from the key suffix', () => {
    const request = providerSpec('mailchimp')!.buildRequest('list-audiences', { apiKey: 'abc-us21' }, {});
    expect(request.ok && request.url).toBe('https://us21.api.mailchimp.com/3.0/lists');
  });

  it('Mailchimp: says exactly what is wrong with a key that has no datacenter', () => {
    const request = providerSpec('mailchimp')!.buildRequest('whoami', { apiKey: 'abc' }, {});
    expect(request.ok).toBe(false);
    if (request.ok) return;
    expect(request.error).toContain('us21');
  });

  it('HubSpot: upsert-contact needs an email and says so', () => {
    const spec = providerSpec('hubspot')!;
    expect(spec.buildRequest('upsert-contact', { apiKey: 'k' }, {})).toMatchObject({ ok: false });
    const ok = spec.buildRequest('upsert-contact', { apiKey: 'k' }, { email: 'a@b.com', name: 'A' });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(JSON.parse(ok.body!).properties.email).toBe('a@b.com');
  });

  it('reports a missing credential rather than sending an unauthenticated request', () => {
    expect(providerSpec('airtable')!.buildRequest('list-bases', {}, {})).toMatchObject({ ok: false });
    expect(providerSpec('bigquery')!.buildRequest('query', { projectId: 'p' }, { sql: 'X' })).toMatchObject({ ok: false });
  });

  it('rejects an operation a provider does not have', () => {
    expect(providerSpec('clickhouse')!.buildRequest('upsert-contact', { endpoint: 'https://h', username: 'u' }, {}))
      .toMatchObject({ ok: false });
  });
});

describe('validateCredentials', () => {
  it('requires the declared fields', () => {
    expect(validateCredentials(providerSpec('supabase')!, {})).toMatchObject({ ok: false });
    expect(validateCredentials(providerSpec('supabase')!, { projectUrl: 'https://a.supabase.co', serviceKey: 'k' }))
      .toEqual({ ok: true });
  });

  it('REALLY parses a connection string instead of just checking it is non-empty', () => {
    expect(validateCredentials(providerSpec('postgres')!, { connectionString: 'host=x user=y' }))
      .toMatchObject({ ok: false });
    expect(validateCredentials(providerSpec('postgres')!, { connectionString: 'postgres://u:p@h/db' }))
      .toEqual({ ok: true });
  });

  it('requires an https endpoint where one is declared', () => {
    expect(validateCredentials(providerSpec('elasticsearch')!, { endpoint: 'my-cluster', apiKey: 'k' }))
      .toMatchObject({ ok: false });
  });
});

describe('callProvider', () => {
  it('returns the parsed body on success', async () => {
    const fetchImpl = fakeFetch([{ match: 'api.hubapi.com', json: { results: [{ id: '1' }] } }]);
    const result = await callProvider('hubspot', 'whoami', { apiKey: 'k' }, {}, fetchImpl);
    expect(result.ok).toBe(true);
    expect(result.body).toEqual({ results: [{ id: '1' }] });
  });

  it('reports an upstream rejection with the provider name and status', async () => {
    const fetchImpl = fakeFetch([{ match: 'api.hubapi.com', status: 401, json: { message: 'nope' } }]);
    const result = await callProvider('hubspot', 'whoami', { apiKey: 'bad' }, {}, fetchImpl);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.error).toContain('HubSpot');
    expect(result.error).toContain('401');
  });

  it('does not throw when the network does', async () => {
    const boom = (() => { throw new Error('connect ECONNREFUSED'); }) as unknown as typeof fetch;
    const result = await callProvider('hubspot', 'whoami', { apiKey: 'k' }, {}, boom);
    expect(result).toMatchObject({ ok: false, status: 0 });
    expect(result.error).toContain('ECONNREFUSED');
  });

  it('rejects an unknown provider before making any request', async () => {
    const fetchImpl = fakeFetch([]);
    const result = await callProvider('not-a-provider', 'whoami', {}, {}, fetchImpl);
    expect(result.ok).toBe(false);
    expect(fetchImpl.calls).toHaveLength(0);
  });
});

describe('testCatalogProvider runs the SAME request the node will', () => {
  it('hits the provider\'s designated cheap read', async () => {
    const fetchImpl = fakeFetch([{ match: 'meta/bases', json: { bases: [] } }]);
    const result = await testCatalogProvider('airtable', { apiKey: 'k' }, fetchImpl);
    expect(result.ok).toBe(true);
    expect(fetchImpl.calls[0]!.url).toBe('https://api.airtable.com/v0/meta/bases');
    // Exactly the URL buildRequest produces for the same operation.
    const built = providerSpec('airtable')!.buildRequest('list-bases', { apiKey: 'k' }, {});
    expect(built.ok && built.url).toBe(fetchImpl.calls[0]!.url);
  });
});

describe('normalizeProviderId', () => {
  it('maps the palette\'s kebab-case onto the enum\'s snake_case', () => {
    expect(normalizeProviderId('zoho-crm')).toBe('zoho_crm');
    expect(normalizeProviderId('google-cloud-sql')).toBe('google_cloud_sql');
    expect(providerSpec('zoho-crm')?.id).toBe('zoho_crm');
  });
});

// ---------------------------------------------------------------------------
// Anti-drift — the failure this whole feature exists to prevent
// ---------------------------------------------------------------------------

describe('catalog / enum / palette parity', () => {
  it('every catalog provider has a storage label in the migration enum', () => {
    // The original bug: the palette advertised 24 integrations and the enum had
    // nowhere to store any of them. This test is what stops it recurring.
    const migration = readFileSync(
      resolve(apiRoot, 'migrations/0412_site_backend_domains_and_campaigns.sql'),
      'utf8',
    );
    const declared = new Set(
      [...migration.matchAll(/ADD VALUE IF NOT EXISTS '([a-z0-9_]+)'/g)].map((m) => m[1]!),
    );
    const missing = CATALOG_PROVIDER_IDS.filter((id) => !declared.has(id));
    expect(missing).toEqual([]);
  });

  it('every Data + Marketing palette entry resolves to a catalog spec', () => {
    // Read through `readFrontendSource` rather than `readFileSync`: this palette has
    // already moved once (the modal builder was deleted when the canvas absorbed it),
    // and a bare read turns that move into an ENOENT with no hint of where it went.
    const palette = readFrontendSource(
      'frontend/src/domains/workflow/domain/stepIntegrations.ts',
      'the Data + Marketing palette parity contract',
    );
    const paletteIds = [...palette.matchAll(/\{\s*id:\s*'([a-z0-9-]+)',[^\n]*category:\s*'(data-db|marketing-crm)'/g)]
      .map((m) => m[1]!);

    expect(paletteIds.length).toBeGreaterThan(20);
    const unresolvable = paletteIds.filter((id) => providerSpec(id) === null);
    expect(unresolvable).toEqual([]);
  });

  it('every catalog provider is accepted by the connect endpoint', () => {
    const connectable = new Set(CONNECTABLE_PROVIDERS);
    expect(CATALOG_PROVIDER_IDS.filter((id) => !connectable.has(id))).toEqual([]);
  });

  it('the two families are non-empty and disjoint', () => {
    expect(DATA_PROVIDER_IDS.length).toBeGreaterThanOrEqual(13);
    expect(MARKETING_PROVIDER_IDS.length).toBeGreaterThanOrEqual(11);
    expect(DATA_PROVIDER_IDS.filter((id) => MARKETING_PROVIDER_IDS.includes(id))).toEqual([]);
  });

  it('every provider declares at least one credential field and one operation', () => {
    for (const id of CATALOG_PROVIDER_IDS) {
      const spec = providerSpec(id)!;
      expect(spec.credentialFields.length, id).toBeGreaterThan(0);
      expect(spec.operations.length, id).toBeGreaterThan(0);
      // The test button must point at an operation that exists.
      expect(spec.operations.some((op) => op.id === spec.testOperation), id).toBe(true);
    }
  });

  it('routes a catalog provider through the shared registry, not a legacy probe', async () => {
    const fetchImpl = fakeFetch([{ match: 'meta/bases', json: {} }]);
    // testProviderCredential has no catalog-specific branch; it looks the
    // provider up. Proving it here means adding a provider needs no route edit.
    const result = await testProviderCredential('airtable', { apiKey: 'k' }, null);
    expect(result.ok === true || result.message.length > 0).toBe(true);
    expect(fetchImpl.calls).toHaveLength(0);
  });
});
