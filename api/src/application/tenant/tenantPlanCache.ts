/**
 * Cache identity for a tenant's plan snapshot — the key and its invalidation.
 *
 * Split from `tenantPlanSnapshot` so a WRITER (card validation, the billing
 * webhook, an admin override) can invalidate without importing the reader, and
 * the reader can import the card predicate without a cycle. Every mutation of a
 * column the snapshot carries MUST call {@link invalidateTenantPlan}; the KV
 * copy is otherwise trusted for an hour.
 */

import type { Env } from '../../env';
import { invalidateCached } from '../../infrastructure/cache/readThroughCache';

export const tenantPlanCacheKey = (tenantId: number): string => `tenant:plan:${tenantId}`;

/** Drop both cache layers for a tenant's plan snapshot. No-op without a worker env. */
export async function invalidateTenantPlan(env: Env | undefined, tenantId: number): Promise<void> {
  if (!env) return;
  await invalidateCached(env, tenantPlanCacheKey(tenantId));
}
