/**
 * The web surface's VISITOR-facing delivery: the cached public reads and the
 * engagement counters (PRD 19 §9).
 *
 * The uncached public reads themselves ({@link publicLandingPage},
 * {@link publicWebsitePage}) stay in webSurface.ts beside the writers whose status
 * rules they enforce; this module only layers the shared read-through cache over
 * them, under the owner's version token every page writer bumps, and records the
 * anonymous view / conversion / impression counts the campaign reports read.
 */
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { applyHitDeltas, recordHit, scopedHitKey } from '../counters/hitCounters';
import { getCacheVersion, getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { publicLandingPage, publicWebsitePage, websitePagesVersionKey } from './webSurface';
import { requirePath } from './webSurfaceValidation';

/**
 * The public read, served through the shared cache under the owner's version
 * token: a published page is read far more often than it is edited, and the
 * writers in webSurface.ts are the only things that change the answer.
 */
export async function publicWebsitePageCached(db: Db, env: Env, tenantId: number | null, path: string) {
  const version = await getCacheVersion(env, websitePagesVersionKey(tenantId));
  // A sentinel, not null, so an unpublished/unknown path is cached as a miss too (probes
  // would otherwise hit Postgres every time); publish/unpublish bumps the version token.
  const hit = await getOrSetCached(
    env,
    `web:page:v:${version}:${tenantId ?? 'platform'}:${requirePath(path)}`,
    async () => (await publicWebsitePage(db, tenantId, path)) ?? ({ missing: true } as const),
    { kvTtlSeconds: 3600, l1TtlMs: 60_000 },
  );
  return 'missing' in hit ? null : hit;
}

/**
 * The public landing read, through the shared cache under the owner's version token
 * (the same token and layers as {@link publicWebsitePageCached}). Anonymous traffic to
 * a campaign page no longer reaches Postgres per visit. Every landing writer bumps it
 * (`bumpLandingVersion`). `ends_at` expiry has no
 * write to hang a bump on, so it rests on the SHORT TTL (KV 120s, L1 30s).
 */
export async function publicLandingPageCached(db: Db, env: Env, tenantId: number, slug: string) {
  const version = await getCacheVersion(env, websitePagesVersionKey(tenantId));
  // A sentinel, not null, so an unknown/unpublished slug is cached as a miss too (null
  // would re-query Postgres on every probe). Mapped back to null for callers.
  const hit = await getOrSetCached(
    env,
    `web:landing:v:${version}:${tenantId}:${slug.toLowerCase()}`,
    async () => (await publicLandingPage(db, tenantId, slug)) ?? ({ missing: true } as const),
    { kvTtlSeconds: 120, l1TtlMs: 30_000 },
  );
  return 'missing' in hit ? null : hit;
}

/** A landing page view. Counter-only and deliberately not an `activity_log` row:
 *  anonymous page views are high-volume and belong in the counter the campaign
 *  report reads, not in the audit trail a person is expected to scroll. Buffered in
 *  KV and applied by the `hit-counters` sweep — an anonymous view no longer writes. */
export async function recordLandingPageView(env: Env, db: Db, tenantId: number, id: number) {
  await recordHit(env, db, 'landing.view', scopedHitKey(tenantId, id));
}

/** A conversion against the page's `goal_metric`. Separate from the view counter
 *  because the ratio between them IS the campaign result. */
export async function recordLandingPageConversion(env: Env, db: Db, tenantId: number, id: number) {
  // Direct write, NOT the KV buffer: a conversion is a campaign result and must not be lost with an evicted isolate.
  await applyHitDeltas(db, 'landing.convert', [{ kind: 'landing.convert', key: scopedHitKey(tenantId, id), n: 1, t: Date.now() }]);
}

/** A programmatic SEO page impression (`marketing_seo_pages`), by path. Buffered in KV and
 *  applied by the `hit-counters` sweep. The sweep update is filtered to
 *  `status = 'published'` (see HIT_COUNTERS), so a retired page is not counted. No renderer
 *  beacons yet; the endpoint is ready for one. */
export async function recordSeoImpression(env: Env, db: Db, tenantId: number | null, path: string) {
  await recordHit(env, db, 'seo.impression', scopedHitKey(tenantId, requirePath(path)));
}
