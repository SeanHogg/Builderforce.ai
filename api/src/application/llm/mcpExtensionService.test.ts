import { describe, it, expect, vi } from 'vitest';
import { listToolsForTenant, callMcpTool, assertSafeServerUrl } from './mcpExtensionService';

describe('assertSafeServerUrl (SSRF guard)', () => {
  it('accepts a public https host', () => {
    expect(() => assertSafeServerUrl('https://crm.example.com/mcp')).not.toThrow();
    expect(() => assertSafeServerUrl('https://1.2.3.4/mcp')).not.toThrow();
  });
  it('rejects non-https', () => {
    expect(() => assertSafeServerUrl('http://crm.example.com')).toThrow(/https/);
  });
  it('rejects loopback / private / link-local / metadata IPs', () => {
    for (const url of [
      'https://127.0.0.1', 'https://10.0.0.5', 'https://192.168.1.10',
      'https://172.16.0.1', 'https://169.254.169.254', 'https://0.0.0.0',
      'https://100.64.0.1',
    ]) {
      expect(() => assertSafeServerUrl(url), url).toThrow(/public host/);
    }
  });
  it('rejects internal hostnames and IPv6 loopback/ULA/link-local', () => {
    for (const url of [
      'https://localhost', 'https://api.internal', 'https://db.local',
      'https://metadata.google.internal', 'https://[::1]', 'https://[fe80::1]',
      'https://[fd00::1]',
    ]) {
      expect(() => assertSafeServerUrl(url), url).toThrow(/public host/);
    }
  });
});

// Decryption is exercised through the real MfaService helpers, so encrypt a
// secret with the same keyMaterial the service uses and assert it's forwarded.
import { encryptSecretForStorage } from '../../infrastructure/auth/MfaService';

const KEY = 'test-jwt-secret';

interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/** A fetch mock whose recorded calls are `[url, init]` (typed, so we can index them). */
function makeFetch(responder: (url: string, init?: FetchInit) => Response) {
  return vi.fn(async (url: string, init?: FetchInit) => responder(url, init));
}

/** Minimal Drizzle stub: select().from().where([.limit]) resolves to `rows`;
 *  update().set().where() records the patch so `rememberProtocol` (which every
 *  list/call path runs) has somewhere to write without a real database. */
function dbReturning(rows: unknown[], updates: Array<{ patch: unknown }> = []) {
  const where = (..._a: unknown[]) => ({
    limit: () => Promise.resolve(rows),
    then: (resolve: (v: unknown) => unknown) => resolve(rows),
  });
  return {
    select: () => ({ from: () => ({ where }) }),
    update: () => ({
      set: (patch: unknown) => {
        updates.push({ patch });
        return { where: () => Promise.resolve() };
      },
    }),
  } as never;
}

