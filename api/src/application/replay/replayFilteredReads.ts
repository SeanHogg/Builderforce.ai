/**
 * The headline KPIs and the issue list under a FILTER (PRD 33 D15/D18).
 *
 * The exact rollups (`replayRollupReads.ts`) count every session but carry no
 * visitor dimensions, so a filter cannot be answered from them. Like the Overview
 * (`ReplayOverviewService.estimated`), a filtered read switches to the KEPT
 * recordings that match the filter — compiled by THE compiler
 * (`compileScopeFilter`) — weighted by `sample_weight` (each kept row stands for
 * 1 / P(kept) sessions), and is marked `estimated` so the UI prints ≈. A number a
 * kept row cannot know (new visitors, LCP) is 0 / null there, never guessed.
 *
 * One grouped statement per block; every statement carries BOTH halves of the
 * scope. Uncached building blocks — `ReplayReadService` owns caching, under a key
 * that includes `filterCacheKey(filter)`.
 */

import { and, eq, gte, inArray, sql, type SQL } from 'drizzle-orm';
import type { ReplayFilter, ReplayIssueDto, ReplayKpisDto, ReplayPage } from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { replayIssues, replayRecordings } from '../../infrastructure/database/schema';
import type { ReplayScope } from '../../domain/replay/replayScope';
import { ISSUES_PAGE, toIssueDto, windowDays } from './replayReadModel';
import { ISSUE_COLUMNS } from './replayRollupReads';
import { compileScopeFilter } from './replaySmartEventRules';

/** Most issue fingerprints a filtered list folds (the busiest first). */
export const FILTERED_ISSUES_MAX = 2_000;

const num = (value: unknown): number => Number(value ?? 0) || 0;

/** True when the filter has at least one clause — the switch from exact to ≈. */
export function hasFilter(filter: ReplayFilter | null | undefined): filter is ReplayFilter {
  return !!filter && filter.all.length > 0;
}

/** The kept recordings of the scope, in the window, matching the filter (and the release). */
async function keptWhere(
  env: Env,
  db: Db,
  scope: ReplayScope,
  input: { days: number; now: Date; filter: ReplayFilter; release?: string | null },
): Promise<{ where: SQL; dayList: string[] }> {
  const dayList = windowDays(input.now, input.days);
  const { where: filterWhere } = await compileScopeFilter(env, db, scope, input.filter);
  // Always defined: the scope halves are unconditional.
  const where = and(
    eq(replayRecordings.tenantId, scope.tenantId),
    eq(replayRecordings.siteId, scope.siteId),
    gte(replayRecordings.startedAt, new Date(`${dayList[0]!}T00:00:00.000Z`)),
    input.release ? eq(replayRecordings.releaseKey, input.release) : undefined,
    filterWhere,
  ) as SQL;
  return { where, dayList };
}

const recordingDay = sql<string>`to_char(${replayRecordings.startedAt}, 'YYYY-MM-DD')`;

/** `ReplayKpisDto` from the kept recordings matching the filter, weighted (≈). */
export async function readKpisEstimated(
  env: Env,
  db: Db,
  store: Db,
  scope: ReplayScope,
  input: { days: number; release?: string | null; now: Date; filter: ReplayFilter },
): Promise<ReplayKpisDto> {
  const { where, dayList } = await keptWhere(env, db, scope, input);
  const w = replayRecordings.sampleWeight;
  const weighted = (cond: SQL) => sql<string>`coalesce(sum(case when ${cond} then ${w} else 0 end), 0)`;
  const daily = await store
    .select({
      day: recordingDay,
      sessions: sql<string>`coalesce(sum(${w}), 0)`,
      pageviews: sql<string>`coalesce(sum(${w} * ${replayRecordings.pageCount}), 0)`,
      conversions: weighted(sql`${replayRecordings.converted}`),
      frustrated: weighted(sql`cardinality(${replayRecordings.frustrations}) > 0`),
      errors: sql<string>`coalesce(sum(${w} * ${replayRecordings.errorCount}), 0)`,
    })
    .from(replayRecordings)
    .where(where)
    .groupBy(recordingDay);

  const byDay = new Map(daily.map((row) => [String(row.day), row]));
  const totals = { sessions: 0, pageviews: 0, conversions: 0, frustrated: 0, errors: 0 };
  const trend = dayList.map((day) => {
    const row = byDay.get(day);
    const sessions = num(row?.sessions);
    const frustrated = num(row?.frustrated);
    const conversions = num(row?.conversions);
    totals.sessions += sessions;
    totals.frustrated += frustrated;
    totals.conversions += conversions;
    totals.pageviews += num(row?.pageviews);
    totals.errors += num(row?.errors);
    return { day, sessions: Math.round(sessions), frustrated: Math.round(frustrated), conversions: Math.round(conversions) };
  });

  return {
    days: input.days,
    sessions: Math.round(totals.sessions),
    pageviews: Math.round(totals.pageviews),
    // A kept row carries no first-visit flag: unknown under a filter, never guessed.
    newVisitors: 0,
    conversions: Math.round(totals.conversions),
    conversionRate: totals.sessions ? totals.conversions / totals.sessions : 0,
    frustratedSessions: Math.round(totals.frustrated),
    frustratedRate: totals.sessions ? totals.frustrated / totals.sessions : 0,
    errorsPer1k: totals.sessions ? (totals.errors / totals.sessions) * 1000 : 0,
    // Vitals are a rollup histogram with no visitor in it.
    lcpP75: null,
    trend,
    estimated: true,
  };
}

