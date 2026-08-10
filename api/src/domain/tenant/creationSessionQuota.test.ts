import { describe, expect, it } from 'vitest';
import { TenantPlan } from '../shared/types';
import { creationSessionQuotaError, resolveCreationSessionQuota } from './creationSessionQuota';

describe('Creation Session quota policy', () => {
  it('routes a free account at its cap to the upgrade flow', () => {
    const quota = resolveCreationSessionQuota({
      used: 10,
      planLimit: 10,
      currentPlan: TenantPlan.FREE,
      isSuperadmin: false,
    });

    expect(quota.allowed).toBe(false);
    expect(creationSessionQuotaError(quota)).toMatchObject({
      code: 'CREATION_SESSION_QUOTA',
      upgradeRequired: true,
      currentPlan: TenantPlan.FREE,
      usage: 10,
      limit: 10,
    });
  });

  it('makes a superadmin unlimited regardless of tenant plan or usage', () => {
    expect(resolveCreationSessionQuota({
      used: 10,
      planLimit: 10,
      currentPlan: TenantPlan.FREE,
      isSuperadmin: true,
    })).toEqual({
      used: 10,
      limit: -1,
      allowed: true,
      currentPlan: TenantPlan.FREE,
    });
  });
});
