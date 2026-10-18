/**
 * The cost forecast budgets against the daily cap the gateway ENFORCES (override,
 * credits and superadmin applied via resolveTenantTokenLimits) — not the bare plan
 * default — and an unlimited cap never reads as "over budget".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => { c.set('tenantId', 8); c.set('userId', 'u-1'); await next(); },
}));

const limits = vi.hoisted(() => ({ resolveTenantTokenLimits: vi.fn() }));
vi.mock('../../application/llm/tenantTokenAvailability', () => limits);
vi.mock('../../application/tenant/tenantPlanSnapshot', () => ({
  loadTenantPlanRow: vi.fn(async () => ({ plan: 'pro', billingStatus: 'active' })),
  effectivePlanOf: vi.fn(() => 'pro'),
}));
vi.mock('../../application/llm/tokenUsage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../application/llm/tokenUsage')>()),
  sumTenantTextTokens: vi.fn(async () => 1_000),
}));

import { createCostForecastRoutes } from './costForecastRoutes';

const post = () => createCostForecastRoutes({} as any).request('/', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ context: ['fix the login bug'] }),
});

beforeEach(() => limits.resolveTenantTokenLimits.mockReset());

describe('POST /api/cost-forecast budget', () => {
  it('uses the enforced (override) daily limit, not the plan default', async () => {
    limits.resolveTenantTokenLimits.mockResolvedValue({ dailyLimit: 2_500, monthlyLimit: -1, effectivePlan: 'pro' });
    const body = await (await post()).json() as any;
    expect(body.budget).toMatchObject({ dailyLimit: 2_500, unlimited: false, tokensUsedToday: 1_000, remainingBudget: 1_500 });
    expect(limits.resolveTenantTokenLimits).toHaveBeenCalledWith({}, 8, { actingUserId: 'u-1' }, undefined);
  });

  it('an unlimited cap always fits and reports remaining as -1', async () => {
    limits.resolveTenantTokenLimits.mockResolvedValue({ dailyLimit: -1, monthlyLimit: -1, effectivePlan: 'pro' });
    const body = await (await post()).json() as any;
    expect(body.budget).toMatchObject({ dailyLimit: -1, unlimited: true, remainingBudget: -1, fitsInBudget: true });
    expect(body.advice).toBeNull();
  });
});
