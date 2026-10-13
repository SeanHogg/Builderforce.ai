/**
 * Waitlist gates for Managed AgentHost: unpaid 403, exhausted 409, DELETE
 * only while pending. Auth is stubbed — those middlewares have their own tests.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('userId', 'user-abc');
    c.set('tenantId', 7);
    c.set('role', 'owner');
    await next();
  },
  requireRole: () => async (_c: any, next: any) => next(),
}));

import { createManagedAgentHostRoutes } from './managedAgentHostRoutes';
import { errorHandler } from '../middleware/errorHandler';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';

function harness(db: ReturnType<typeof fakeDb>) {
  const router = createManagedAgentHostRoutes(db as unknown as Db);
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
    expect(await res.json()).toMatchObject({ request: { id: 3, status: 'pending' } });
  });
});

describe('DELETE /api/managed-agent-hosts/:id', () => {
  it('conflicts when the request is no longer pending', async () => {
    const db = fakeDb([[{ id: 5, status: 'active' }]]);
    const { send } = harness(db);
    const res = await send('/5', 'DELETE');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Cannot cancel a request with status 'active'" });
  });
});
