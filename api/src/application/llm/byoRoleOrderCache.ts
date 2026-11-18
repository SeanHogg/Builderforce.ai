/**
 * Cache keys for `GET /llm/byo-order` (`byoRoleOrder.ts`) — a LEAF, so every writer of a
 * routing input can invalidate it without importing the use case (and its credential
 * resolver, which imports several of those writers back).
 *
 * One answer per tenant × role, behind ONE per-tenant version token: a write that changes
 * the order (a key connected, rotated or removed, a precedence change, a model selection,
 * an OpenRouter connection, an auth alert raised or cleared, low headroom recorded) bumps
 * the token and orphans every role's entry at once, instead of enumerating the roles.
 */

import { bumpCacheVersionSafe, type CacheEnv } from '../../infrastructure/cache/readThroughCache';

export function byoRoleOrderVersionKey(tenantId: number): string {
  return `byo-role-order-version:tenant:${tenantId}`;
}

export function byoRoleOrderCacheKey(tenantId: number, role: string, version: string): string {
  return `byo-role-order:${tenantId}:${role}:v:${version}`;
}

/** Orphan every cached role order for a tenant. Never throws — call from write paths. */
export async function invalidateByoRoleOrder(env: CacheEnv, tenantId: number): Promise<void> {
  await bumpCacheVersionSafe(env, byoRoleOrderVersionKey(tenantId), 'invalidateByoRoleOrder', { tenantId });
}
