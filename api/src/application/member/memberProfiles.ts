/**
 * The tenant's member profiles, read through the shared cache.
 *
 * Extracted from `memberRoutes` (0366) once a SECOND caller appeared: the ceremony
 * conclude path reads `member_profiles.pto` to excuse someone on approved leave. Two
 * readers means two chances to disagree about the cache key — and a stale or unshared
 * key here is not a performance detail, it is the difference between "on holiday" and
 * "absent", which is an input to the rules that can reassign that person's work.
 *
 * Profiles change rarely and are read per-project on every ceremony conclude, so the
 * read goes through the canonical L1+KV helper under the SAME key `GET
 * /api/members/profiles` uses; the profile PUT already invalidates it.
 */

import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { memberProfiles } from '../../infrastructure/database/schema';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';

/** THE cache key for a tenant's member profiles. Invalidated by the profile PUT. */
export function memberProfilesCacheKey(tenantId: number): string {
  return `member-profiles:tenant:${tenantId}`;
}

export type MemberProfileRow = typeof memberProfiles.$inferSelect;

/** Every member profile for a tenant, read through the shared cache. */
export function readMemberProfiles(env: Env, db: Db, tenantId: number): Promise<MemberProfileRow[]> {
  return getOrSetCached(env, memberProfilesCacheKey(tenantId), () =>
    db.select().from(memberProfiles).where(eq(memberProfiles.tenantId, tenantId)),
  );
}
