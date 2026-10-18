/**
 * Cache identity + invalidation for the three tenant reads every app-shell load makes:
 * the workspace snapshot (`GET /api/tenants/:id`), the menu preferences
 * (`GET /api/tenants/:id/navigation-features`) and the caller's own workspace list
 * (`GET /api/tenants`, `/mine`).
 *
 * Each of those used to run its SQL (the snapshot hydrating EVERY member row) on every
 * page load, which on neon-http keeps compute awake. Writers invalidate from the hooks
 * that already exist — {@link invalidateTenantPlan} (every tenant-row mutation) and
 * `membershipChanged` (every roster mutation) — so a new writer needs no extra call.
 * The short TTLs are the floor for writers that predate those hooks.
 */
import type { Env } from '../../env';
import { invalidateCached } from '../../infrastructure/cache/readThroughCache';

export const TENANT_READ_TTL = { kvTtlSeconds: 60, l1TtlMs: 15_000 };

export const tenantSnapshotKey = (tenantId: number): string => `tenant:snapshot:${tenantId}`;
export const navigationFeaturesKey = (tenantId: number): string => `tenant:nav-features:${tenantId}`;
export const myWorkspacesKey = (userId: string): string => `tenant:my-workspaces:${userId}`;

export async function invalidateTenantSnapshot(env: Env | undefined, tenantId: number): Promise<void> {
  if (!env) return;
  await invalidateCached(env, tenantSnapshotKey(tenantId));
}

export async function invalidateNavigationFeatures(env: Env | undefined, tenantId: number): Promise<void> {
  if (!env) return;
  await invalidateCached(env, navigationFeaturesKey(tenantId));
}

export async function invalidateMyWorkspaces(env: Env | undefined, userIds: readonly string[]): Promise<void> {
  if (!env) return;
  await Promise.all(userIds.map((userId) => invalidateCached(env, myWorkspacesKey(userId))));
}
