import { describe, expect, it, vi } from 'vitest';

const TENANT = 42;

let authOk = true;

vi.mock('./llmRoutes', () => ({
  requireTenantAccess: async () => {
    if (!authOk) throw new Error('Missing or malformed Authorization header');
    return { tenantId: TENANT, userId: 'user-1', role: 'developer', agentHostId: null };
  },
}));

vi.mock('../../infrastructure/database/connection', () => ({
  buildDatabase: () => ({}),
}));

const TOOLS = [
  { extensionId: 'builtin', tool: 'tasks.create', name: 'tasks_create', description: 'Create a ticket', parameters: { type: 'object', properties: {} }, mutates: true },
  { extensionId: 'builtin', tool: 'tasks.list', name: 'tasks_list', description: 'List tickets', parameters: { type: 'object', properties: {} }, mutates: false },
];

const calls: Array<{ extensionId: string; tool: string; arguments?: unknown }> = [];
let toolThrows = false;

vi.mock('../../application/llm/mcpGateway', () => ({
  listGatewayMcpTools: async () => TOOLS,
  resolveGatewayMcpTool: (tools: typeof TOOLS, name: string) => tools.find((t) => t.name === name) ?? null,
  callGatewayMcpTool: async (_ctx: unknown, call: { extensionId: string; tool: string; arguments?: unknown }) => {
    calls.push(call);
    if (toolThrows) throw new Error('upstream exploded');
    return { id: 7, title: 'created' };
  },
}));

import { readFileSync } from 'node:fs';
import { createMcpServerRoutes, SERVER_INFO } from './mcpServerRoutes';

const ENV = { JWT_SECRET: 'test-secret' } as never;

function rpc(body: unknown) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer bfk_test' },
    body: JSON.stringify(body),
  };
}

const post = (body: unknown) => createMcpServerRoutes().request('/', rpc(body), ENV);

describe('mcpServerRoutes — JSON-RPC 2.0 / Streamable HTTP', () => {
  it('initialize negotiates a version the client asked for', async () => {
    const res = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.jsonrpc).toBe('2.0');
    expect(body.id).toBe(1);
    expect(body.result.protocolVersion).toBe('2024-11-05');
    expect(body.result.serverInfo.name).toBe('builderforce');
    expect(body.result.capabilities.tools).toBeDefined();
  });

  it('initialize falls back to the latest version when the client asks for one we do not speak', async () => {
    const res = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
    expect((await res.json() as any).result.protocolVersion).toBe('2025-06-18');
  });

  it('tools/list advertises the gateway catalog with a read-only hint only when mutates is explicitly false', async () => {
    const res = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const { result } = await res.json() as any;
    expect(result.tools.map((t: any) => t.name)).toEqual(['tasks_create', 'tasks_list']);
    expect(result.tools[0].inputSchema).toEqual({ type: 'object', properties: {} });
    expect(result.tools[0].annotations.readOnlyHint).toBe(false);
    expect(result.tools[1].annotations.readOnlyHint).toBe(true);
  });

  it('tools/call dispatches by the ADVERTISED name and returns MCP content blocks', async () => {
    calls.length = 0;
    const res = await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'tasks_create', arguments: { title: 'x' } } });
    const { result } = await res.json() as any;
    // The advertised flat name must resolve back to the catalog's (extensionId, tool).
    expect(calls).toEqual([{ extensionId: 'builtin', tool: 'tasks.create', arguments: { title: 'x' } }]);
    expect(result.content[0].type).toBe('text');
    expect(JSON.parse(result.content[0].text)).toEqual({ id: 7, title: 'created' });
    expect(result.structuredContent).toEqual({ id: 7, title: 'created' });
    expect(result.isError).toBeUndefined();
  });

  it('a failing tool is a result with isError, not a JSON-RPC error', async () => {
    toolThrows = true;
    const res = await post({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'tasks_create' } });
    toolThrows = false;
    const body = await res.json() as any;
    expect(body.error).toBeUndefined();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain('upstream exploded');
  });

  it('an unknown tool is invalid params', async () => {
    const res = await post({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope' } });
    expect((await res.json() as any).error.code).toBe(-32602);
  });

  it('notifications are accepted with 202 and no body', async () => {
    const res = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe('');
  });

  it('unknown methods are method-not-found', async () => {
    const res = await post({ jsonrpc: '2.0', id: 6, method: 'resources/list' });
    expect((await res.json() as any).error.code).toBe(-32601);
  });

  it('malformed JSON is a parse error', async () => {
    const res = await createMcpServerRoutes().request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer bfk_test' },
      body: '{not json',
    }, ENV);
    expect(res.status).toBe(400);
    expect((await res.json() as any).error.code).toBe(-32700);
  });

  it('a legacy batch answers only the requests and drops the notifications', async () => {
    const res = await post([
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 'a', method: 'ping' },
    ]);
    const body = await res.json() as any[];
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('a');
  });

  it('an all-notification batch is 202 with no body', async () => {
    const res = await post([{ jsonrpc: '2.0', method: 'notifications/initialized' }]);
    expect(res.status).toBe(202);
  });

  it('missing auth is 401 with a Bearer challenge, not the gateway error shape', async () => {
    authOk = false;
    const res = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    authOk = true;
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('Bearer');
    expect((await res.json() as any).error.code).toBe(-32600);
  });

  it('the MCP Registry manifest describes the endpoint we actually serve', () => {
    // ../server.json relative to the api package root (vitest cwd).
    const manifest = JSON.parse(readFileSync('../server.json', 'utf8')) as {
      version: string;
      remotes: Array<{ type: string; url: string }>;
    };
    // A published listing that points somewhere we don't serve, or claims a
    // version we don't advertise, is a broken install for every client that
    // discovers us through the registry.
    expect(manifest.version).toBe(SERVER_INFO.version);
    expect(manifest.remotes[0].type).toBe('streamable-http');
    expect(new URL(manifest.remotes[0].url).pathname).toBe('/mcp');
  });

  it('GET and DELETE are refused — this server is stateless', async () => {
    const get = await createMcpServerRoutes().request('/', { method: 'GET' }, ENV);
    const del = await createMcpServerRoutes().request('/', { method: 'DELETE' }, ENV);
    expect(get.status).toBe(405);
    expect(del.status).toBe(405);
  });
});
