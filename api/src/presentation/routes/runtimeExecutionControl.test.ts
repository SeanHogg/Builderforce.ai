import { describe, expect, it, vi } from 'vitest';

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('userId', 'manager-1');
    c.set('tenantId', 7);
    c.set('role', 'manager');
    await next();
  },
  requireRole: () => async (_c: any, next: any) => next(),
}));

import { createRuntimeRoutes } from './runtimeRoutes';

const cancelledExecution = (id: number) => ({
  id,
  status: 'cancelled',
  toPlain: () => ({ id, tenantId: 7, status: 'cancelled' }),
});

describe('runtime execution control', () => {
  it('reads the persisted workspace switch', async () => {
    const db = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ enabled: false }] }) }) }),
    };
    const app = createRuntimeRoutes({} as any, db as any);

    const response = await app.request('/execution-control');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: false });
  });

  it('disables first and cancels running and paused executions', async () => {
    const updated: Array<Record<string, unknown>> = [];
    let selectCount = 0;
    const db = {
      update: () => ({
        set: (value: Record<string, unknown>) => {
          updated.push(value);
          return { where: () => ({ returning: async () => [{ enabled: false }] }) };
        },
      }),
      select: () => ({
        from: () => ({
          where: async () => (++selectCount === 1
            ? [{ id: 10, agentHostId: null }, { id: 11, agentHostId: null }]
            : []),
        }),
      }),
    };
    const runtimeService = { cancel: vi.fn(async (id: number) => cancelledExecution(id)) };
    const app = createRuntimeRoutes(runtimeService as any, db as any);

    const response = await app.request('/execution-control', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });

    expect(response.status).toBe(200);
    expect(updated[0]).toMatchObject({ agentExecutionEnabled: false });
    expect(runtimeService.cancel).toHaveBeenCalledTimes(2);
    expect(await response.json()).toEqual({
      enabled: false,
      stopped: { requested: 2, cancelled: 2, failed: [] },
    });
  });
});
