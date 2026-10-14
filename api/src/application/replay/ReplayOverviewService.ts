/**
 * THE Overview dashboard read (PRD 33 §2.1 "Dashboard", D15/D18).
 *
 * Unfiltered, every block reads the EXACT rollups (`replay_route_daily`,
 * `replay_breakdown_daily`, `replay_issue_daily`) — counts over every session. A
 * filter cannot be answered by the rollup grain, so it switches the whole answer to
 * the KEPT recordings weighted by `sample_weight` (Horvitz–Thompson: each kept row
 * stands for 1 / P(kept) sessions) and sets `estimated` — the UI prints ≈. Numbers a
 * kept row does not carry (new visitors, scroll depth) are null there, never guessed.
 *
 * One grouped statement per block, run together; no per-visit loops. Cached under
 * the site version per (days, filter).
 *
 * The exact frustration block counts ISSUE-sessions per kind (`replay_issue_daily`):
 * a session that hits two different issues of one kind counts twice, so the share is
 * capped at 100% and reads as an upper bound for that kind.
 */

import { and, desc, eq, gte, sql, type SQL } from 'drizzle-orm';
import type { ReplayFilter, ReplayOverviewDto, ReplayOverviewTopKey } from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import {
  replayBreakdownDaily,
  replayIssueDaily,
  replayIssues,
  replayRecordings,
  replayRouteDaily,
} from '../../infrastructure/database/schema';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import type { ReplayScope } from '../../domain/replay/replayScope';
import { replayReadKeys } from './replayCacheKeys';
import { replayTelemetryDb } from './replayDatabase';
import { clampDays, filterCacheKey, windowDays } from './replayReadModel';
import { compileScopeFilter } from './replaySmartEventRules';

export const OVERVIEW_TOP_N = 10;
const BREAKDOWN_ROWS_MAX = 2_000;
const TTL = { kvTtlSeconds: 300, l1TtlMs: 30_000 };

const num = (value: unknown): number => Number(value ?? 0) || 0;
const share = (part: number, whole: number): number => (whole > 0 ? Math.min(1, part / whole) : 0);
const pct = (part: number, whole: number): number => (whole > 0 ? Math.min(100, (part * 100) / whole) : 0);

/** Breakdown dim → top-list key. */
const DIM_TOP: Readonly<Record<string, ReplayOverviewTopKey>> = {
  country: 'countries',
  device: 'devices',
  browser: 'browsers',
  os: 'os',
  referrer: 'referrers',
  entry: 'entryPages',
  exit: 'exitPages',
};

/** Issue kind → frustration key. */
const KIND_FRUSTRATION = {
  rage: 'rage',
  dead: 'dead',
  quickback: 'quickback',
  excessive_scroll: 'excessiveScroll',
  error: 'error',
} as const;

function emptyTop(): ReplayOverviewDto['top'] {
  return { pages: [], entryPages: [], exitPages: [], referrers: [], countries: [], devices: [], browsers: [], os: [] };
}

function topOf(rows: Array<{ value: unknown; sessions: unknown }>): Array<{ value: string; sessions: number }> {
  return rows
    .filter((row) => typeof row.value === 'string' && row.value !== '')
    .map((row) => ({ value: row.value as string, sessions: Math.round(num(row.sessions)) }))
    .sort((a, b) => b.sessions - a.sessions || a.value.localeCompare(b.value))
    .slice(0, OVERVIEW_TOP_N);
}

export class ReplayOverviewService {
  private readonly store: Db;

  constructor(private readonly env: Env, private readonly db: Db, private readonly clock: () => Date = () => new Date()) {
    this.store = replayTelemetryDb(env, db);
  }

  async overview(scope: ReplayScope, input: { days?: number; filter?: ReplayFilter | null } = {}): Promise<ReplayOverviewDto> {
    const days = clampDays(input.days);
    const filtered = !!input.filter && input.filter.all.length > 0;
    const keys = await replayReadKeys(this.env, scope);
    return getOrSetCached(this.env, keys.overview(days, filterCacheKey(input.filter)), () =>
      (filtered ? this.estimated(scope, days, input.filter!) : this.exact(scope, days)), TTL);
  }

