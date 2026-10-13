/**
 * Managed AgentHost request gates: unpaid 403, exhausted 409, POST 201 kicks
 * off provision, DELETE cancels pending and occupying. Auth is injected so
 * this file does not depend on vi.mock intercepting authMiddleware.
 */
import { describe, expect, it } from 'vitest';
import type { MiddlewareHandler } from 'hono';
import { createManagedAgentHostRoutes } from './managedAgentHostRoutes';
import { errorHandler } from '../middleware/errorHandler';
import { fakeDb } from '../../../test/fakeDb';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const stubAuth: MiddlewareHandler<HonoEnv> = async (c, next) => {
  c.set('userId', 'user-abc');
  c.set('tenantId', 7);
  c.set('role', 'owner');
  await next();
};

function harness(db: ReturnType<typeof fakeDb>) {
  const router = createManagedAgentHostRoutes(db as unknown as Db, stubAuth);
  router.onError(errorHandler as never);
  const send = (path: string, method: string, body?: unknown) => router.request(
    path,
    {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    },
    {} as never,
    { waitUntil: () => {}, passThroughOnException: () => {} } as never,
  );
  return { send };
}

describe('POST /api/managed-agent-hosts', () => {
  it('refuses unpaid tenants with 403', async () => {
    const db = fakeDb([[], []]);
    const { send } = harness(db);
    const res = await send('/', 'POST', { agentHostName: 'east-1' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Managed AgentHost requires an active paid add-on' });
  });

  it('conflicts when the paid quantity is already occupied', async () => {
    const db = fakeDb([
      [{ value: { status: 'active', quantity: 1 }, updatedAt: new Date() }],
      [{ id: 1 }],
    ]);
    const { send } = harness(db);
    const first = await send('/', 'POST', { agentHostName: 'east-1' });
    expect(first.status).toBe(409);
    expect(await first.json()).toEqual({ error: 'All paid Managed AgentHost slots are in use' });
  });

  it('accepts a request when a paid slot is free', async () => {
    const inserted = {
      id: 3, tenantId: 7, agentHostName: 'east-1', region: 'us-east', notes: null, status: 'pending',
    };
    const db = fakeDb([
      [{ value: { status: 'active', quantity: 1 }, updatedAt: new Date() }],
      [],
      [inserted],
    ]);
    const { send } = harness(db);
    const res = await send('/', 'POST', { agentHostName: 'east-1' });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      request: { id: 3, status: 'pending' },
      message: 'Your managed AgentHost request was accepted. Provisioning has started; the host will show as active once the runtime is ready.',
    });
  });
});

describe('DELETE /api/managed-agent-hosts/:id', () => {
  it('cancels a pending request', async () => {
    const pending = {
      id: 5, tenantId: 7, status: 'pending', agentHostId: null, agentHostName: 'east-1', region: 'us-east',
    };
    const db = fakeDb([[pending], [{ ...pending, status: 'cancelled' }]]);
    const { send } = harness(db);
    const res = await send('/5', 'DELETE');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('deprovisions an occupying request instead of 409', async () => {
    const active = {
      id: 5, tenantId: 7, status: 'active', agentHostId: null, agentHostName: 'east-1', region: 'us-east',
    };
    const db = fakeDb([[active], [{ ...active, status: 'cancelled' }]]);
    const { send } = harness(db);
    const res = await send('/5', 'DELETE');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('conflicts when the request already failed', async () => {
    const db = fakeDb([[{ id: 5, tenantId: 7, status: 'failed' }]]);
    const { send } = harness(db);
    const res = await send('/5', 'DELETE');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Cannot cancel a request with status 'failed'" });
  });
});
