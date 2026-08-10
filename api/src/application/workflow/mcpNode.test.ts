import { describe, expect, it } from 'vitest';
import { executeMcpNode, providerIdFromConfig, resolveParams } from './mcpNode';
import { encryptCredentials } from '../integrations/credentialCrypto';
import { fakeDb, fakeFetch } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';

const SECRET = 'test-secret';
const TENANT = 7;

/** A stored credential row, sealed exactly the way the connect route seals it. */
async function credentialRow(name: string, credentials: Record<string, unknown>) {
  const { enc, iv } = await encryptCredentials(credentials, SECRET, TENANT);
  return { id: `cred-${name}`, name, credentialsEnc: enc, iv };
}

function ctx(db: ReturnType<typeof fakeDb>) {
  return { db: db as unknown as Db, tenantId: TENANT, encryptionSecret: SECRET };
}

describe('providerIdFromConfig', () => {
  it('accepts both keys the canvas has written', () => {
    expect(providerIdFromConfig({ provider: 'hubspot' })).toBe('hubspot');
    expect(providerIdFromConfig({ integrationId: 'airtable' })).toBe('airtable');
    expect(providerIdFromConfig({ provider: '  supabase ' })).toBe('supabase');
    expect(providerIdFromConfig({})).toBe('');
  });
});

describe('resolveParams', () => {
  it('inherits a JSON payload from the upstream node', () => {
    expect(resolveParams({}, '{"email":"a@b.com"}')).toEqual({ email: 'a@b.com' });
  });

  it('lets the node\'s OWN config win over inherited data', () => {
    // An upstream field must never be able to redirect a write to another table.
    expect(resolveParams({ table: 'leads' }, '{"table":"admins","email":"a@b.com"}'))
      .toEqual({ table: 'leads', email: 'a@b.com' });
  });

  it('ignores plain-text and array upstream output', () => {
    expect(resolveParams({ table: 'leads' }, 'hello world')).toEqual({ table: 'leads' });
    expect(resolveParams({ table: 'leads' }, '[1,2,3]')).toEqual({ table: 'leads' });
  });
});

describe('executeMcpNode', () => {
  it('refuses a node with no provider selected', async () => {
    const result = await executeMcpNode(ctx(fakeDb()), {}, '');
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toContain('no provider');
  });

  it('names the discovery endpoint when the provider is unknown', async () => {
    const result = await executeMcpNode(ctx(fakeDb()), { provider: 'notreal' }, '');
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toContain('/api/integrations/catalog');
  });

  it('gives the transport reason for a TCP-only provider — not a generic refusal', async () => {
    const db = fakeDb();
    const result = await executeMcpNode(ctx(db), { provider: 'mysql' }, '');
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toContain('MySQL');
    expect((result as { error: string }).error).toContain('self-hosted');
    // Short-circuits before looking up any credential.
    expect(db.calls).toHaveLength(0);
  });

  it('tells the user where to add a connection when none exists', async () => {
    const db = fakeDb([[]]);
    const result = await executeMcpNode(ctx(db), { provider: 'hubspot' }, '');
    expect((result as { error: string }).error).toContain('Integrations');
  });

  it('REFUSES rather than guessing when several credentials match', async () => {
    // Silently picking one of two Postgres connections eventually writes to the
    // wrong database; the node must be made explicit instead.
    const db = fakeDb([[
      await credentialRow('Staging', { connectionString: 'postgres://u:p@a.neon.tech/db' }),
      await credentialRow('Production', { connectionString: 'postgres://u:p@b.neon.tech/db' }),
    ]]);
    const result = await executeMcpNode(ctx(db), { provider: 'postgres' }, '');
    expect(result).toMatchObject({ ok: false });
    const error = (result as { error: string }).error;
    expect(error).toContain('"Staging"');
    expect(error).toContain('"Production"');
  });

  it('runs a marketing operation with the decrypted credential', async () => {
    const db = fakeDb([[await credentialRow('Main', { apiKey: 'hs-key' })]]);
    const fetchImpl = fakeFetch([{ match: 'api.hubapi.com', json: { id: '99' } }]);
    const result = await executeMcpNode(
      ctx(db),
      { provider: 'hubspot', operation: 'upsert-contact', params: { email: 'sam@example.com', name: 'Sam' } },
      '',
      fetchImpl,
    );
    expect(result).toMatchObject({ ok: true });
    expect(JSON.parse((result as { output: string }).output)).toEqual({ id: '99' });
    expect(fetchImpl.calls[0]!.headers.authorization).toBe('Bearer hs-key');
    expect(JSON.parse(fetchImpl.calls[0]!.body!).properties.email).toBe('sam@example.com');
  });

  it('runs SQL against a Neon database through the HTTP endpoint', async () => {
    const db = fakeDb([[await credentialRow('App DB', { connectionString: 'postgres://u:p@ep-1.neon.tech/app' })]]);
    const fetchImpl = fakeFetch([{ match: 'ep-1.neon.tech/sql', json: { rows: [{ n: 1 }] } }]);
    const result = await executeMcpNode(
      ctx(db),
      { provider: 'postgres', operation: 'query', params: { sql: 'SELECT count(*) FROM leads' } },
      '',
      fetchImpl,
    );
    expect(result).toMatchObject({ ok: true });
    expect(JSON.parse(fetchImpl.calls[0]!.body!).query).toBe('SELECT count(*) FROM leads');
  });

  it('feeds the upstream payload into the operation', async () => {
    const db = fakeDb([[await credentialRow('Main', { apiKey: 'k' })]]);
    const fetchImpl = fakeFetch([{ match: 'api.hubapi.com', json: {} }]);
    await executeMcpNode(
      ctx(db),
      { provider: 'hubspot', operation: 'upsert-contact' },
      '{"email":"from-upstream@example.com"}',
      fetchImpl,
    );
    expect(JSON.parse(fetchImpl.calls[0]!.body!).properties.email).toBe('from-upstream@example.com');
  });

  it('resolves a kebab-case palette id against the snake_case stored provider', async () => {
    const db = fakeDb([[await credentialRow('Zoho', { apiKey: 'z' })]]);
    const fetchImpl = fakeFetch([{ match: 'zohoapis.com', json: { users: [] } }]);
    const result = await executeMcpNode(ctx(db), { provider: 'zoho-crm' }, '', fetchImpl);
    expect(result).toMatchObject({ ok: true });
  });

  it('surfaces an upstream rejection as a readable node failure', async () => {
    const db = fakeDb([[await credentialRow('Main', { apiKey: 'bad' })]]);
    const fetchImpl = fakeFetch([{ match: 'api.hubapi.com', status: 403, json: {} }]);
    const result = await executeMcpNode(ctx(db), { provider: 'hubspot' }, '', fetchImpl);
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toContain('403');
  });

  it('reports an undecryptable credential instead of sending garbage upstream', async () => {
    const db = fakeDb([[{ id: 'c1', name: 'Broken', credentialsEnc: 'v2:not-base64', iv: 'zz' }]]);
    const fetchImpl = fakeFetch([]);
    const result = await executeMcpNode(ctx(db), { provider: 'hubspot' }, '', fetchImpl);
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toContain('decrypted');
    expect(fetchImpl.calls).toHaveLength(0);
  });
});
