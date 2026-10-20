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
import { invalidateTenantMembersWorkspaces, invalidateTenantSnapshot } from './tenantReadCache';
import { reportCaughtError } from '../observability/caughtErrorReporter';

export const tenantPlanCacheKey = (tenantId: number): string => `tenant:plan:${tenantId}`;

/**
 * Drop both cache layers for a tenant's plan snapshot, the workspace snapshot, and
 * every member's "my workspaces" list (which embeds the same name/plan/billing/trial
 * columns — a plan change was otherwise invisible in the switcher for up to 60s).
 * No-op without a worker env. Pass `memberUserIds` when the caller already holds the
 * roster to skip the member read.
 */
export async function invalidateTenantPlan(
  env: Env | undefined,
  tenantId: number,
  opts: { memberUserIds?: readonly string[] } = {},
): Promise<void> {
  if (!env) return;
  await Promise.all([
    invalidateCached(env, tenantPlanCacheKey(tenantId)),
    // The workspace snapshot carries the same plan/billing columns.
    invalidateTenantSnapshot(env, tenantId),
    invalidateTenantMembersWorkspaces(env, tenantId, opts).catch((error: unknown) => {
      // The 60s TTL is the floor; a failed roster read must not fail the billing write.
      reportCaughtError(error, { source: 'application/tenant/tenantPlanCache.ts', operation: 'invalidateTenantMembersWorkspaces', context: { tenantId } });
    }),
  ]);
}
