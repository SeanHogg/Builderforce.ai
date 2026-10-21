import { describe, expect, it, vi } from 'vitest';

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));
vi.mock('../middleware/tenantContext', () => ({ optionalTenantId: () => 5 }));
const profiles = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock('../../application/artifact/capabilityContext', () => ({
  resolvePsychometricProfile: profiles.resolve,
  buildUserPersonalityBlock: vi.fn(),
}));

import { limbicTraits } from '@builderforce/agent-tools';
import { limbicSetpoints } from '@seanhogg/builderforce-memory-engine/limbic';
import { createLimbicRoutes } from './limbicRoutes';

const post = (body: unknown) =>
  createLimbicRoutes({} as never).request('/block', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

describe('POST /api/limbic/block', () => {
  it('returns the profile\'s limbic setpoints, so a client appraises each turn locally from them', async () => {
    const profile = { vector: { openness: 90, conscientiousness: 20 } };
    profiles.resolve.mockResolvedValueOnce(profile);

    const body = (await (await post({ userId: 'u1' })).json()) as { setpoints?: Record<string, number>; personaBlock: string };

    expect(body.setpoints).toEqual(limbicSetpoints(limbicTraits(profile)));
  });

  it('omits setpoints when no profile resolves (the client seeds from neutral)', async () => {
    profiles.resolve.mockResolvedValueOnce(undefined);

    const body = (await (await post({ text: '' })).json()) as Record<string, unknown>;

    expect(body).toEqual({ block: '', personaBlock: '' });
  });
});