// Every row below pins `protocol: 'legacy'` — these tests exercise the ORIGINAL
// Builderforce-shaped REST relay specifically (see mcpWireClient.test.ts for the
// real-MCP JSON-RPC transport and the `auto` probe that picks between them).
describe('mcpExtensionService — server-to-server relay (legacy transport)', () => {
  it('listToolsForTenant fetches each enabled extension and namespaces tool names', async () => {
    const secretEnc = await encryptSecretForStorage('mcp-secret', KEY);
    const db = dbReturning([
      { id: 'aaaaaaaa-1111-2222-3333-444444444444', tenantId: 1, name: 'CRM', serverUrl: 'https://crm.example/', secretEnc, enabled: true, protocol: 'legacy', allowedTools: null },
    ]);
    const fetchMock = makeFetch(() =>
      new Response(JSON.stringify({ tools: [{ name: 'lookup_account', description: 'Find an account', parameters: { type: 'object' } }] }), { status: 200 }),
    );

    const tools = await listToolsForTenant(db, 1, KEY, fetchMock as unknown as typeof fetch);

    // Hit the server's /tools with the decrypted bearer secret.
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://crm.example/tools');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer mcp-secret' });

    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      extensionId: 'aaaaaaaa-1111-2222-3333-444444444444',
      tool: 'lookup_account',
      name: 'mcp_aaaaaaaa_lookup_account', // flat, no dots
    });
  });

  it('listToolsForTenant skips an extension whose server errors', async () => {
    const db = dbReturning([
      { id: 'bbbbbbbb-0000-0000-0000-000000000000', tenantId: 1, name: 'Down', serverUrl: 'https://down.example', secretEnc: null, enabled: true, protocol: 'legacy', allowedTools: null },
    ]);
    const fetchMock = makeFetch(() => new Response('boom', { status: 500 }));
    const tools = await listToolsForTenant(db, 1, KEY, fetchMock as unknown as typeof fetch);
    expect(tools).toEqual([]);
  });

  it('listToolsForTenant withholds a tool the tenant has not consented to', async () => {
    const db = dbReturning([
      { id: 'cccccccc-0000-0000-0000-000000000000', tenantId: 1, name: 'CRM', serverUrl: 'https://crm.example', secretEnc: null, enabled: true, protocol: 'legacy', allowedTools: ['lookup_account'] },
    ]);
    const fetchMock = makeFetch(() =>
      new Response(JSON.stringify({
        tools: [
          { name: 'lookup_account', description: 'Find an account', parameters: { type: 'object' } },
          { name: 'delete_account', description: 'Delete an account', parameters: { type: 'object' } },
        ],
      }), { status: 200 }),
    );
    const tools = await listToolsForTenant(db, 1, KEY, fetchMock as unknown as typeof fetch);
    expect(tools.map((t) => t.tool)).toEqual(['lookup_account']);
  });

  it('callMcpTool relays to {serverUrl}/call with the decrypted secret and returns JSON', async () => {
    const secretEnc = await encryptSecretForStorage('mcp-secret', KEY);
    const db = dbReturning([
      { id: 'ext-1', tenantId: 1, name: 'CRM', serverUrl: 'https://crm.example', secretEnc, enabled: true, protocol: 'legacy', allowedTools: null },
    ]);
    const fetchMock = makeFetch(() => new Response(JSON.stringify({ account: 'acme' }), { status: 200 }));

    const result = await callMcpTool(
      db,
      { tenantId: 1, extensionId: 'ext-1', tool: 'lookup_account', arguments: { q: 'acme' }, keyMaterial: KEY },
      fetchMock as unknown as typeof fetch,
    );

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://crm.example/call');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer mcp-secret' });
    expect(JSON.parse(init?.body as string)).toEqual({ tool: 'lookup_account', arguments: { q: 'acme' } });
    expect(result).toEqual({ account: 'acme' });
  });

  it('callMcpTool refuses a tool the tenant has not consented to, without calling the server', async () => {
    const db = dbReturning([
      { id: 'ext-2', tenantId: 1, name: 'CRM', serverUrl: 'https://crm.example', secretEnc: null, enabled: true, protocol: 'legacy', allowedTools: ['lookup_account'] },
    ]);
    const fetchMock = makeFetch(() => new Response('{}', { status: 200 }));
    await expect(
      callMcpTool(db, { tenantId: 1, extensionId: 'ext-2', tool: 'delete_account', arguments: {}, keyMaterial: KEY }, fetchMock as unknown as typeof fetch),
    ).rejects.toThrow(/not approved/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('callMcpTool throws for an unknown/disabled extension', async () => {
    const db = dbReturning([]);
    await expect(
      callMcpTool(db, { tenantId: 1, extensionId: 'nope', tool: 't', arguments: {}, keyMaterial: KEY }, makeFetch(() => new Response('{}')) as unknown as typeof fetch),
    ).rejects.toThrow(/Unknown or disabled/);
  });
});

describe('mcpExtensionService — auto protocol detection', () => {
  it('prefers the real MCP transport and remembers it on the row', async () => {
    const updates: Array<{ patch: unknown }> = [];
    const db = dbReturning(
      [{ id: 'dddddddd-0000-0000-0000-000000000000', tenantId: 1, name: 'Real MCP', serverUrl: 'https://mcp.example', secretEnc: null, enabled: true, protocol: 'auto', allowedTools: null }],
      updates,
    );
    const fetchMock = makeFetch((_url, init) => {
      const body = JSON.parse((init?.body as string) ?? '{}');
      if (body.method === 'tools/list') {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'search', description: 'Search', inputSchema: { type: 'object' } }] } }), { status: 200 });
      }
      // initialize / notifications/initialized
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id ?? null, result: {} }), { status: 200 });
    });

    const tools = await listToolsForTenant(db, 1, KEY, fetchMock as unknown as typeof fetch);
    expect(tools.map((t) => t.tool)).toEqual(['search']);
    expect(updates).toEqual([{ patch: { protocol: 'mcp' } }]);
  });

  it('falls back to the legacy REST shape when the server does not speak JSON-RPC', async () => {
    const db = dbReturning([
      { id: 'eeeeeeee-0000-0000-0000-000000000000', tenantId: 1, name: 'Old Server', serverUrl: 'https://old.example', secretEnc: null, enabled: true, protocol: 'auto', allowedTools: null },
    ]);
    const fetchMock = makeFetch((url) =>
      url.endsWith('/tools')
        ? new Response(JSON.stringify({ tools: [{ name: 'lookup', description: 'Lookup', parameters: { type: 'object' } }] }), { status: 200 })
        : new Response('not found', { status: 404 }),
    );
    const tools = await listToolsForTenant(db, 1, KEY, fetchMock as unknown as typeof fetch);
    expect(tools.map((t) => t.tool)).toEqual(['lookup']);
  });
});
