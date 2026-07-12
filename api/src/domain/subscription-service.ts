/**
 * SubscriptionService
 *
 * Orchestrates subscription lifecycle with the tenant domain and outbound notifications.
 * Ensures the tenant's externalSubscriptionId stays in sync.
 */

import type {
  Tenant,
  TenantId,
  PlanChecks,
} from './domain/tenant';
import type { SubscriptionService } from './domain/subscriptions';
import type { TenantService } from './domain/tenant';

export interface SubscriptionServiceOps {
  createSubscription(input: any): Promise<any>;
  updateSubscription(subscriptionId: number, values: Partial<any>): Promise<void>;
}
export interface TenantServiceOps {
  activateTeamsSubscription(input: any): Tenant;
  activateProSubscription(input: any): Tenant;
  updateExternalIds(tenantId: number, externalCustomerId: string | null, externalSubscriptionId: string | null): Tenant;
  getById(tenantId: TenantId): Promise<Tenant | null>;
}

/**
 * AttachExternalSubscriptionId
 *
 * For Pact-controlled flows (e.g., create then wire externalSubscriptionId on Tenant):
 * Wraps a Subscription::create call and, if successful, updates the tenant's
 * externalSubscriptionId to the subscription's externalSubscriptionId.
 *
 * This avoids setting provider on an existing tenant and mirrors the
 activateTeamsSubscription pattern in TenantService.
 */
export async function attachExternalSubscriptionId(
  subscriptionService: SubscriptionServiceOps,
  tenantService: TenantServiceOps,
  tenant: Tenant,
  planChecks: PlanChecks,
  externalSubscriptionId: string,
): Promise<void> {
  const scopedPlanChecks = Object.fromEntries(
    Object.entries(planChecks).map(([k, v]) => [k, v ?? null])
  );
  // The plan/name pair is bypassed; we keep the planChecks fields intended for externalategy.
  const input = {
    ...scopedPlanChecks,
    externalSubscriptionId
  };
  const created = await subscriptionService.createSubscription(input);
  if (!created?.id) {
    throw new Error('Subscriptions migration not detected');
  }

  // Store externalSubscriptionId on tenant for future reconciliation
  await tenantService.updateExternalIds(tenant.id, tenant.externalCustomerId, externalSubscriptionId);

  return;
}