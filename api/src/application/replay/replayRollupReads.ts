/**
 * Reads over the exact rollups and issue groups (PRD 33 D15/D18): KPIs from
 * `replay_route_daily` + the vitals histogram, issues from `replay_issues` +
 * `replay_issue_daily`. Uncached building blocks — `ReplayReadService` owns scope
 * checks and caching, and every function here still takes the full scope and puts
 * BOTH halves of it in every statement on a tenant-owned table.
 */

import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import {
  p75FromHistogram,
  VITAL_BUCKETS,
  type ReplayDeviceClass,
  type ReplayIssueDetailDto,
  type ReplayIssueDto,
  type ReplayKpisDto,
  type ReplayPage,
} from '@builderforce/interaction-contract';
import type { Db } from '../../infrastructure/database/connection';
import {
  replayIssueDaily,
  replayIssueRepresentatives,
  replayIssues,
  replayRouteDaily,
  replayVitalsDaily,
} from '../../infrastructure/database/schema';
import { NotFoundError } from '../../domain/shared/errors';
import { isUuid, type ReplayScope } from '../../domain/replay/replayScope';
import { ISSUES_PAGE, toIssueDto, windowDays, type IssueRow } from './replayReadModel';

const num = (value: unknown): number => Number(value ?? 0) || 0;

export async function readKpis(
  store: Db,
  scope: ReplayScope,
  input: { days: number; release?: string | null; now: Date },
): Promise<ReplayKpisDto> {
  const dayList = windowDays(input.now, input.days);
  const since = dayList[0]!;
  const releaseWhere = input.release ? eq(replayRouteDaily.releaseKey, input.release) : undefined;
  const daily = await store
    .select({
      day: replayRouteDaily.day,
      sessions: sql<string>`sum(${replayRouteDaily.sessions})`,
      pageviews: sql<string>`sum(${replayRouteDaily.pageviews})`,
      newVisitors: sql<string>`sum(${replayRouteDaily.newVisitors})`,
      conversions: sql<string>`sum(${replayRouteDaily.conversions})`,
      frustrated: sql<string>`sum(${replayRouteDaily.frustrated})`,
      errors: sql<string>`sum(${replayRouteDaily.errors})`,
    })
    .from(replayRouteDaily)
    .where(and(
      eq(replayRouteDaily.tenantId, scope.tenantId),
      eq(replayRouteDaily.siteId, scope.siteId),
      gte(replayRouteDaily.day, since),
      releaseWhere,
    ))
    .groupBy(replayRouteDaily.day);

  const lcp = await store
    .select({ bucket: replayVitalsDaily.bucket, n: sql<string>`sum(${replayVitalsDaily.n})` })
    .from(replayVitalsDaily)
    .where(and(
      eq(replayVitalsDaily.tenantId, scope.tenantId),
      eq(replayVitalsDaily.siteId, scope.siteId),
      eq(replayVitalsDaily.metric, 'LCP'),
      gte(replayVitalsDaily.day, since),
      input.release ? eq(replayVitalsDaily.releaseKey, input.release) : undefined,
    ))
    .groupBy(replayVitalsDaily.bucket);

  const byDay = new Map(daily.map((row) => [String(row.day), row]));
  const totals = { sessions: 0, pageviews: 0, newVisitors: 0, conversions: 0, frustrated: 0, errors: 0 };
  const trend = dayList.map((day) => {
    const row = byDay.get(day);
    const point = { day, sessions: num(row?.sessions), frustrated: num(row?.frustrated), conversions: num(row?.conversions) };
    totals.sessions += point.sessions;
    totals.frustrated += point.frustrated;
    totals.conversions += point.conversions;
    totals.pageviews += num(row?.pageviews);
    totals.newVisitors += num(row?.newVisitors);
    totals.errors += num(row?.errors);
    return point;
  });

  const counts = new Array<number>(VITAL_BUCKETS.LCP.length + 1).fill(0);
  for (const row of lcp) if (row.bucket >= 0 && row.bucket < counts.length) counts[row.bucket] = num(row.n);

  return {
    days: input.days,
    sessions: totals.sessions,
    pageviews: totals.pageviews,
    newVisitors: totals.newVisitors,
    conversions: totals.conversions,
    conversionRate: totals.sessions ? totals.conversions / totals.sessions : 0,
    frustratedSessions: totals.frustrated,
    frustratedRate: totals.sessions ? totals.frustrated / totals.sessions : 0,
    errorsPer1k: totals.sessions ? (totals.errors / totals.sessions) * 1000 : 0,
    lcpP75: p75FromHistogram(VITAL_BUCKETS.LCP, counts),
    trend,
  };
}

const ISSUE_COLUMNS = {
  id: replayIssues.id,
  fingerprint: replayIssues.fingerprint,
  kind: replayIssues.kind,
  route: replayIssues.route,
  subject: replayIssues.subject,
  title: replayIssues.title,
  status: replayIssues.status,
  firstRelease: replayIssues.firstRelease,
  lastRelease: replayIssues.lastRelease,
  firstSeenAt: replayIssues.firstSeenAt,
  lastSeenAt: replayIssues.lastSeenAt,
  prescriptionId: replayIssues.prescriptionId,
};

