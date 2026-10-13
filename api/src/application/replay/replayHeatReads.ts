/**
 * Uncached reads behind the heatmap (PRD 33 §3.2, §8 S4) over the exact rollups —
 * `replay_heat_daily`, `replay_route_daily`, the `quickback` issue groups — and the
 * kept recordings for the background snapshot. `ReplayHeatmapService` owns caching;
 * every statement here still carries BOTH halves of the scope (D17).
 */

import { and, arrayContains, desc, eq, gte, inArray, ne, sql, type SQL } from 'drizzle-orm';
import {
  REPLAY_HEAT_KINDS,
  type ReplayDeviceClass,
  type ReplayHeatKind,
  type ReplayRouteStatDto,
} from '@builderforce/interaction-contract';
import type { Db } from '../../infrastructure/database/connection';
import {
  replayHeatDaily,
  replayIssueDaily,
  replayIssues,
  replayRecordings,
  replayRouteDaily,
} from '../../infrastructure/database/schema';
import { ValidationError } from '../../domain/shared/errors';
import type { ReplayScope } from '../../domain/replay/replayScope';
import type { ElementCellRow } from '../../domain/replay/heatFold';
import { clampDays } from './replayReadModel';

const DEVICE_CLASSES: readonly ReplayDeviceClass[] = ['desktop', 'tablet', 'phone'];
const ROUTE_MAX = 200;
const RELEASE_MAX = 64;
/** Grouped (selector, kind, row) cells read per release — the heaviest elements first. */
export const ELEMENT_CELL_LIMIT = 5_000;
/** Top routes listed by `routes`. */
export const ROUTES_LIMIT = 50;

/** A heatmap query, normalised. `release: null` = every release; `device: null` = every device. */
export interface HeatQuery {
  route: string;
  release: string | null;
  compare: string | null;
  device: ReplayDeviceClass | null;
  kind: ReplayHeatKind;
  days: number;
}

export interface RawHeatQuery {
  route?: string | null;
  release?: string | null;
  compare?: string | null;
  device?: string | null;
  kind?: string | null;
  days?: number;
}

const optionalKey = (value: string | null | undefined, max: number, name: string): string | null => {
  const clean = value?.trim() ?? '';
  if (!clean) return null;
  if (clean.length > max) throw new ValidationError(`${name} is too long`);
  return clean;
};

/** Validate and default a heatmap query (400 on a missing route or an unknown kind/device). */
export function normalizeHeatQuery(raw: RawHeatQuery): HeatQuery {
  const route = raw.route?.trim() ?? '';
  if (!route) throw new ValidationError('route is required');
  if (route.length > ROUTE_MAX) throw new ValidationError('route is too long');
  const kind = (raw.kind?.trim() || 'click') as ReplayHeatKind;
  if (!REPLAY_HEAT_KINDS.includes(kind)) throw new ValidationError(`kind must be one of ${REPLAY_HEAT_KINDS.join(', ')}`);
  const device = raw.device?.trim() || null;
  if (device !== null && !DEVICE_CLASSES.includes(device as ReplayDeviceClass)) {
    throw new ValidationError(`device must be one of ${DEVICE_CLASSES.join(', ')}`);
  }
  return {
    route,
    release: optionalKey(raw.release, RELEASE_MAX, 'release'),
    compare: optionalKey(raw.compare, RELEASE_MAX, 'compare'),
    device: device as ReplayDeviceClass | null,
    kind,
    days: clampDays(raw.days),
  };
}

const num = (value: unknown): number => Number(value ?? 0) || 0;

/** A `date` column value (string or Date, by driver) as midnight UTC. */
function dayDate(value: unknown): Date {
  if (value instanceof Date) return value;
  return new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
}

/** The site + window + route + release + device predicate on `replay_heat_daily` (the caller adds the tenant). */
function heatWhere(scope: ReplayScope, q: { route: string; release: string | null; device: ReplayDeviceClass | null; since: string }, ...more: Array<SQL | undefined>) {
  return and(
    eq(replayHeatDaily.siteId, scope.siteId),
    gte(replayHeatDaily.day, q.since),
    eq(replayHeatDaily.route, q.route),
    q.release ? eq(replayHeatDaily.releaseKey, q.release) : undefined,
    q.device ? eq(replayHeatDaily.deviceClass, q.device) : undefined,
    ...more,
  );
}

