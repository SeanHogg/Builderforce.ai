/**
 * "Who showed up" for a published app — the People read model behind the canvas
 * Operate surface.
 *
 * Every number here is already recorded by the platform; this module only adds
 * them up:
 *   users      `site_users` rows for the site (every signed-up end user)
 *   newUsers   the same, created inside the window
 *   visitors   SUM(`site_traffic_daily.visitors`) over the window — APPROXIMATE
 *              (per-isolate visitor sets, see `siteTraffic.ts`)
 *   pageViews  SUM(`site_traffic_daily.page_views`) over the window
 *   leads      SUM(`site_collections.record_count`) — every form / waitlist
 *              submission, the denormalised tally `submitSiteRecord` keeps
 *
 * Three aggregate statements, one per table, each bounded by the site id — no
 * per-row work, no N+1, whatever the audience size.
 *
 * CACHING. The aggregate is read-through cached per tenant + project + window
 * (`siteAudienceCacheKey`). The windows are the three the UI offers, so the
 * keyspace is small and enumerable and invalidation simply drops all three:
 *   - a NEW sign-up (`requestSiteSignIn`, the `xmax = 0` branch),
 *   - a form submission (`submitSiteRecord`),
 *   - an owner deleting a user, a record or a collection (`siteManageRoutes`).
 * Traffic is deliberately NOT invalidated per flush: the hosting middleware
 * flushes every few seconds on a busy site, and dropping these keys each time
 * would turn the cache into a KV-delete stream. The 120s TTL — the same one the
 * traffic read model uses — bounds how stale the traffic half can be.
 *
 * The site lookup runs OUTSIDE the cache so a project that publishes flips from
 * "not published" to its live numbers on the next read, not after a TTL.
 */

import { and, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { siteCollections, siteTrafficDaily, siteUsers } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached, type CacheEnv } from '../../infrastructure/cache/readThroughCache';
import { appsDatabaseOf } from './appsDatabase';
import { siteForProject, utcDay } from './siteTraffic';

/** The windows the UI offers. Anything else is clamped to the default so the
 *  cache keyspace stays bounded (and invalidation can enumerate it). */
export const AUDIENCE_WINDOWS = [7, 30, 90] as const;
export const DEFAULT_AUDIENCE_WINDOW = 30;

export interface SiteAudienceSummary {
  /** False when the project has no published site — every count is then zero. */
  published: boolean;
  /** Every signed-up end user of the app. */
  users: number;
  /** End users who signed up inside the window. */
  newUsers: number;
  /** Distinct-per-day visitors summed over the window. Approximate. */
  visitors: number;
  pageViews: number;
  /** Form / waitlist submissions across every collection. */
  leads: number;
  days: number;
  /** Always true — the traffic half is a usage signal, never exact. */
  approximateTraffic: true;
}

/** Clamp a requested window to one the UI offers. */
export function audienceWindow(requested: number | undefined): number {
  return (AUDIENCE_WINDOWS as readonly number[]).includes(Number(requested))
    ? Number(requested)
    : DEFAULT_AUDIENCE_WINDOW;
}

/** The ONE key format — every reader and every invalidating writer uses this. */
export function siteAudienceCacheKey(tenantId: number, projectId: number, days: number): string {
  return `site-audience:t:${tenantId}:p:${projectId}:d:${days}`;
}

function emptySummary(days: number, published: boolean): SiteAudienceSummary {
  return { published, users: 0, newUsers: 0, visitors: 0, pageViews: 0, leads: 0, days, approximateTraffic: true };
}

/** Postgres aggregates arrive as strings (bigint SUM) or null (empty SUM). */
const toCount = (value: unknown): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * The People summary for a project's published app over the last `days`.
 * Tenant-scoped end to end: a foreign project id resolves to no site and reads
 * as unpublished.
 */
export async function getSiteAudienceSummary(
  env: CacheEnv,
  db: Db,
  tenantId: number,
  projectId: number,
  opts: { days?: number } = {},
): Promise<SiteAudienceSummary> {
  const days = audienceWindow(opts.days ?? DEFAULT_AUDIENCE_WINDOW);
  const site = await siteForProject(db, tenantId, projectId);
  if (!site) return emptySummary(days, false);

  return getOrSetCached<SiteAudienceSummary>(
    env,
    siteAudienceCacheKey(tenantId, projectId, days),
    async () => {
      const apps = appsDatabaseOf(db);
      // Same window rule as the traffic read model: UTC days back from today.
      const sinceDay = utcDay(Date.now() - days * 86_400_000);

      const [userRows, trafficRows, leadRows] = await Promise.all([
        apps
          .select({
            users: sql<number>`count(*)::int`,
            newUsers: sql<number>`(count(*) filter (where ${siteUsers.createdAt} >= now() - make_interval(days => ${days})))::int`,
          })
          .from(siteUsers)
          .where(and(eq(siteUsers.siteId, site.siteId), eq(siteUsers.tenantId, tenantId))),
        apps
          .select({
            visitors: sql<number>`coalesce(sum(${siteTrafficDaily.visitors}), 0)::int`,
            pageViews: sql<number>`coalesce(sum(${siteTrafficDaily.pageViews}), 0)::int`,
          })
          .from(siteTrafficDaily)
          .where(and(
            eq(siteTrafficDaily.siteId, site.siteId),
            eq(siteTrafficDaily.tenantId, tenantId),
            gte(siteTrafficDaily.day, sinceDay),
          )),
        apps
          .select({ leads: sql<number>`coalesce(sum(${siteCollections.recordCount}), 0)::int` })
          .from(siteCollections)
          .where(and(eq(siteCollections.siteId, site.siteId), eq(siteCollections.tenantId, tenantId))),
      ]);

      const u = userRows[0];
      const t = trafficRows[0];
      const l = leadRows[0];
      return {
        published: true,
        users: toCount(u?.users),
        newUsers: toCount(u?.newUsers),
        visitors: toCount(t?.visitors),
        pageViews: toCount(t?.pageViews),
        leads: toCount(l?.leads),
        days,
        approximateTraffic: true as const,
      };
    },
    { kvTtlSeconds: 120 },
  );
}

/**
 * Drop every cached window for a project. Called on each write that changes a
 * count (see the module docs). Best-effort by contract: a failed invalidation
 * leaves at most a TTL of staleness, so it never fails the write that caused it.
 */
export async function invalidateSiteAudience(
  env: CacheEnv,
  tenantId: number,
  projectId: number,
): Promise<void> {
  await Promise.all(
    AUDIENCE_WINDOWS.map((w) => invalidateCached(env, siteAudienceCacheKey(tenantId, projectId, w))),
  ).catch(() => undefined);
}
