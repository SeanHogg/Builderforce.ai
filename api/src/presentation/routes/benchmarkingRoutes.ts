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
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { tenantBenchmarkProfiles } from '../../infrastructure/database/schema';
import {
  computeBenchmarking,
  getBenchmarkProfile,
  DEFAULT_INDUSTRY,
  DEFAULT_SIZE_BAND,
} from '../../application/insights/benchmarkingInsights';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const SHORT_TTL = { kvTtlSeconds: 60, l1TtlMs: 15_000 };

/** Clamp a `?days=` window to a sane range (default 30). */
function parseDays(raw: string | undefined, def = 30): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 365 ? Math.floor(n) : def;
}

function profileCacheKey(tenantId: number): string {
  return `insights:bench:profile:t:${tenantId}`;
}

export function createBenchmarkingRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // Percentile ranking vs the chosen cohort (manager). Cached per (tenant, days);
  // the profile cache key is invalidated on PATCH so a profile change refreshes.
  router.get('/benchmarking', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const days = parseDays(c.req.query('days'));
    const env = c.env as Env;
    const key = `insights:bench:t:${tenantId}:d:${days}`;
    return c.json(await getOrSetCached(env, key, () => computeBenchmarking(db, tenantId, days), SHORT_TTL));
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

    const rows = await db
      .insert(tenantBenchmarkProfiles)
      .values({ tenantId, industry, sizeBand, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: tenantBenchmarkProfiles.tenantId,
        set: { industry, sizeBand, updatedAt: new Date() },
      })
      .returning({ industry: tenantBenchmarkProfiles.industry, sizeBand: tenantBenchmarkProfiles.sizeBand });

    // Refresh the profile cache and stale per-day benchmark reads.
    await invalidateCached(env, profileCacheKey(tenantId));
    for (const d of [7, 30, 90]) {
      await invalidateCached(env, `insights:bench:t:${tenantId}:d:${d}`);
    }

    return c.json(rows[0] ?? { industry: DEFAULT_INDUSTRY, sizeBand: DEFAULT_SIZE_BAND });
  });

  return router;
}
