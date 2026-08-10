import { describe, expect, it } from 'vitest';
import { TenantService } from '../../application/tenant/TenantService';
import { createTenantRoutes } from './tenantRoutes';

describe('GET /api/tenants/pricing contract', () => {
  it('is public and returns the published plan content', async () => {
    const db = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) };
    const app = createTenantRoutes({} as TenantService, db as never);
    const response = await app.request('/pricing');
    expect(response.status).toBe(200);

    const body = await response.json() as ReturnType<typeof TenantService.publicPricingContract> & { plans: Array<{ id: string; features: string[] }> };
    expect(body.pricing).toEqual(TenantService.PRICING);
    expect(body.plans.find((plan) => plan.id === 'pro')?.features).toContain('Approval workflows');
    expect(response.headers.get('cache-control')).toContain('public');
  });
});
