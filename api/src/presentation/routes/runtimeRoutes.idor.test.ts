import { describe, expect, it, vi } from 'vitest';

const CALLER_TENANT = 5;

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('userId', 'user-abc');
    c.set('tenantId', CALLER_TENANT);
    c.set('role', 'developer');
    await next();
  },
  requireRole: () => async (_c: any, next: any) => next(),
}));

import { createRuntimeRoutes } from './runtimeRoutes';

/** Fake execution whose toPlain() reports the given owning tenant. */
const execOf = (tenantId: number) => ({ toPlain: () => ({ id: 1, tenantId, status: 'running' }) });

function routes(getExecution: (id: number) => Promise<unknown>) {
  const runtimeService = {
    getExecution: vi.fn(getExecution),
    cancel: vi.fn(async () => execOf(CALLER_TENANT)),
  };
  return { app: createRuntimeRoutes(runtimeService as any, {} as any), runtimeService };
}

describe('runtimeRoutes — execution reads/mutations are tenant-scoped (IDOR)', () => {
  it('GET /executions/:id returns the run when it belongs to the caller', async () => {
    const { app } = routes(async () => execOf(CALLER_TENANT));
    const res = await app.request('/executions/1');
    expect(res.status).toBe(200);
    expect((await res.json() as { tenantId: number }).tenantId).toBe(CALLER_TENANT);
  });

  it('GET /executions/:id 404s for another tenant\'s run (no data leaked)', async () => {
    const { app } = routes(async () => execOf(999));
    const res = await app.request('/executions/1');
    expect(res.status).toBe(404);
  });

  it('POST /executions/:id/cancel refuses to cancel another tenant\'s run', async () => {
    const { app, runtimeService } = routes(async () => execOf(999));
    const res = await app.request('/executions/1/cancel', { method: 'POST' });
    expect(res.status).toBe(404);
    expect(runtimeService.cancel).not.toHaveBeenCalled();
  });

  it('GET /executions/:id 404s when the run does not exist', async () => {
    const { app } = routes(async () => { throw new Error('not found'); });
    const res = await app.request('/executions/1');
    expect(res.status).toBe(404);
  });
});