/** Summed cells of one heat kind. */
export async function readHeatCells(
  store: Db,
  scope: ReplayScope,
  q: { route: string; release: string | null; device: ReplayDeviceClass | null; kind: ReplayHeatKind; since: string },
): Promise<Array<{ gx: number; gy: number; n: number }>> {
  const rows = await store
    .select({ gx: replayHeatDaily.gx, gy: replayHeatDaily.gy, n: sql<string>`sum(${replayHeatDaily.n})` })
    .from(replayHeatDaily)
    .where(and(
      eq(replayHeatDaily.tenantId, scope.tenantId),
      heatWhere(scope, q, eq(replayHeatDaily.kind, q.kind)),
    ))
    .groupBy(replayHeatDaily.gx, replayHeatDaily.gy);
  return rows.map((row) => ({ gx: row.gx, gy: row.gy, n: num(row.n) })).filter((cell) => cell.n > 0);
}

/** Click/rage/dead cells grouped by (selector, kind, row), heaviest first. */
export async function readElementCells(
  store: Db,
  scope: ReplayScope,
  q: { route: string; release: string | null; device: ReplayDeviceClass | null; since: string },
): Promise<ElementCellRow[]> {
  const total = sql<string>`sum(${replayHeatDaily.n})`;
  const rows = await store
    .select({
      selector: replayHeatDaily.selector,
      label: sql<string>`max(${replayHeatDaily.label})`,
      kind: replayHeatDaily.kind,
      gy: replayHeatDaily.gy,
      n: total,
      lastDay: sql<string>`max(${replayHeatDaily.day})`,
    })
    .from(replayHeatDaily)
    .where(and(
      eq(replayHeatDaily.tenantId, scope.tenantId),
      heatWhere(scope, q, inArray(replayHeatDaily.kind, ['click', 'rage', 'dead']), ne(replayHeatDaily.selector, '')),
    ))
    .groupBy(replayHeatDaily.selector, replayHeatDaily.kind, replayHeatDaily.gy)
    .orderBy(desc(total))
    .limit(ELEMENT_CELL_LIMIT);
  return rows.map((row) => ({
    selector: row.selector,
    label: row.label || null,
    kind: row.kind,
    gy: row.gy,
    n: num(row.n),
    lastSeen: dayDate(row.lastDay),
  }));
}

/** Deepest-decile counts (`kind = 'scroll'`, `gy` = decile). */
export async function readScrollDeciles(
  store: Db,
  scope: ReplayScope,
  q: { route: string; release: string | null; device: ReplayDeviceClass | null; since: string },
): Promise<Array<{ decile: number; n: number }>> {
  const cells = await readHeatCells(store, scope, { ...q, kind: 'scroll' });
  return cells.map((cell) => ({ decile: cell.gy, n: cell.n }));
}

/** The busiest routes in the window by page views. */
export async function readRouteStats(store: Db, scope: ReplayScope, since: string): Promise<ReplayRouteStatDto[]> {
  const pageviews = sql<string>`sum(${replayRouteDaily.pageviews})`;
  const rows = await store
    .select({ route: replayRouteDaily.route, sessions: sql<string>`sum(${replayRouteDaily.sessions})`, pageviews })
    .from(replayRouteDaily)
    .where(and(
      eq(replayRouteDaily.tenantId, scope.tenantId),
      eq(replayRouteDaily.siteId, scope.siteId),
      gte(replayRouteDaily.day, since),
    ))
    .groupBy(replayRouteDaily.route)
    .orderBy(desc(pageviews))
    .limit(ROUTES_LIMIT);
  return rows.map((row) => ({ route: row.route, sessions: num(row.sessions), pageviews: num(row.pageviews) }));
}

/** Per-release totals for one route: `current` (the release, or all) and `compare`. */
export interface ReleasePair {
  current: number;
  compare: number | null;
}

