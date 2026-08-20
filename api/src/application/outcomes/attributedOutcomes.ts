/**
 * attributedOutcomes — "the thing you built did something for somebody".
 *
 * THE HALF THE IDEA→DELIVERY PANEL WAS MISSING
 * `creation_outcome_events` measures the PROCESS: this session produced an
 * artifact, in this many minutes, at this success rate. That is the half the
 * panel already charts, and on its own it is a productivity report — it can say a
 * board shipped faster than its peers and cannot say whether anybody outside the
 * building ever touched what it shipped.
 *
 * The other half was already being written and simply never read here. The
 * growth, delivery and canvas rollups now stamp `metric_facts.object_id` and a
 * `dimension_key`, and `site_collections.origin_session_id` carries the lineage
 * from a published site back to the canvas session that made it. So:
 *
 *   • `canvas.shipped` carries `dimension_key = 'session:<id>'` — what this
 *     session delivered;
 *   • `growth.leads` / `growth.conversions` carry `dimension_key = 'site:<id>'`
 *     — what the sites this session published then produced.
 *
 * Joining those two on the session is the whole feature: a founder seeing that
 * the thing they built did something for somebody. This module is the read; it
 * computes nothing new, because computing it a second time here is exactly how
 * the panel and the rollup would come to disagree.
 *
 * Two bounded queries, no N+1: one for the session's sites, one for every fact.
 */

import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { metricFacts, projectSites, siteCollections } from '../../infrastructure/database/schema';

/** Default lookback. Matches the 90-day window the rollups themselves write. */
export const ATTRIBUTED_WINDOW_DAYS = 90;

/** The metric keys that carry a session- or site-scoped attribution. */
export const ATTRIBUTED_SESSION_METRICS = ['canvas.shipped'] as const;
export const ATTRIBUTED_SITE_METRICS = ['growth.leads', 'growth.conversions'] as const;

/** One day of one attributed series (UTC 'YYYY-MM-DD'). */
export interface AttributedPoint {
  day: string;
  value: number;
}

export interface AttributedSeries {
  /** The `metric_facts.metric` key — e.g. `growth.leads`. */
  metric: string;
  unit: string | null;
  /** What the series is attributed TO. */
  subject: { kind: 'session' | 'site'; id: string; label: string | null };
  total: number;
  points: AttributedPoint[];
}

export interface AttributedOutcomes {
  sessionId: string;
  windowDays: number;
  /** The sites this session's work published — the route a canvas takes to a stranger. */
  sites: Array<{ id: number; subdomain: string | null }>;
  series: AttributedSeries[];
  /**
   * True when the session has published nothing yet, so there is no outcome to
   * attribute — which the panel must SAY rather than draw as a flat zero line.
   * "Nobody has seen it yet" and "people saw it and did nothing" are different
   * news, and a zero series renders them identically.
   */
  unpublished: boolean;
}

/** A site whose collections trace back to this session. */
async function sitesForSession(db: Db, tenantId: number, sessionId: string) {
  const rows = await db
    .selectDistinct({ id: projectSites.id, subdomain: projectSites.subdomain })
    .from(siteCollections)
    .innerJoin(projectSites, eq(projectSites.id, siteCollections.siteId))
    .where(and(
      eq(siteCollections.tenantId, tenantId),
      eq(siteCollections.originSessionId, sessionId),
    ));
  return rows.map((r) => ({ id: Number(r.id), subdomain: r.subdomain ?? null }));
}

/**
 * Read every attributed fact for one canvas session.
 *
 * The caller supplies the tenant; nothing here derives it, because a metric fact
 * is tenant-scoped and a session id alone would let one workspace's board read
 * another's leads.
 */
export async function buildAttributedOutcomes(
  db: Db,
  args: { tenantId: number; sessionId: string; windowDays?: number },
): Promise<AttributedOutcomes> {
  const windowDays = Math.min(365, Math.max(1, Math.floor(args.windowDays ?? ATTRIBUTED_WINDOW_DAYS)));
  const sites = await sitesForSession(db, args.tenantId, args.sessionId);

  const keys = [
    `session:${args.sessionId}`,
    ...sites.map((s) => `site:${s.id}`),
  ];
  const metrics = [...ATTRIBUTED_SESSION_METRICS, ...ATTRIBUTED_SITE_METRICS];

  const rows = await db
    .select({
      metric: metricFacts.metric,
      unit: metricFacts.unit,
      dimensionKey: metricFacts.dimensionKey,
      bucketAt: metricFacts.bucketAt,
      value: metricFacts.value,
    })
    .from(metricFacts)
    .where(and(
      eq(metricFacts.tenantId, args.tenantId),
      eq(metricFacts.bucket, 'day'),
      inArray(metricFacts.metric, [...metrics]),
      inArray(metricFacts.dimensionKey, keys),
      gte(metricFacts.bucketAt, sql`NOW() - (${windowDays} * INTERVAL '1 day')`),
    ))
    .orderBy(asc(metricFacts.bucketAt));

  return {
    sessionId: args.sessionId,
    windowDays,
    sites,
    series: shapeAttributedSeries(rows, args.sessionId, sites),
    unpublished: sites.length === 0,
  };
}

/** One `metric_facts` row, as the query above selects it. */
export interface AttributedFactRow {
  metric: string;
  unit: string | null;
  dimensionKey: string;
  bucketAt: Date | string;
  value: string | number | null;
}

/**
 * Fold the facts into per-(metric, subject) series.
 *
 * Extracted and pure because every interesting case here is a data-shape case —
 * an unparseable numeric, a site that has since been renamed, two metrics
 * against one site — and none of them needs a database to be wrong.
 */
export function shapeAttributedSeries(
  rows: readonly AttributedFactRow[],
  sessionId: string,
  sites: ReadonlyArray<{ id: number; subdomain: string | null }>,
): AttributedSeries[] {
  const bySeries = new Map<string, AttributedSeries>();
  const labelForSite = new Map(sites.map((s) => [`site:${s.id}`, s.subdomain]));

  for (const row of rows) {
    const value = Number(row.value ?? 0);
    // A fact that will not parse is dropped rather than counted as zero: a zero
    // day and a missing day are different claims about whether anybody showed up.
    if (!Number.isFinite(value)) continue;

    const seriesKey = `${row.metric}|${row.dimensionKey}`;
    let series = bySeries.get(seriesKey);
    if (!series) {
      const isSite = row.dimensionKey.startsWith('site:');
      series = {
        metric: row.metric,
        unit: row.unit ?? null,
        subject: isSite
          ? { kind: 'site', id: row.dimensionKey.slice('site:'.length), label: labelForSite.get(row.dimensionKey) ?? null }
          : { kind: 'session', id: sessionId, label: null },
        total: 0,
        points: [],
      };
      bySeries.set(seriesKey, series);
    }
    series.points.push({ day: toDay(row.bucketAt), value });
    series.total += value;
  }

  for (const series of bySeries.values()) series.points.sort((a, b) => a.day.localeCompare(b.day));

  // Session series first, then site series — the order the story is told in:
  // you shipped it, and then these people did something with it.
  return [...bySeries.values()].sort((a, b) => {
    if (a.subject.kind !== b.subject.kind) return a.subject.kind === 'session' ? -1 : 1;
    return a.metric.localeCompare(b.metric);
  });
}

/** A `bucket_at` timestamp as a UTC calendar day, matching `dailySeries`. */
function toDay(at: Date | string): string {
  const d = at instanceof Date ? at : new Date(at);
  return Number.isNaN(d.getTime()) ? String(at) : d.toISOString().slice(0, 10);
}
