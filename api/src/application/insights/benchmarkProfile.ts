/**
 * The tenant's benchmark profile — the ONE writer (PRD 25 §6.4).
 *
 * Two doors write `tenant_benchmark_profiles`: the manager picking a cohort on the
 * Benchmarking lens (`PATCH /api/insights/benchmarking/profile`) and the founder
 * declaring a sector on the startup listing. Before this module the first door
 * did its own upsert inside the route, which is a route importing a table, and
 * the second door did not exist, so the listing's sector and the benchmark
 * cohort were two separate picks that disagreed. One writer, one cache
 * invalidation, and the sector IS the industry since migration 1176 renamed the
 * seeded cohorts onto `STARTUP_SECTORS`.
 *
 * The cohort-existence check stays a separate, explicit step ({@link assertKnownCohort})
 * because the two doors want different things from it: the picker must refuse a
 * cohort with no distribution (a table of dashes under a confident heading), but
 * the declared sector is the truth about the company whether or not a cohort has
 * been seeded for it yet — the lens then says so ({@link BenchmarkingResult.cohortSeeded}).
 */

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { tenantBenchmarkProfiles } from '../../infrastructure/database/schema';
import { bumpCacheVersion, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { getBenchmarkProfile, listBenchmarkCohorts, type BenchmarkingResult } from './benchmarkingInsights';

export class BenchmarkProfileError extends Error {
  constructor(message: string, readonly status: 400 = 400, readonly detail: Record<string, unknown> = {}) {
    super(message);
    this.name = 'BenchmarkProfileError';
  }
}

export function benchmarkProfileCacheKey(tenantId: number): string {
  return `insights:bench:profile:t:${tenantId}`;
}

/**
 * Version token folded into every benchmark read key, bumped when the profile
 * changes. A window × project keyspace is unbounded — it cannot be enumerated
 * for deletion — so the fix is the token, not a delete loop.
 */
export function benchmarkVersionKey(tenantId: number): string {
  return `insights:bench:ver:t:${tenantId}`;
}

export interface BenchmarkProfilePatch {
  industry?: string | null;
  sizeBand?: string | null;
}

/** Trim and bound the two fields; a blank field keeps its current value. */
export async function resolveBenchmarkProfilePatch(
  db: Db,
  tenantId: number,
  patch: BenchmarkProfilePatch,
): Promise<{ industry: string; sizeBand: string }> {
  const current = await getBenchmarkProfile(db, tenantId);
  const industry = typeof patch.industry === 'string' && patch.industry.trim()
    ? patch.industry.trim().slice(0, 48) : current.industry;
  const sizeBand = typeof patch.sizeBand === 'string' && patch.sizeBand.trim()
    ? patch.sizeBand.trim().slice(0, 16) : current.sizeBand;
  return { industry, sizeBand };
}

/** Refuse a cohort with no seeded distribution. */
export async function assertKnownCohort(
  db: Db,
  profile: { industry: string; sizeBand: string },
): Promise<void> {
  const cohorts = await listBenchmarkCohorts(db);
  if (!cohorts.industries.includes(profile.industry)) {
    throw new BenchmarkProfileError('Unknown industry cohort', 400, { industries: cohorts.industries });
  }
  if (!cohorts.sizeBands.includes(profile.sizeBand)) {
    throw new BenchmarkProfileError('Unknown size band', 400, { sizeBands: cohorts.sizeBands });
  }
}

/** Upsert the profile and re-arm every cached ranking for the tenant. */
export async function setBenchmarkProfile(
  db: Db,
  env: Env,
  tenantId: number,
  profile: { industry: string; sizeBand: string },
): Promise<{ industry: string; sizeBand: string }> {
  const rows = await db
    .insert(tenantBenchmarkProfiles)
    .values({ tenantId, ...profile, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: tenantBenchmarkProfiles.tenantId,
      set: { ...profile, updatedAt: new Date() },
    })
    .returning({ industry: tenantBenchmarkProfiles.industry, sizeBand: tenantBenchmarkProfiles.sizeBand });
  await invalidateCached(env, benchmarkProfileCacheKey(tenantId));
  await bumpCacheVersion(env, benchmarkVersionKey(tenantId));
  return rows[0] ?? profile;
}

/**
 * The founder's door: the declared sector becomes the benchmark industry, size
 * band untouched. No cohort assertion — see the module header.
 */
export async function alignBenchmarkIndustry(
  db: Db,
  env: Env,
  tenantId: number,
  sector: string,
): Promise<void> {
  const current = await getBenchmarkProfile(db, tenantId);
  if (current.industry === sector) return;
  await setBenchmarkProfile(db, env, tenantId, { industry: sector, sizeBand: current.sizeBand });
}