function pairOf(byRelease: Map<string, number>, release: string | null, compare: string | null): ReleasePair {
  const current = release
    ? byRelease.get(release) ?? 0
    : [...byRelease.values()].reduce((a, b) => a + b, 0);
  return { current, compare: compare ? byRelease.get(compare) ?? 0 : null };
}

const releaseFilter = (q: { release: string | null; compare: string | null }): string[] | null =>
  q.release ? [q.release, ...(q.compare ? [q.compare] : [])] : null;

/** The route's page views for the release and the compare release. */
export async function readRoutePageviews(
  store: Db,
  scope: ReplayScope,
  q: { route: string; release: string | null; compare: string | null; device: ReplayDeviceClass | null; since: string },
): Promise<ReleasePair> {
  const releases = releaseFilter(q);
  const rows = await store
    .select({ releaseKey: replayRouteDaily.releaseKey, pageviews: sql<string>`sum(${replayRouteDaily.pageviews})` })
    .from(replayRouteDaily)
    .where(and(
      eq(replayRouteDaily.tenantId, scope.tenantId),
      eq(replayRouteDaily.siteId, scope.siteId),
      gte(replayRouteDaily.day, q.since),
      eq(replayRouteDaily.route, q.route),
      q.device ? eq(replayRouteDaily.deviceClass, q.device) : undefined,
      releases ? inArray(replayRouteDaily.releaseKey, releases) : undefined,
    ))
    .groupBy(replayRouteDaily.releaseKey);
  return pairOf(new Map(rows.map((row) => [row.releaseKey, num(row.pageviews)])), q.release, q.compare);
}

/**
 * Sessions with a quick back on the route, per release. `replay_route_daily` has no
 * quick-back column, so this reads the route's `quickback` issue groups.
 */
export async function readRouteQuickbacks(
  store: Db,
  scope: ReplayScope,
  q: { route: string; release: string | null; compare: string | null; device: ReplayDeviceClass | null; since: string },
): Promise<ReleasePair> {
  const releases = releaseFilter(q);
  const rows = await store
    .select({ releaseKey: replayIssueDaily.releaseKey, sessions: sql<string>`sum(${replayIssueDaily.sessions})` })
    .from(replayIssueDaily)
    .innerJoin(replayIssues, eq(replayIssues.id, replayIssueDaily.issueId))
    .where(and(
      eq(replayIssues.tenantId, scope.tenantId),
      eq(replayIssues.siteId, scope.siteId),
      eq(replayIssues.kind, 'quickback'),
      eq(replayIssues.route, q.route),
      gte(replayIssueDaily.day, q.since),
      q.device ? eq(replayIssueDaily.deviceClass, q.device) : undefined,
      releases ? inArray(replayIssueDaily.releaseKey, releases) : undefined,
    ))
    .groupBy(replayIssueDaily.releaseKey);
  return pairOf(new Map(rows.map((row) => [row.releaseKey, num(row.sessions)])), q.release, q.compare);
}

/**
 * The newest kept recording that visited the route, preferring one that ENTERED on it
 * (its first stored chunk then holds that page's full snapshot).
 */
export async function readSnapshotRecording(
  store: Db,
  scope: ReplayScope,
  q: { route: string; release: string | null; device: ReplayDeviceClass | null; since: Date },
): Promise<{ id: string; tenantId: number; siteId: string; startedAt: Date } | null> {
  const [row] = await store
    .select({
      id: replayRecordings.id,
      tenantId: replayRecordings.tenantId,
      siteId: replayRecordings.siteId,
      startedAt: replayRecordings.startedAt,
    })
    .from(replayRecordings)
    .where(and(
      eq(replayRecordings.tenantId, scope.tenantId),
      eq(replayRecordings.siteId, scope.siteId),
      gte(replayRecordings.startedAt, q.since),
      arrayContains(replayRecordings.routes, [q.route]),
      q.release ? eq(replayRecordings.releaseKey, q.release) : undefined,
      q.device ? eq(replayRecordings.deviceClass, q.device) : undefined,
    ))
    .orderBy(sql`(${replayRecordings.routes}[1] = ${q.route}) desc`, desc(replayRecordings.startedAt))
    .limit(1);
  return row ?? null;
}
