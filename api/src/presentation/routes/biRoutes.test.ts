import { describe, expect, it, vi } from 'vitest';

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('tenantId', 5);
    c.set('segmentId', 'seg-1');
    await next();
  },
}));
vi.mock('../../application/seams/burnRateService', () => ({
  fetchBurnRate: async () => ({ available: true, source: 'builderforce', monthlyBurn: 1200 }),
}));
vi.mock('../../application/seams/validationEngagementsService', () => ({
  fetchValidationEngagements: async () => ({ available: false, source: 'builderforce', engagements: [] }),
}));

import { createBiRoutes } from './biRoutes';

describe('biRoutes local owners', () => {
  it('returns locally-owned burn metrics', async () => {
    const response = await createBiRoutes({} as any).request('/burn-rate');
    expect(await response.json()).toEqual({ available: true, source: 'builderforce', monthlyBurn: 1200 });
  });

  it('returns locally-owned validation engagements', async () => {
    const response = await createBiRoutes({} as any).request('/validation-engagements');
    expect(await response.json()).toEqual({ available: false, source: 'builderforce', engagements: [] });
  });

  it('does not expose the retired host configuration endpoint', async () => {
    expect((await createBiRoutes({} as any).request('/config')).status).toBe(404);
  });
});
