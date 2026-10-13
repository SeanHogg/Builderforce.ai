/**
 * Managed AgentHost checkout gates: Free/unpaid 403, already-covering 409.
 * Pricing is stubbed so this file only proves the entitlement policy.
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
vi.mock('../../application/tenant/pricingConfiguration', async (orig) => ({
  ...(await orig<typeof import('../../application/tenant/pricingConfiguration')>()),
  getPublishedPricing: vi.fn(async () => ({
    currency: 'USD',
    pricing: { managedAgentHost: { perAgentHostMonthly: 49 } },
  })),
}));

import { createTenantRoutes } from './tenantRoutes';
import { errorHandler } from '../middleware/errorHandler';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';

function harness(opts: {
  db?: ReturnType<typeof fakeDb>;
  subscription: { billingStatus: string; effectivePlan: string };
}) {
  const db = opts.db ?? fakeDb([[]]);
  const tenantService = {
    getSubscription: vi.fn(async () => opts.subscription),
    createManagedAgentHostCheckoutSession: vi.fn(),
  };
  const router = createTenantRoutes(tenantService as any, db as unknown as Db);
  router.onError(errorHandler as never);
  const send = (path: string, method: string, body: unknown) => router.request(
    path,
    {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    {} as never,
    { waitUntil: () => {}, passThroughOnException: () => {} } as never,
  );
  return { tenantService, send };
}

describe('POST /api/tenants/:id/add-ons/managed-agent-host/checkout', () => {
  it('forbids Free tenants with 403', async () => {
    const { send, tenantService } = harness({
      subscription: { billingStatus: 'active', effectivePlan: 'free' },
    });
    const res = await send(`/${CALLER_TENANT}/add-ons/managed-agent-host/checkout`, 'POST', {
      billingEmail: 'ops@example.com',
      quantity: 1,
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Managed AgentHost requires an active Pro or Teams plan' });
    expect(tenantService.createManagedAgentHostCheckoutSession).not.toHaveBeenCalled();
  });

  it('conflicts when the active entitlement already covers the requested quantity', async () => {
    const db = fakeDb([[{ value: { status: 'active', quantity: 1 }, updatedAt: new Date() }]]);
    const { send, tenantService } = harness({
      db,
      subscription: { billingStatus: 'active', effectivePlan: 'pro' },
    });
    const res = await send(`/${CALLER_TENANT}/add-ons/managed-agent-host/checkout`, 'POST', {
      billingEmail: 'ops@example.com',
      quantity: 1,
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Managed AgentHost already covers the requested quantity' });
    expect(tenantService.createManagedAgentHostCheckoutSession).not.toHaveBeenCalled();
  });
});
