/**
 * The cache behind every read of a workspace's SKILL ASSIGNMENTS — the tenant-wide
 * slugs the skill library catalog lists, and the per-host set an on-prem runtime syncs
 * against. Both are read on every gateway tool listing / sync tick and change only when
 * someone assigns or unassigns a skill.
 *
 * One VERSION TOKEN per tenant rather than one key per read: the host-scoped keyspace is
 * unbounded (one per host), so a write cannot name every key it stales. A write bumps the
 * token; every key built through {@link skillAssignmentCacheKey} moves with it.
 */

import { bumpCacheVersion, getCacheVersion } from '../../infrastructure/cache/readThroughCache';
import type { Env } from '../../env';

const versionKey = (tenantId: number): string => `skill-assignments-version:tenant:${tenantId}`;

/** A cache key for one assignment read, under the tenant's current version. */
export async function skillAssignmentCacheKey(env: Env | undefined, tenantId: number, read: string): Promise<string> {
  const version = env ? await getCacheVersion(env, versionKey(tenantId)) : 0;
  return `skill-assignments:${tenantId}:v${version}:${read}`;
}

/** Stale every cached assignment read for this tenant — call after any skill assignment write. */
export async function invalidateSkillAssignmentCaches(env: Env | undefined, tenantId: number): Promise<void> {
  await bumpCacheVersion(env, versionKey(tenantId));
}
