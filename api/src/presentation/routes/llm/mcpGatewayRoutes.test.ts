import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { HonoEnv } from '../../../env';
import { TenantRole } from '../../../domain/shared/types';

vi.mock('./access', async (orig) => ({
  ...(await orig<typeof import('./access')>()),
  requireTenantAccess: async () => ({ tenantId: 7, userId: 'user-1', role: TenantRole.OWNER }),
}));

import { mountMcpGatewayRoutes } from './mcpGatewayRoutes';

const app = () => {
  const router = new Hono<HonoEnv>();
  // A db the handler never reaches: the argument check refuses the call before it runs.
  router.use('*', async (c, next) => { c.set('db', {} as never); await next(); });
  mountMcpGatewayRoutes(router);
  return router;
};

describe('POST /v1/mcp/call — built-in tool argument refusal', () => {
  it('answers 400 naming the missing required argument, not a 502 upstream error', async () => {
    const res = await app().request('/v1/mcp/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ extensionId: 'builtin', tool: 'tickets.from_delta', arguments: { projectId: 3, files: ['a.ts'] } }),
    }, { JWT_SECRET: 'x' } as never, { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as never);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/tickets\.from_delta: missing required argument "summary"/);
    expect(res.status).toBe(400);
  });
});
