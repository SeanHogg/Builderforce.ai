import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { HonoEnv } from '../../../env';
import { mountMcpGatewayRoutes } from './mcpGatewayRoutes';

vi.mock('./access', () => ({
  requireTenantAccess: async () => ({ tenantId: 7, userId: 'user-1', role: 'owner' }),
  respondToAccessError: () => { throw new Error('Unexpected auth error'); },
}));

const readTool = {
  extensionId: 'builtin',
  tool: 'tasks.get',
  name: 'builtin_tasks_get',
  description: 'Get a task',
  parameters: { type: 'object' },
  mutates: false,
};
const externalTool = { ...readTool, extensionId: 'external', tool: 'run', name: 'external_run', mutates: undefined };
const canonicalReadTool = { ...readTool, name: 'platform__tasks_get', legacyName: readTool.name };

vi.mock('../../../application/llm/mcpGateway', () => ({
  listGatewayMcpTools: async (context: { names?: 'canonical' }) =>
    context.names === 'canonical' ? [canonicalReadTool] : [readTool, externalTool],
  callGatewayMcpTool: async () => ({ id: 12, password: 'secret-fixture' }),
  UnknownToolSurfaceError: class extends Error {},
}));

function app() {
  const router = new Hono<HonoEnv>();
  router.use('*', async (c, next) => { c.set('db', {} as never); await next(); });
  mountMcpGatewayRoutes(router);
  return router;
}

const env = { JWT_SECRET: 'fixture' } as never;

describe('the native MCP relay projection', () => {
  it('serves model schemas and approval decisions without duplicating the legacy parameters', async () => {
    const response = await app().request('/v1/mcp/tools?format=openai', {}, env);
    const body = await response.json() as { tools: unknown[] };
    expect(body).toMatchObject({
      tools: [
        {
          extensionId: 'builtin',
          tool: 'tasks.get',
          name: 'builtin_tasks_get',
          approvalRequired: false,
          modelTool: { type: 'function', function: { name: readTool.name, description: readTool.description, parameters: readTool.parameters } },
        },
        { approvalRequired: true },
      ],
    });
    expect(body.tools[0]).not.toHaveProperty('parameters');
    const legacy = await app().request('/v1/mcp/tools', {}, env);
    expect((await legacy.json() as { tools: unknown[] }).tools).toEqual([readTool, externalTool]);
  });

  it('advertises the canonical name and carries the old name separately on opt-in model catalogs', async () => {
    const response = await app().request('/v1/mcp/tools?format=openai&names=canonical', {}, env);
    const body = await response.json();
    expect(body).toMatchObject({ tools: [{
      extensionId: 'builtin',
      tool: 'tasks.get',
      name: 'platform__tasks_get',
      legacyName: 'builtin_tasks_get',
      approvalRequired: false,
      modelTool: { function: { name: 'platform__tasks_get' } },
    }] });
  });

  it('exposes canonical names to raw REST relay clients without changing the dispatch address', async () => {
    const response = await app().request('/v1/mcp/tools?names=canonical', {}, env);
    const body = await response.json() as { tools: unknown[] };
    expect(body.tools).toEqual([canonicalReadTool]);
  });

  it('formats the protected reply before returning it to a native host', async () => {
    const response = await app().request('/v1/mcp/call?format=openai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ extensionId: 'builtin', tool: 'tasks.get', arguments: {} }),
    }, env, { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as never);
    expect(await response.json()).toEqual({ modelText: '{"id":12,"password":"[REDACTED]"}' });
  });
});
