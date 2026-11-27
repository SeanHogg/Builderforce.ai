import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { createMcpRelay } from '@seanhogg/builderforce-mcp';
import type { HonoEnv } from '../../../env';
import { mountMcpGatewayRoutes } from './mcpGatewayRoutes';

const { requireTenantAccess, listGatewayMcpTools } = vi.hoisted(() => ({
  requireTenantAccess: vi.fn(async () => ({ tenantId: 7, userId: 'user-1', role: 'contributor' })),
  listGatewayMcpTools: vi.fn(),
}));

vi.mock('./access', () => ({
  requireTenantAccess,
  respondToAccessError: () => new Response('Unauthorized', { status: 401 }),
}));
vi.mock('../../../application/llm/mcpGateway', () => ({
  listGatewayMcpTools,
  UnknownToolSurfaceError: class extends Error {},
}));

const legacy = {
  extensionId: 'builtin', tool: 'tasks.get', name: 'builtin_tasks_get',
  description: 'Get a task', parameters: { type: 'object' }, mutates: false,
};
const canonical = { ...legacy, name: 'platform__tasks_get', legacyName: legacy.name };

function relay() {
  const router = new Hono<HonoEnv>();
  router.use('*', async (c, next) => { c.set('db', {} as never); await next(); });
  const api = new Hono<HonoEnv>();
  mountMcpGatewayRoutes(api);
  router.route('/llm', api);
  return createMcpRelay({
    baseUrl: 'http://fixture.test', token: 'fixture', catalogNames: 'canonical',
    fetch: (input, init) => Promise.resolve(router.request(input, init, { JWT_SECRET: 'fixture' } as never)),
  });
}

describe('the raw relay canonical catalog', () => {
  it('serves the canonical name, legacy ID, and raw dispatch coordinates to authenticated clients', async () => {
    listGatewayMcpTools.mockResolvedValueOnce([canonical]);
    await expect(relay().list('chat')).resolves.toEqual([canonical]);
    expect(listGatewayMcpTools).toHaveBeenLastCalledWith(expect.objectContaining({
      names: 'canonical', tenantId: 7, role: 'contributor', surface: 'chat',
    }));
  });

  it('authenticates before exposing the canonical or legacy catalog', async () => {
    listGatewayMcpTools.mockClear();
    requireTenantAccess.mockRejectedValueOnce(new Error('unauthorized'));
    await expect(relay().list()).rejects.toThrow('HTTP 401');
    expect(listGatewayMcpTools).not.toHaveBeenCalled();
  });
});
