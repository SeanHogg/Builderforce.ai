import { beforeEach, describe, expect, it, vi } from 'vitest';

const { tenantHasFeature } = vi.hoisted(() => ({
  tenantHasFeature: vi.fn(),
}));

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (_c: unknown, next: () => Promise<void>) => next(),
  optionalAuthMiddleware: async (c: any, next: () => Promise<void>) => {
    if (c.req.header('Authorization') === 'Bearer tenant-token') {
      c.set('tenantId', 91);
      c.set('userId', 'user-1');
    }
    await next();
  },
}));

vi.mock('../middleware/featureGate', () => ({ tenantHasFeature }));

import { createPersonaRoutes } from './personaRoutes';

const ENV = { JWT_SECRET: 'test-secret' } as any;

describe('GET /psychometric/catalog', () => {
  beforeEach(() => {
    tenantHasFeature.mockReset();
  });

  it('serves the read-only catalog without Authorization for public marketplace cards', async () => {
    const res = await createPersonaRoutes({} as any).request('/psychometric/catalog', {}, ENV);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      entitled: false,
      requiredPlan: 'pro',
      frameworks: expect.any(Array),
      questions: expect.any(Array),
      enneagram: expect.any(Array),
    });
    expect(tenantHasFeature).not.toHaveBeenCalled();
  });

  it('adds the tenant entitlement when a workspace identity is available', async () => {
    tenantHasFeature.mockResolvedValue(true);

    const res = await createPersonaRoutes({} as any).request('/psychometric/catalog', {
      headers: { Authorization: 'Bearer tenant-token' },
    }, ENV);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ entitled: true });
    expect(tenantHasFeature).toHaveBeenCalledWith(
      ENV,
      91,
      'user-1',
      'psychometricPersona',
    );
  });
});
