/**
 * Industry Benchmarking lens — /api/insights/benchmarking*
 *
 * Mounted under /api/insights alongside the other role-insight lenses. Manager-
 * gated (an exec comparison view). The lens read is cached on a SHORT TTL keyed by
 * (tenant, days) because the underlying live inputs (DORA deploys / run outcomes)
 * are hot-write and the seeded cohort table is static.
 *
 *   GET   /benchmarking            percentile ranking vs the cohort      [manager]
 *   GET   /benchmarking/profile    read the tenant's (industry,size_band) [manager]
 *   PATCH /benchmarking/profile    upsert the tenant's profile            [manager]
 */

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { scope } from './segmentTrackerRoutes';
import { getOrSetCached, invalidateCached, getCacheVersion, bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { tenantBenchmarkProfiles } from '../../infrastructure/database/schema';
import {
  computeBenchmarking,
  getBenchmarkProfile,
  listBenchmarkCohorts,
  DEFAULT_INDUSTRY,
  DEFAULT_SIZE_BAND,
} from '../../application/insights/benchmarkingInsights';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { positiveIntParam } from './queryParams';

const SHORT_TTL = { kvTtlSeconds: 60, l1TtlMs: 15_000 };

/** Clamp a `?days=` window to a sane range (default 30). */
function parseDays(raw: string | undefined, def = 30): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 365 ? Math.floor(n) : def;
}



function profileCacheKey(tenantId: number): string {
  return `insights:bench:profile:t:${tenantId}`;
}

/**
 * Version token folded into every benchmark read key, bumped when the profile
 * changes.
 *
 * It replaces a delete loop over `[7, 30, 90]` days that had silently stopped
 * working: once the project scope joined the read key (`…:d:30:p:0`), none of the
 * three keys the loop deleted existed any more, so changing cohort left the old
 * cohort's rankings cached for the full TTL. A window × project keyspace is
 * unbounded — it cannot be enumerated for deletion — so the fix is the token, not
 * a longer loop. Same convention as the finance and workforce-metrics reads.
 */
function benchVersionKey(tenantId: number): string {
  return `insights:bench:ver:t:${tenantId}`;
}

/** The cohorts a tenant may select — DERIVED FROM THE SEEDED ROWS. Global, not
 *  per-tenant, and it changes only when a migration seeds a cohort, so it is
 *  cached long and shared across every tenant. */
const COHORTS_TTL = { kvTtlSeconds: 86_400, l1TtlMs: 300_000 };

export function createBenchmarkingRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // Percentile ranking vs the chosen cohort (manager). Cached per (tenant, days);
  // the profile cache key is invalidated on PATCH so a profile change refreshes.
  router.get('/benchmarking', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const days = parseDays(c.req.query('days'));
    const projectId = positiveIntParam(c.req.query('projectId'));
    const env = c.env as Env;
    const ver = await getCacheVersion(env, benchVersionKey(tenantId));
    const key = `insights:bench:t:${tenantId}:v:${ver}:d:${days}:p:${projectId ?? 0}`;
    return c.json(await getOrSetCached(env, key, () => computeBenchmarking(db, tenantId, days, projectId), SHORT_TTL));
  });

  // The selectable cohorts. Served from the seeded rows so the picker can only
  // offer a cohort that has a distribution behind it.
  router.get('/benchmarking/cohorts', requireRole(TenantRole.MANAGER), async (c) => {
    const env = c.env as Env;
    return c.json(await getOrSetCached(env, 'insights:bench:cohorts', () => listBenchmarkCohorts(db), COHORTS_TTL));
  });

  // Read the tenant's benchmark profile (industry + size band), defaulted.
  router.get('/benchmarking/profile', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const env = c.env as Env;
    return c.json(await getOrSetCached(env, profileCacheKey(tenantId), () => getBenchmarkProfile(db, tenantId), SHORT_TTL));
  });

  // Upsert the tenant's benchmark profile. Only industry + size_band are writable;
  // missing fields keep their current (or default) value. Invalidates the profile +
  // all benchmark read caches indirectly via the per-tenant profile key.
  router.patch('/benchmarking/profile', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const env = c.env as Env;
    const body = await c.req.json<{ industry?: unknown; sizeBand?: unknown }>().catch(() => ({}) as { industry?: unknown; sizeBand?: unknown });

    const current = await getBenchmarkProfile(db, tenantId);
    const industry = typeof body.industry === 'string' && body.industry.trim()
      ? body.industry.trim().slice(0, 48) : current.industry;
    const sizeBand = typeof body.sizeBand === 'string' && body.sizeBand.trim()
      ? body.sizeBand.trim().slice(0, 16) : current.sizeBand;

    // Reject a cohort with no seeded distribution. Storing one is not a harmless
    // no-op: every metric then ranks against nothing and the lens renders a table
    // of dashes under a confident cohort heading, which reads as "we have no data"
    // rather than "you picked a cohort that does not exist".
    const cohorts = await listBenchmarkCohorts(db);
    if (!cohorts.industries.includes(industry)) {
      return c.json({ error: 'Unknown industry cohort', industries: cohorts.industries }, 400);
    }
    if (!cohorts.sizeBands.includes(sizeBand)) {
      return c.json({ error: 'Unknown size band', sizeBands: cohorts.sizeBands }, 400);
    }

    const rows = await db
      .insert(tenantBenchmarkProfiles)
      .values({ tenantId, industry, sizeBand, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: tenantBenchmarkProfiles.tenantId,
        set: { industry, sizeBand, updatedAt: new Date() },
      })
      .returning({ industry: tenantBenchmarkProfiles.industry, sizeBand: tenantBenchmarkProfiles.sizeBand });

    // Refresh the profile, and re-arm EVERY cached ranking at once via the token.
    await invalidateCached(env, profileCacheKey(tenantId));
    await bumpCacheVersion(env, benchVersionKey(tenantId));

    return c.json(rows[0] ?? { industry: DEFAULT_INDUSTRY, sizeBand: DEFAULT_SIZE_BAND });
  });

  return router;
}
