/**
 * Platform proof — the live counts the marketing site uses as social proof.
 *
 * Every number here is a real COUNT of real rows; the marketing site may choose
 * which ones to show (it hides any below a display floor) but never invents or
 * rounds one up. Social proof that cannot be traced back to this query does not
 * belong on the site.
 *
 * Cached for an hour through the canonical read-through cache: the figures
 * change on every signup and run, so there is no write to invalidate on — a
 * bounded TTL is the honest freshness contract for a running total, and it
 * keeps the public endpoint at one DB round-trip per hour regardless of traffic.
 */
import { and, count, eq, gte, isNotNull, ne } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { executions, projects, users } from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { getOrSetCached, type CacheEnv } from '../../infrastructure/cache/readThroughCache';

export const PLATFORM_PROOF_CACHE_KEY = 'marketing:platform-proof:v1';
const ONE_HOUR_SECONDS = 3600;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface PlatformProof {
  /** Verified, unsuspended accounts. */
  builders: number;
  /** Verified accounts created in the trailing seven days. */
  buildersThisWeek: number;
  /** Non-archived projects. */
  projects: number;
  /** Agent runs that reached `completed`. */
  agentRunsCompleted: number;
  /** ISO time the counts were taken — the site can say "as of". */
  asOf: string;
}

export async function loadPlatformProof(db: Db, env: CacheEnv): Promise<PlatformProof> {
  return getOrSetCached(env, PLATFORM_PROOF_CACHE_KEY, () => countPlatformProof(db), {
    kvTtlSeconds: ONE_HOUR_SECONDS,
    l1TtlMs: ONE_HOUR_SECONDS * 1000,
  });
}

async function countPlatformProof(db: Db): Promise<PlatformProof> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - WEEK_MS);
  const realBuilder = and(isNotNull(users.emailVerifiedAt), eq(users.isSuspended, false));
  const [[builders], [buildersThisWeek], [projectCount], [runs]] = await Promise.all([
    db.select({ n: count() }).from(users).where(realBuilder),
    db.select({ n: count() }).from(users).where(and(realBuilder, gte(users.createdAt, weekAgo))),
    // Platform-wide COUNTS only — the projection carries no tenant column, so no
    // row can identify a tenant (`platform_aggregate`).
    db.select({ n: count() }).from(projects)
      .where(acrossTenants(projects, 'platform_aggregate', ne(projects.status, 'archived'))),
    db.select({ n: count() }).from(executions)
      .where(acrossTenants(executions, 'platform_aggregate', eq(executions.status, 'completed'))),
  ]);
  return {
    builders: Number(builders?.n ?? 0),
    buildersThisWeek: Number(buildersThisWeek?.n ?? 0),
    projects: Number(projectCount?.n ?? 0),
    agentRunsCompleted: Number(runs?.n ?? 0),
    asOf: now.toISOString(),
  };
}
