/**
 * Cached reads for the AI Insights family — AI Impact, AI Effectiveness
 * (engineering), Recommendations, and SPACE.
 *
 * WHY THIS FILE EXISTS. Every one of these reads was assembled inside its route
 * handler: the route knew the cache key shape, the TTL and the version token, and
 * `aiImpactRoutes` imported two key helpers FROM `recommendationsRoutes` — a
 * presentation module importing another presentation module for a data concern,
 * with `infrastructure/cache` imported into both. That is the layering violation
 * `check-layering.mjs` counts, and it is also a correctness hazard: the bundled
 * `/ai-overview` read only honours dismissals because it re-derives the exact key
 * string the `/recommendations` read uses, so the two definitions must be edited
 * together or the bundle silently serves dismissed rows.
 *
 * One module owns the key, the TTL and the invalidation for each read, beside the
 * computation it caches. Routes call a function and render the result.
 */
import { getCacheVersion, getOrSetCached, bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { computeAiImpact } from './aiImpactInsights';
import { computeEngineeringInsights } from './engineeringInsights';
import { computeRecommendations, dismissRecommendation } from './recommendationsEngine';
import { computeSpaceMetrics } from './spaceMetrics';
import { recsVersionKey, recommendationsCacheKey } from './versionKeys';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/** The inputs are hot-write tables, so a short window keeps figures fresh without
 *  version-bumping the metering path on every token. */
const SHORT_TTL = { kvTtlSeconds: 60, l1TtlMs: 15_000 };

const aiImpactKey = (tenantId: number, days: number) => `insights:aiimpact:t:${tenantId}:d:${days}`;
const engineeringKey = (tenantId: number, days: number) => `insights:eng:t:${tenantId}:d:${days}`;

/** AI Impact lens — adoption trends + multi-tool evaluation + productivity score. */
export function getAiImpact(db: Db, env: Env, tenantId: number, days: number) {
  return getOrSetCached(env, aiImpactKey(tenantId, days), () => computeAiImpact(db, tenantId, days), SHORT_TTL);
}

/** Prescriptive recommendations + anomalies. The dismissal version token is folded
 *  into the key, so an ack refreshes the list on the next read. */
export async function getRecommendations(db: Db, env: Env, tenantId: number, days: number) {
  const ver = await getCacheVersion(env, recsVersionKey(tenantId));
  return getOrSetCached(env, recommendationsCacheKey(tenantId, days, ver), () => computeRecommendations(db, tenantId, days), SHORT_TTL);
}

/** Persist a dismissal and bump the token the cached list is keyed on. The two are
 *  one operation — a dismissal that does not invalidate is a dismissal that did
 *  not happen, as far as the reader is concerned. */
export async function dismissRecommendationCached(
  db: Db,
  env: Env,
  tenantId: number,
  recKey: string,
  userId: string | null,
): Promise<void> {
  await dismissRecommendation(db, tenantId, recKey, userId);
  await bumpCacheVersion(env, recsVersionKey(tenantId));
}

/** SPACE five-dimension productivity scores. */
export function getSpaceMetrics(db: Db, env: Env, tenantId: number, days: number, projectId: number | undefined) {
  return getOrSetCached(
    env,
    `insights:space:t:${tenantId}:d:${days}:p:${projectId ?? 0}`,
    () => computeSpaceMetrics(db, tenantId, days, projectId),
    SHORT_TTL,
  );
}

/**
 * The AI Insights landing bundle — three summary cards in ONE cached read, so the
 * page makes a single round-trip instead of three.
 *
 * Each leg reuses the drill-down lens's OWN cached entry (same key, same TTL) so
 * the bundle and the drill-down share one computation rather than defining the
 * summary twice; that reuse is now structural, because both call the exported
 * function above instead of re-typing its key. A failing leg degrades to null so
 * one erroring lens never blanks the page.
 */
export async function getAiOverview(db: Db, env: Env, tenantId: number, days: number) {
  return getOrSetCached(
    env,
    `insights:aioverview:t:${tenantId}:d:${days}`,
    async () => {
      const [aiImpact, engineering, recommendations] = await Promise.all([
        getAiImpact(db, env, tenantId, days).catch(() => null),
        getOrSetCached(env, engineeringKey(tenantId, days), () => computeEngineeringInsights(db, tenantId, days), SHORT_TTL).catch(() => null),
        getRecommendations(db, env, tenantId, days).catch(() => null),
      ]);
      return { windowDays: days, aiImpact, engineering, recommendations };
    },
    SHORT_TTL,
  );
}
