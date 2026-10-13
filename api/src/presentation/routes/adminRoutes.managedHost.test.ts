/**
 * Ops PATCH for Managed AgentHost: links an existing same-tenant host and
 * writes the admin audit row. Superadmin gate is stubbed.
 */
import { describe, expect, it, vi } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';

const dbRef = vi.hoisted(() => ({ current: null as ReturnType<typeof fakeDb> | null }));

vi.mock('../middleware/superAdminMiddleware', () => ({
  superAdminMiddleware: async (c: any, next: any) => {
    c.set('userId', 'sa-1');
    c.set('db', dbRef.current);
    await next();
  },
}));

import { createAdminRoutes } from './adminRoutes';
import { errorHandler } from '../middleware/errorHandler';

function harness(db: ReturnType<typeof fakeDb>) {
  dbRef.current = db;
  const router = createAdminRoutes();
  router.onError(errorHandler as never);
  const send = (path: string, method: string, body?: unknown) => router.request(
    path,
    {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    {} as never,
    { waitUntil: () => {}, passThroughOnException: () => {} } as never,
  );
  return { send };
}

describe('PATCH /api/admin/managed-agent-hosts/:id', () => {
  it('sets agentHostId and provisionedAt when moving provisioning → active', async () => {
    const now = new Date('2026-02-02T00:00:00.000Z');
    const updated = {
      id: 11, tenantId: 7, status: 'active', agentHostId: 9, provisionedAt: now,
    };
    const db = fakeDb([
      [{ id: 11, tenantId: 7, status: 'provisioning', agentHostId: null, provisionedAt: null }],
      [{ id: 9, tenantId: 7 }],
      [updated],
      [],
    ]);
    const { send } = harness(db);
    const res = await send('/managed-agent-hosts/11', 'PATCH', { status: 'active', agentHostId: 9 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ request: { status: 'active', agentHostId: 9 } });
    expect(db.calls[2]?.kind).toBe('update');
    expect((db.calls[2]?.payload as { agentHostId: number }).agentHostId).toBe(9);
    expect(db.calls[3]?.kind).toBe('insert');
  });

  it('does not silently create a host when agentHostId is missing', async () => {
    const db = fakeDb([
      [{ id: 11, tenantId: 7, status: 'provisioning', agentHostId: null, provisionedAt: null }],
    ]);
    const { send } = harness(db);
    const res = await send('/managed-agent-hosts/11', 'PATCH', { status: 'active' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'agentHostId is required when marking a request active' });
  });
});
