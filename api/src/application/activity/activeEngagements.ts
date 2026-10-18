/**
 * A worker's live freelancer engagements, read through the cache.
 *
 * Signal ingest resolves each signal to an engagement, and the VSIX flushes batches
 * every few seconds — an uncached SELECT per flush kept core Neon awake for a list that
 * changes only when a proposal is accepted or an engagement ends.
 *
 * Those writers (`marketplace/jobs/acceptProposal`, `freelancerRoutes`) do not
 * invalidate this key, so the TTL is deliberately short (KV's minimum): a new
 * engagement starts attributing within a minute, which is the same grace the portal
 * already has before a worker's first signal of the day lands.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { freelancerEngagements } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached, type CacheEnv } from '../../infrastructure/cache/readThroughCache';

const TTL_SECONDS = 60;
const L1_TTL_MS = 30_000;

export interface ActiveEngagement {
  id: string;
  tenantId: number;
  projectId: number | null;
}

export const activeEngagementsCacheKey = (userId: string): string => `engagements:active:${userId}`;

export function listActiveEngagements(db: Db, env: CacheEnv, userId: string): Promise<ActiveEngagement[]> {
  return getOrSetCached(
    env,
    activeEngagementsCacheKey(userId),
    () => db
      .select({
        id: freelancerEngagements.id,
        tenantId: freelancerEngagements.tenantId,
        projectId: freelancerEngagements.projectId,
      })
      .from(freelancerEngagements)
      .where(and(
        eq(freelancerEngagements.freelancerUserId, userId),
        isNull(freelancerEngagements.terminatedAt),
      )),
    { kvTtlSeconds: TTL_SECONDS, l1TtlMs: L1_TTL_MS },
  );
}

/** For engagement writers that want attribution to flip immediately. */
export function invalidateActiveEngagements(env: CacheEnv, userId: string): Promise<void> {
  return invalidateCached(env, activeEngagementsCacheKey(userId));
}
