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
import { getOrSetCached, getCacheVersion } from '../../infrastructure/cache/readThroughCache';
import {
  computeBenchmarking,
  getBenchmarkProfile,
  listBenchmarkCohorts,
} from '../../application/insights/benchmarkingInsights';
import {
  BenchmarkProfileError,
  assertKnownCohort,
  benchmarkProfileCacheKey,
  benchmarkVersionKey,
  resolveBenchmarkProfilePatch,
  setBenchmarkProfile,
} from '../../application/insights/benchmarkProfile';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { positiveIntParam, daysParam } from './queryParams';
import { parseOptionalBody, z } from './requestBody';

/** `PATCH /benchmarking/profile` — a blank field keeps its current value. */
const BenchmarkProfileBody = z.object({
  industry: z.string().nullish(),
  sizeBand: z.string().nullish(),
});

const SHORT_TTL = { kvTtlSeconds: 60, l1TtlMs: 15_000 };

// The profile cache key and the per-tenant version token live with the ONE
// writer (`application/insights/benchmarkProfile.ts`) — the listing's declared
// sector writes the same row through the same door, so both invalidate alike.

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
    const days = daysParam(c.req.query('days'), 30);
    const projectId = positiveIntParam(c.req.query('projectId'));
    const env = c.env as Env;
    const ver = await getCacheVersion(env, benchmarkVersionKey(tenantId));
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
    return c.json(await getOrSetCached(env, benchmarkProfileCacheKey(tenantId), () => getBenchmarkProfile(db, tenantId), SHORT_TTL));
  });

  // Upsert the tenant's benchmark profile. Only industry + size_band are writable;
  // missing fields keep their current (or default) value. The picker's door
  // refuses a cohort with no seeded distribution: storing one is not a harmless
  // no-op, every metric then ranks against nothing under a confident heading.
  router.patch('/benchmarking/profile', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const env = c.env as Env;
    const body = await parseOptionalBody(c, BenchmarkProfileBody);
    const profile = await resolveBenchmarkProfilePatch(db, tenantId, body);
    try {
      await assertKnownCohort(db, profile);
    } catch (err) {
      if (err instanceof BenchmarkProfileError) return c.json({ error: err.message, ...err.detail }, err.status);
      throw err;
    }
    return c.json(await setBenchmarkProfile(db, env, tenantId, profile));
  });

  return router;
}