/** Rows of a raw `execute` (the HTTP and pool drivers both answer `{ rows }`). */
function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] } | null)?.rows ?? []) as T[];
}

/**
 * Issues hit by the kept recordings matching the filter (`issue_fps`), most weighted
 * sessions first, offset-paged; each issue's share is of the filtered sessions on
 * its route. `estimated: true`.
 */
export async function readIssuesEstimated(
  env: Env,
  db: Db,
  store: Db,
  scope: ReplayScope,
  input: { days: number; status?: string | null; offset: number; limit?: number; now: Date; filter: ReplayFilter },
): Promise<ReplayPage<ReplayIssueDto>> {
  const { where, dayList } = await keptWhere(env, db, scope, input);
  const limit = Math.min(ISSUES_PAGE, Math.max(1, input.limit ?? ISSUES_PAGE));
  const w = replayRecordings.sampleWeight;

  const hits = rowsOf<{ fp: string; day: string; sessions: unknown }>(await store.execute(sql`
    select bf_f.fp as fp, to_char(${replayRecordings.startedAt}, 'YYYY-MM-DD') as day, sum(${w}) as sessions
    from ${replayRecordings}, unnest(${replayRecordings.issueFps}) as bf_f(fp)
    where ${where}
    group by bf_f.fp, day
    limit ${FILTERED_ISSUES_MAX * 8}
  `));
  const byFp = new Map<string, Map<string, number>>();
  for (const hit of hits) {
    const days = byFp.get(hit.fp) ?? new Map<string, number>();
    days.set(String(hit.day), (days.get(String(hit.day)) ?? 0) + num(hit.sessions));
    byFp.set(hit.fp, days);
  }
  const weightOf = (fp: string) => [...(byFp.get(fp)?.values() ?? [])].reduce((a, b) => a + b, 0);
  const fps = [...byFp.keys()].sort((a, b) => weightOf(b) - weightOf(a)).slice(0, FILTERED_ISSUES_MAX);
  if (fps.length === 0) return { items: [], nextCursor: null, estimated: true };

  const issues = await store
    .select(ISSUE_COLUMNS)
    .from(replayIssues)
    .where(and(
      eq(replayIssues.tenantId, scope.tenantId),
      eq(replayIssues.siteId, scope.siteId),
      inArray(replayIssues.fingerprint, fps),
      input.status ? eq(replayIssues.status, input.status) : undefined,
    ));
  const ranked = issues
    .map((row) => ({ row, sessions: weightOf(row.fingerprint) }))
    .sort((a, b) => b.sessions - a.sessions || a.row.id.localeCompare(b.row.id));
  const page = ranked.slice(input.offset, input.offset + limit);
  if (page.length === 0) return { items: [], nextCursor: null, estimated: true };

  const routes = [...new Set(page.map((p) => p.row.route))];
  const routeRows = rowsOf<{ route: string; sessions: unknown }>(await store.execute(sql`
    select bf_r.route as route, sum(${w}) as sessions
    from ${replayRecordings}, unnest(${replayRecordings.routes}) as bf_r(route)
    where ${where} and bf_r.route in (${sql.join(routes.map((r) => sql`${r}`), sql`, `)})
    group by bf_r.route
  `));
  const routeSessions = new Map(routeRows.map((r) => [r.route, num(r.sessions)]));

  return {
    items: page.map(({ row, sessions }) => {
      const days = byFp.get(row.fingerprint);
      return toIssueDto(row, {
        sessions: Math.round(sessions),
        routeSessions: routeSessions.get(row.route) ?? 0,
        sparkline: dayList.map((day) => Math.round(days?.get(day) ?? 0)),
      });
    }),
    nextCursor: ranked.length > input.offset + limit ? String(input.offset + limit) : null,
    estimated: true,
  };
}