  /** Every block from the exact rollups. */
  private async exact(scope: ReplayScope, days: number): Promise<ReplayOverviewDto> {
    const dayList = windowDays(this.clock(), days);
    const since = dayList[0]!;
    const routeWhere = and(
      eq(replayRouteDaily.tenantId, scope.tenantId),
      eq(replayRouteDaily.siteId, scope.siteId),
      gte(replayRouteDaily.day, since),
    );
    const pageviews = sql<string>`sum(${replayRouteDaily.pageviews})`;
    const [daily, pages, breakdown, kinds] = await Promise.all([
      this.store
        .select({
          day: replayRouteDaily.day,
          sessions: sql<string>`sum(${replayRouteDaily.sessions})`,
          newVisitors: sql<string>`sum(${replayRouteDaily.newVisitors})`,
          pageviews,
          frustrated: sql<string>`sum(${replayRouteDaily.frustrated})`,
          activeMs: sql<string>`sum(${replayRouteDaily.activeMsSum})`,
          scrollDepth: sql<string>`sum(${replayRouteDaily.scrollDepthSum})`,
        })
        .from(replayRouteDaily)
        .where(routeWhere)
        .groupBy(replayRouteDaily.day),
      this.store
        .select({ value: replayRouteDaily.route, sessions: pageviews })
        .from(replayRouteDaily)
        .where(and(eq(replayRouteDaily.tenantId, scope.tenantId), eq(replayRouteDaily.siteId, scope.siteId), gte(replayRouteDaily.day, since)))
        .groupBy(replayRouteDaily.route)
        .orderBy(desc(pageviews))
        .limit(OVERVIEW_TOP_N),
      this.store
        .select({ dim: replayBreakdownDaily.dim, value: replayBreakdownDaily.value, sessions: sql<string>`sum(${replayBreakdownDaily.sessions})` })
        .from(replayBreakdownDaily)
        .where(and(
          eq(replayBreakdownDaily.tenantId, scope.tenantId),
          eq(replayBreakdownDaily.siteId, scope.siteId),
          gte(replayBreakdownDaily.day, since),
        ))
        .groupBy(replayBreakdownDaily.dim, replayBreakdownDaily.value)
        .orderBy(desc(sql`sum(${replayBreakdownDaily.sessions})`))
        .limit(BREAKDOWN_ROWS_MAX),
      this.store
        .select({ kind: replayIssues.kind, sessions: sql<string>`sum(${replayIssueDaily.sessions})` })
        .from(replayIssueDaily)
        .innerJoin(replayIssues, eq(replayIssues.id, replayIssueDaily.issueId))
        .where(and(
          eq(replayIssues.tenantId, scope.tenantId),
          eq(replayIssues.siteId, scope.siteId),
          gte(replayIssueDaily.day, since),
        ))
        .groupBy(replayIssues.kind),
    ]);

    const byDay = new Map(daily.map((row) => [String(row.day), row]));
    const totals = { sessions: 0, newVisitors: 0, pageviews: 0, activeMs: 0, scrollDepth: 0 };
    const trend = dayList.map((day) => {
      const row = byDay.get(day);
      const sessions = num(row?.sessions);
      totals.sessions += sessions;
      totals.newVisitors += num(row?.newVisitors);
      totals.pageviews += num(row?.pageviews);
      totals.activeMs += num(row?.activeMs);
      totals.scrollDepth += num(row?.scrollDepth);
      return { day, sessions, frustratedPct: pct(num(row?.frustrated), sessions) };
    });

    const top = emptyTop();
    // A page's "sessions" in the top list is its pageviews: the rollup counts a session once, at its entry.
    top.pages = topOf(pages);
    const grouped = new Map<ReplayOverviewTopKey, Array<{ value: unknown; sessions: unknown }>>();
    for (const row of breakdown) {
      const key = DIM_TOP[row.dim];
      if (!key) continue;
      const list = grouped.get(key) ?? [];
      list.push(row);
      grouped.set(key, list);
    }
    for (const [key, rows] of grouped) top[key] = topOf(rows);

    const frustration = { rage: 0, dead: 0, quickback: 0, excessiveScroll: 0, error: 0 };
    for (const row of kinds) {
      const key = KIND_FRUSTRATION[row.kind as keyof typeof KIND_FRUSTRATION];
      if (key) frustration[key] = share(num(row.sessions), totals.sessions);
    }

    return {
      days,
      sessions: totals.sessions,
      newVisitors: totals.newVisitors,
      pagesPerSession: totals.sessions ? totals.pageviews / totals.sessions : 0,
      avgActiveMs: totals.sessions ? Math.round(totals.activeMs / totals.sessions) : 0,
      // A page's scroll mark carries its depth decile (0..9); the mean decile × 10 is a percentage.
      avgScrollDepthPct: totals.pageviews ? Math.min(100, Math.round((totals.scrollDepth / totals.pageviews) * 10)) : null,
      frustration,
      trend,
      top,
      estimated: false,
    };
  }

