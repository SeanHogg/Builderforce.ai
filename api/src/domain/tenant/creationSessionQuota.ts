import type { TenantPlan } from '../shared/types';

export interface CreationSessionQuota {
  used: number;
  limit: number;
  allowed: boolean;
  currentPlan: TenantPlan;
}

/** Canonical saved-Session quota policy. Platform superadmins are unlimited. */
export function resolveCreationSessionQuota(input: {
  used: number;
  planLimit: number;
  currentPlan: TenantPlan;
  isSuperadmin: boolean;
}): CreationSessionQuota {
  const limit = input.isSuperadmin ? -1 : input.planLimit;
  return {
    used: input.used,
    limit,
    allowed: limit === -1 || input.used < limit,
    currentPlan: input.currentPlan,
  };
}

/** Standard 402 body consumed by the frontend's typed upgrade flow. */
export function creationSessionQuotaError(quota: CreationSessionQuota) {
  return {
    error: `Your account includes ${quota.limit} Creation Sessions. Upgrade your account to create another saved Session.`,
    code: 'CREATION_SESSION_QUOTA' as const,
    upgradeRequired: true as const,
    currentPlan: quota.currentPlan,
    usage: quota.used,
    limit: quota.limit,
  };
}
