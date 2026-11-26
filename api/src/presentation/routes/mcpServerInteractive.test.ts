import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';
import type { GatewayMcpContext } from '../../application/llm/mcpGateway';

const stubs = vi.hoisted(() => ({
  access: vi.fn(),
  list: vi.fn(),
  publicList: vi.fn(),
}));
vi.mock('./llmRoutes', () => ({ requireTenantAccess: stubs.access }));
vi.mock('../../application/llm/mcpGateway', () => ({
  listGatewayMcpTools: stubs.list,
  listPublicMcpTools: stubs.publicList,
  callGatewayMcpTool: vi.fn(),
  resolveGatewayMcpTool: vi.fn(),
}));

import { createMcpServerRoutes } from './mcpServerRoutes';

const ENV = { JWT_SECRET: 'test-secret' } as Env;
const INTERACTIVE = '/?profile=interactive&surface=readonly';
const ACCESS = { tenantId: 2, userId: 'u1', tenantApiKeyId: 'key', agentHostId: null, role: 'developer' };
const HEADERS = { authorization: 'Bearer bfk_test' };
const first = { extensionId: 'builtin', tool: 'tasks.list', name: 'platform__tasks_list', description: 'List tickets', parameters: { type: 'object' }, mutates: false };
const second = { ...first, tool: 'tasks.get', name: 'platform__tasks_get' };

beforeEach(() => {
  vi.resetAllMocks();
  stubs.access.mockImplementation(async (c: { req: { header(name: string): unknown } }) => {
    if (!c.req.header('Authorization')) throw new Error('missing credentials');
    return ACCESS;
  });
});

function rpc(method: string, params?: unknown) {
  return {
    method: 'POST',
    headers: { ...HEADERS, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  };
}

function subscribe(app: ReturnType<typeof createMcpServerRoutes>) {
  return app.request(INTERACTIVE, { headers: { ...HEADERS, accept: 'text/event-stream' } }, ENV);
}

describe('Platform MCP interactive profile', () => {
  it('discovers static documentation and prompts for authenticated connections', async () => {
    const app = createMcpServerRoutes();
    const send = async (method: string, params?: unknown) => {
      const response = await app.request(INTERACTIVE, rpc(method, params), ENV);
      expect(response.status).toBe(200);
      return response.json();
    };
    expect(await send('initialize', {
      protocolVersion: '2025-11-25', clientInfo: { name: 'test', version: '1' }, capabilities: {},
    })).toMatchObject({ result: { capabilities: { tools: { listChanged: true }, resources: {}, prompts: {} } } });
    expect(await send('resources/list')).toMatchObject({
      result: { resources: [{ uri: 'builderforce://mcp/catalog', mimeType: 'text/markdown' }] },
    });
    expect(await send('resources/read', { uri: 'builderforce://mcp/catalog' })).toMatchObject({
      result: { contents: [{ text: expect.stringContaining('readonly') }] },
    });
    expect(await send('resources/read', { uri: 'file:///private' })).toMatchObject({ error: { code: -32602 } });
    expect(await send('prompts/list')).toMatchObject({ result: { prompts: [{ name: 'discover_tools' }] } });
    expect(await send('prompts/get', { name: 'discover_tools' })).toMatchObject({
      result: { messages: [{ role: 'user', content: { type: 'text', text: expect.stringContaining('tools/list') } }] },
    });
    expect(stubs.list).not.toHaveBeenCalled();
    expect(stubs.publicList).not.toHaveBeenCalled();
  });

  it('requires authentication before opening a catalog stream', async () => {
    const app = createMcpServerRoutes();
    const response = await app.request(INTERACTIVE, {
      headers: { accept: 'text/event-stream' },
    }, ENV);
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('Bearer');
    expect((await app.request(INTERACTIVE, {
      ...rpc('resources/list'), headers: { 'content-type': 'application/json' },
    }, ENV)).status).toBe(401);
    expect(stubs.list).not.toHaveBeenCalled();
  });

  it('notifies on a change to the authorized surface and ignores reorderings', async () => {
    stubs.list.mockResolvedValueOnce([first, second]).mockResolvedValueOnce([second, first]).mockResolvedValue([second]);
    const response = await subscribe(createMcpServerRoutes({ intervalMs: 5, lifetimeMs: 2_000 }));
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    try {
      const { value } = await reader.read();
      const event = new TextDecoder().decode(value);
      expect(event).toContain('"method":"notifications/tools/list_changed"');
      expect(event).not.toContain('platform__tasks_list');
      expect(stubs.list).toHaveBeenCalledTimes(3);
      for (const [scope] of stubs.list.mock.calls as [GatewayMcpContext][]) {
        expect(scope).toMatchObject({ tenantId: ACCESS.tenantId, role: ACCESS.role, surface: 'readonly', names: 'canonical' });
      }
    } finally {
      await reader.cancel();
    }
  });

  it('ends a stream when authentication changes workspace', async () => {
    stubs.access.mockResolvedValueOnce(ACCESS).mockResolvedValueOnce(ACCESS).mockResolvedValue({ ...ACCESS, tenantId: 7 });
    stubs.list.mockResolvedValue([first]);
    const response = await subscribe(createMcpServerRoutes({ intervalMs: 5, lifetimeMs: 2_000 }));
    const reader = response.body!.getReader();
    expect(await reader.read()).toMatchObject({ done: true });
    expect(stubs.list).toHaveBeenCalledOnce();
  });

  it('releases the response at its deadline when a catalog lookup stalls', async () => {
    stubs.list.mockImplementation(() => new Promise(() => undefined));
    const response = await subscribe(createMcpServerRoutes({ lifetimeMs: 20 }));
    const reader = response.body!.getReader();
    expect(await reader.read()).toMatchObject({ done: true });
    expect(stubs.list).toHaveBeenCalledOnce();
  });
});
