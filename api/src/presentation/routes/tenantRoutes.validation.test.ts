/**
 * The tenant / billing surface reads its bodies through `parseBody`: a wrong SHAPE
 * is `400 { error, code: 'invalid_request', issues }` with the field path — never a
 * TypeError answered as a 500 — while a handler's own "X is required" sentence
 * still wins for a field the schema deliberately leaves optional.
 *
 * `onError` is the app's own handler: `parseBody` REJECTS rather than returning,
 * so a harness without it would score every refusal as a 500 and prove nothing.
 */
import { describe, expect, it, vi } from 'vitest';

const CALLER_TENANT = 5;

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('userId', 'user-abc');
    c.set('tenantId', CALLER_TENANT);
    c.set('role', 'owner');
    await next();
  },
  requireRole: () => async (_c: any, next: any) => next(),
}));
vi.mock('../middleware/webAuthMiddleware', () => ({
  webAuthMiddleware: async (c: any, next: any) => {
    c.set('userId', 'user-abc');
    await next();
  },
}));
vi.mock('../middleware/requirePermission', () => ({
  requirePermission: () => async (_c: any, next: any) => next(),
}));
vi.mock('../../application/agent/provisionBuiltinAgents', () => ({
  provisionBuiltinAgents: vi.fn(async () => undefined),
}));

import { createTenantRoutes } from './tenantRoutes';
import { errorHandler } from '../middleware/errorHandler';

function harness() {
  const tenantService = {
    createTenant: vi.fn(async ({ name }: { name: string }) => ({ id: 9, toPlain: () => ({ id: 9, name }) })),
    addMember: vi.fn(),
  };
  const router = createTenantRoutes(tenantService as any, {} as any);
  router.onError(errorHandler as never);
  const send = (path: string, method: string, body: unknown) => router.request(
    path,
    {
      method,
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
    {} as never,
    { waitUntil: () => {}, passThroughOnException: () => {} } as never,
  );
  return { tenantService, send };
}

describe('tenantRoutes — request-body validation', () => {
  it('admits a well-formed body unchanged (POST /create)', async () => {
    const { tenantService, send } = harness();
    const res = await send('/create', 'POST', { name: 'Acme', extra: 'ignored' });
    expect(res.status).toBe(201);
    expect(tenantService.createTenant).toHaveBeenCalledWith({ name: 'Acme', ownerUserId: 'user-abc' });
  });

  it('refuses a wrongly-typed field as 400 invalid_request with its path', async () => {
    const { tenantService, send } = harness();
    const res = await send('/create', 'POST', { name: 42 });
    expect(res.status).toBe(400);
    const body = await res.json() as { code: string; issues: Array<{ path: string }> };
    expect(body.code).toBe('invalid_request');
    expect(body.issues.map((i) => i.path)).toEqual(['name']);
    expect(tenantService.createTenant).not.toHaveBeenCalled();
  });

  it('answers malformed JSON as the same 400, not a thrown SyntaxError', async () => {
    const { send } = harness();
    const res = await send('/create', 'POST', '{"name": ');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: 'invalid_request',
      issues: [{ path: '', message: 'Request body must be valid JSON' }],
    });
  });

  it("keeps the handler's own sentence for a field the schema leaves optional", async () => {
    const { send } = harness();
    const res = await send('/create', 'POST', {});
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'name is required' });
  });

  it('refuses a role outside TenantRole before the seat guard or the service runs', async () => {
    const { tenantService, send } = harness();
    const res = await send(`/${CALLER_TENANT}/members`, 'POST', { newUserId: 'user-2', role: 'root' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'invalid_request', issues: [{ path: 'role' }] });
    expect(tenantService.addMember).not.toHaveBeenCalled();
  });

  it('refuses a billing cycle outside the enum on checkout', async () => {
    const { send } = harness();
    const res = await send(`/${CALLER_TENANT}/subscription/checkout`, 'POST', {
      billingCycle: 'weekly',
      billingEmail: 'owner@example.com',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'invalid_request', issues: [{ path: 'billingCycle' }] });
  });

  it('refuses a non-numeric spend cap as a shape error', async () => {
    const { send } = harness();
    const res = await send(`/${CALLER_TENANT}/spend-limits`, 'PATCH', { amountUsd: 'ten' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'invalid_request', issues: [{ path: 'amountUsd' }] });
  });
});