/** Sessions, share of the route and daily sparkline for a set of issues. */
async function issueStats(store: Db, scope: ReplayScope, rows: IssueRow[], dayList: string[]): Promise<ReplayIssueDto[]> {
  if (rows.length === 0) return [];
  const since = dayList[0]!;
  const daily = await store
    .select({ issueId: replayIssueDaily.issueId, day: replayIssueDaily.day, sessions: sql<string>`sum(${replayIssueDaily.sessions})` })
    .from(replayIssueDaily)
    .where(and(inArray(replayIssueDaily.issueId, rows.map((r) => r.id)), gte(replayIssueDaily.day, since)))
    .groupBy(replayIssueDaily.issueId, replayIssueDaily.day);
  const routeTotals = await store
    .select({ route: replayRouteDaily.route, sessions: sql<string>`sum(${replayRouteDaily.pageviews})` })
    .from(replayRouteDaily)
    .where(and(
      eq(replayRouteDaily.tenantId, scope.tenantId),
      eq(replayRouteDaily.siteId, scope.siteId),
      gte(replayRouteDaily.day, since),
      inArray(replayRouteDaily.route, [...new Set(rows.map((r) => r.route))]),
    ))
    .groupBy(replayRouteDaily.route);
  const routeSessions = new Map(routeTotals.map((r) => [r.route, num(r.sessions)]));
  return rows.map((row) => {
    const mine = new Map(daily.filter((d) => d.issueId === row.id).map((d) => [String(d.day), num(d.sessions)]));
    const sparkline = dayList.map((day) => mine.get(day) ?? 0);
    const sessions = sparkline.reduce((a, b) => a + b, 0);
    return toIssueDto(row, { sessions, routeSessions: routeSessions.get(row.route) ?? 0, sparkline });
  });
}

/** Issues with sessions in the window, most sessions first, offset-paged. */
export async function readIssues(
  store: Db,
  scope: ReplayScope,
  input: { days: number; status?: string | null; offset: number; limit?: number; now: Date },
): Promise<ReplayPage<ReplayIssueDto>> {
  const dayList = windowDays(input.now, input.days);
  const limit = Math.min(ISSUES_PAGE, Math.max(1, input.limit ?? ISSUES_PAGE));
  const sessions = sql<number>`sum(${replayIssueDaily.sessions})`;
  const rows = await store
    .select(ISSUE_COLUMNS)
    .from(replayIssues)
    .innerJoin(replayIssueDaily, eq(replayIssueDaily.issueId, replayIssues.id))
    .where(and(
      eq(replayIssues.tenantId, scope.tenantId),
      eq(replayIssues.siteId, scope.siteId),
      gte(replayIssueDaily.day, dayList[0]!),
      input.status ? eq(replayIssues.status, input.status) : undefined,
    ))
    .groupBy(replayIssues.id)
    .orderBy(desc(sessions), asc(replayIssues.id))
    .limit(limit + 1)
    .offset(input.offset);
  const page = rows.slice(0, limit);
  return {
    items: await issueStats(store, scope, page, dayList),
    nextCursor: rows.length > limit ? String(input.offset + limit) : null,
  };
}

/** One issue with its representatives and its release/device split. 404 outside the scope. */
export async function readIssue(
  store: Db,
  scope: ReplayScope,
  input: { issueId: string; days: number; now: Date },
): Promise<ReplayIssueDetailDto> {
  if (!isUuid(input.issueId)) throw new NotFoundError('Issue', input.issueId);
  const [row] = await store
    .select(ISSUE_COLUMNS)
    .from(replayIssues)
    .where(and(
      eq(replayIssues.tenantId, scope.tenantId),
      eq(replayIssues.siteId, scope.siteId),
      eq(replayIssues.id, input.issueId),
    ))
    .limit(1);
  if (!row) throw new NotFoundError('Issue', input.issueId);

  const dayList = windowDays(input.now, input.days);
  const [base] = await issueStats(store, scope, [row], dayList);
  const representatives = await store
    .select({
      rank: replayIssueRepresentatives.rank,
      recordingId: replayIssueRepresentatives.recordingId,
      share: replayIssueRepresentatives.share,
      label: replayIssueRepresentatives.label,
    })
    .from(replayIssueRepresentatives)
    .where(eq(replayIssueRepresentatives.issueId, row.id))
    .orderBy(asc(replayIssueRepresentatives.rank));
  const split = await store
    .select({
      releaseKey: replayIssueDaily.releaseKey,
      deviceClass: replayIssueDaily.deviceClass,
      sessions: sql<string>`sum(${replayIssueDaily.sessions})`,
    })
    .from(replayIssueDaily)
    .where(and(eq(replayIssueDaily.issueId, row.id), gte(replayIssueDaily.day, dayList[0]!)))
    .groupBy(replayIssueDaily.releaseKey, replayIssueDaily.deviceClass);

  const byRelease = new Map<string, number>();
  const byDevice = new Map<string, number>();
  for (const s of split) {
    byRelease.set(s.releaseKey, (byRelease.get(s.releaseKey) ?? 0) + num(s.sessions));
    byDevice.set(s.deviceClass, (byDevice.get(s.deviceClass) ?? 0) + num(s.sessions));
  }
  return {
    ...base!,
    representatives: representatives.map((r) => ({ rank: r.rank, recordingId: r.recordingId, share: r.share, label: r.label })),
    byRelease: [...byRelease].map(([releaseKey, sessions]) => ({ releaseKey, sessions })),
    byDevice: [...byDevice].map(([deviceClass, sessions]) => ({ deviceClass: deviceClass as ReplayDeviceClass, sessions })),
  };
}