  /** Every block from the kept recordings matching the filter, weighted by sample_weight (≈). */
  private async estimated(scope: ReplayScope, days: number, filter: ReplayFilter): Promise<ReplayOverviewDto> {
    const now = this.clock();
    const dayList = windowDays(now, days);
    const since = new Date(`${dayList[0]!}T00:00:00.000Z`);
    const { where: filterWhere } = await compileScopeFilter(this.env, this.db, scope, filter);
    const w = replayRecordings.sampleWeight;
    const weighted = (cond: SQL) => sql<string>`coalesce(sum(case when ${cond} then ${w} else 0 end), 0)`;
    const day = sql<string>`to_char(${replayRecordings.startedAt}, 'YYYY-MM-DD')`;
    // Always defined: the scope halves are unconditional.
    const where = and(
      eq(replayRecordings.tenantId, scope.tenantId),
      eq(replayRecordings.siteId, scope.siteId),
      gte(replayRecordings.startedAt, since),
      filterWhere,
    ) as SQL;

    const [daily, tops] = await Promise.all([
      this.store
        .select({
          day,
          sessions: sql<string>`coalesce(sum(${w}), 0)`,
          pages: sql<string>`coalesce(sum(${w} * ${replayRecordings.pageCount}), 0)`,
          activeMs: sql<string>`coalesce(sum(${w} * ${replayRecordings.activeMs}), 0)`,
          frustrated: weighted(sql`cardinality(${replayRecordings.frustrations}) > 0`),
          rage: weighted(sql`${replayRecordings.rageCount} > 0`),
          dead: weighted(sql`${replayRecordings.deadCount} > 0`),
          quickback: weighted(sql`${replayRecordings.quickbackCount} > 0`),
          excessiveScroll: weighted(sql`${replayRecordings.excessiveScrollCount} > 0`),
          error: weighted(sql`${replayRecordings.errorCount} > 0`),
        })
        .from(replayRecordings)
        .where(where)
        .groupBy(day),
      this.store.execute(sql`
        select bf_t.k as key, bf_t.v as value, sum(bf_t.w) as sessions from (
          select 'pages' as k, bf_r.v as v, ${w} as w from ${replayRecordings}, unnest(${replayRecordings.routes}) as bf_r(v) where ${where}
          union all select 'entryPages', ${replayRecordings.entryPath}, ${w} from ${replayRecordings} where ${where}
          union all select 'exitPages', ${replayRecordings.exitPath}, ${w} from ${replayRecordings} where ${where}
          union all select 'referrers', ${replayRecordings.referrerHost}, ${w} from ${replayRecordings} where ${where}
          union all select 'countries', ${replayRecordings.country}, ${w} from ${replayRecordings} where ${where}
          union all select 'devices', ${replayRecordings.deviceClass}, ${w} from ${replayRecordings} where ${where}
          union all select 'browsers', ${replayRecordings.browser}, ${w} from ${replayRecordings} where ${where}
          union all select 'os', ${replayRecordings.os}, ${w} from ${replayRecordings} where ${where}
        ) as bf_t
        where bf_t.v is not null and bf_t.v <> ''
        group by bf_t.k, bf_t.v
        order by sessions desc
        limit ${BREAKDOWN_ROWS_MAX}
      `),
    ]);

    const byDay = new Map(daily.map((row) => [String(row.day), row]));
    const totals = { sessions: 0, pages: 0, activeMs: 0, rage: 0, dead: 0, quickback: 0, excessiveScroll: 0, error: 0 };
    const trend = dayList.map((d) => {
      const row = byDay.get(d);
      const sessions = num(row?.sessions);
      totals.sessions += sessions;
      totals.pages += num(row?.pages);
      totals.activeMs += num(row?.activeMs);
      totals.rage += num(row?.rage);
      totals.dead += num(row?.dead);
      totals.quickback += num(row?.quickback);
      totals.excessiveScroll += num(row?.excessiveScroll);
      totals.error += num(row?.error);
      return { day: d, sessions: Math.round(sessions), frustratedPct: pct(num(row?.frustrated), sessions) };
    });

    const top = emptyTop();
    const grouped = new Map<ReplayOverviewTopKey, Array<{ value: unknown; sessions: unknown }>>();
    for (const row of ((tops as unknown as { rows?: Array<{ key: string; value: unknown; sessions: unknown }> }).rows ?? [])) {
      const key = row.key as ReplayOverviewTopKey;
      if (!(key in top)) continue;
      const list = grouped.get(key) ?? [];
      list.push(row);
      grouped.set(key, list);
    }
    for (const [key, rows] of grouped) top[key] = topOf(rows);

    return {
      days,
      sessions: Math.round(totals.sessions),
      newVisitors: null,
      pagesPerSession: totals.sessions ? totals.pages / totals.sessions : 0,
      avgActiveMs: totals.sessions ? Math.round(totals.activeMs / totals.sessions) : 0,
      avgScrollDepthPct: null,
      frustration: {
        rage: share(totals.rage, totals.sessions),
        dead: share(totals.dead, totals.sessions),
        quickback: share(totals.quickback, totals.sessions),
        excessiveScroll: share(totals.excessiveScroll, totals.sessions),
        error: share(totals.error, totals.sessions),
      },
      trend,
      top,
      estimated: true,
    };
  }
}
