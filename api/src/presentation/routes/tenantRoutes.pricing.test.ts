import { describe, expect, it } from 'vitest';
import { TenantService } from '../../application/tenant/TenantService';
import { PLAN_LIMITS } from '../../domain/tenant/PlanLimits';
import { TenantPlan } from '../../domain/shared/types';
import { createTenantRoutes } from './tenantRoutes';

describe('GET /api/tenants/pricing contract', () => {
  it('is public and derives feature availability from enforced plan limits', async () => {
    const app = createTenantRoutes({} as TenantService, {} as never);
    const response = await app.request('/pricing');
    expect(response.status).toBe(200);

    const body = await response.json() as ReturnType<typeof TenantService.publicPricingContract>;
    expect(body.generatedFrom).toBe('TenantService.PRICING + PLAN_LIMITS');
    expect(body.pricing).toEqual(TenantService.PRICING);

    const approvals = body.featureAvailability.find((feature) => feature.key === 'approvalWorkflows');
    expect(approvals).toEqual({
      key: 'approvalWorkflows',
      free: PLAN_LIMITS[TenantPlan.FREE].approvalWorkflows,
      pro: PLAN_LIMITS[TenantPlan.PRO].approvalWorkflows,
      teams: PLAN_LIMITS[TenantPlan.TEAMS].approvalWorkflows,
    });
  });
});
