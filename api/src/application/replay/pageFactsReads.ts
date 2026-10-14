/**
 * The behaviour and FIELD vitals of key pages (PRD 33 §5.2) — two bounded aggregate
 * statements over the exact rollups, uncached building blocks for `pageAggregates.ts`
 * and the capture callback's score. Every statement carries both halves of the scope.
 *
 * A captured path is a concrete URL path; the rollups are keyed by its ROUTE
 * (`routeTemplate`), so the reads map one to the other.
 */

import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { p75FromHistogram, routeTemplate, VITAL_BUCKETS, type VitalMetric } from '@builderforce/interaction-contract';
import type { Db } from '../../infrastructure/database/connection';
import { replayRouteDaily, replayVitalsDaily } from '../../infrastructure/database/schema';
import type { ReplayScope } from '../../domain/replay/replayScope';
import {
  EMPTY_BEHAVIOUR,
  EMPTY_VITALS,
  type PageBehaviour,
  type PageVitals,
} from '../../domain/replay/prescriptions/pageFacts';

const num = (value: unknown): number => Number(value ?? 0) || 0;

export interface PageBehaviourSplit {
  all: PageBehaviour;
  desktop: PageBehaviour;
  phone: PageBehaviour;
}

export const emptySplit = (): PageBehaviourSplit => ({ all: { ...EMPTY_BEHAVIOUR }, desktop: { ...EMPTY_BEHAVIOUR }, phone: { ...EMPTY_BEHAVIOUR } });

/** The route a captured path is rolled up under. */
export const routeOfPath = (path: string): string => routeTemplate(path);

/** Sessions / conversions / frustrated per page and device since `sinceDay`, plus the site totals. */
export async function readPageBehaviour(
  store: Db,
  scope: ReplayScope,
  paths: readonly string[],
  sinceDay: string,
): Promise<{ pages: Map<string, PageBehaviourSplit>; site: { sessions: number; conversions: number } }> {
  const routes = [...new Set(paths.map(routeOfPath))];
  const where = and(eq(replayRouteDaily.tenantId, scope.tenantId), eq(replayRouteDaily.siteId, scope.siteId), gte(replayRouteDaily.day, sinceDay));
  const [rows, totals] = await Promise.all([
    routes.length === 0 ? Promise.resolve([]) : store
      .select({
        route: replayRouteDaily.route,
        deviceClass: replayRouteDaily.deviceClass,
        sessions: sql<string>`sum(${replayRouteDaily.sessions})`,
        conversions: sql<string>`sum(${replayRouteDaily.conversions})`,
        frustrated: sql<string>`sum(${replayRouteDaily.frustrated})`,
      })
      .from(replayRouteDaily)
      .where(and(where, inArray(replayRouteDaily.route, routes)))
      .groupBy(replayRouteDaily.route, replayRouteDaily.deviceClass),
    store
      .select({ sessions: sql<string>`sum(${replayRouteDaily.sessions})`, conversions: sql<string>`sum(${replayRouteDaily.conversions})` })
      .from(replayRouteDaily)
      .where(where),
  ]);
  const byRoute = new Map<string, PageBehaviourSplit>();
  for (const row of rows) {
    const split = byRoute.get(row.route) ?? emptySplit();
    const b = { sessions: num(row.sessions), conversions: num(row.conversions), frustrated: num(row.frustrated) };
    for (const key of ['sessions', 'conversions', 'frustrated'] as const) split.all[key] += b[key];
    if (row.deviceClass === 'desktop' || row.deviceClass === 'phone') {
      for (const key of ['sessions', 'conversions', 'frustrated'] as const) split[row.deviceClass][key] += b[key];
    }
    byRoute.set(row.route, split);
  }
  const pages = new Map(paths.map((path) => [path, byRoute.get(routeOfPath(path)) ?? emptySplit()]));
  return { pages, site: { sessions: num(totals[0]?.sessions), conversions: num(totals[0]?.conversions) } };
}

/** Field p75 per page and device (LCP / CLS / INP) from the vitals histogram. */
export async function readPageVitals(
  store: Db,
  scope: ReplayScope,
  paths: readonly string[],
  sinceDay: string,
): Promise<Map<string, { desktop: PageVitals; phone: PageVitals }>> {
  const routes = [...new Set(paths.map(routeOfPath))];
  const out = new Map(paths.map((path) => [path, { desktop: { ...EMPTY_VITALS }, phone: { ...EMPTY_VITALS } }]));
  if (routes.length === 0) return out;
  const rows = await store
    .select({
      route: replayVitalsDaily.route,
      deviceClass: replayVitalsDaily.deviceClass,
      metric: replayVitalsDaily.metric,
      bucket: replayVitalsDaily.bucket,
      n: sql<string>`sum(${replayVitalsDaily.n})`,
    })
    .from(replayVitalsDaily)
    .where(and(
      eq(replayVitalsDaily.tenantId, scope.tenantId),
      eq(replayVitalsDaily.siteId, scope.siteId),
      gte(replayVitalsDaily.day, sinceDay),
      inArray(replayVitalsDaily.route, routes),
    ))
    .groupBy(replayVitalsDaily.route, replayVitalsDaily.deviceClass, replayVitalsDaily.metric, replayVitalsDaily.bucket);

  // route → device → metric → bucket counts
  const hist = new Map<string, number[]>();
  const keyOf = (route: string, device: string, metric: string) => `${route}\u001f${device}\u001f${metric}`;
  for (const row of rows) {
    const bounds = VITAL_BUCKETS[row.metric as VitalMetric];
    if (!bounds || (row.deviceClass !== 'desktop' && row.deviceClass !== 'phone')) continue;
    const key = keyOf(row.route, row.deviceClass, row.metric);
    const counts = hist.get(key) ?? new Array<number>(bounds.length + 1).fill(0);
    if (row.bucket >= 0 && row.bucket < counts.length) counts[row.bucket] = num(row.n);
    hist.set(key, counts);
  }
  for (const [path, vitals] of out) {
    const route = routeOfPath(path);
    for (const device of ['desktop', 'phone'] as const) {
      const p75 = (metric: VitalMetric) => {
        const counts = hist.get(keyOf(route, device, metric));
        return counts ? p75FromHistogram(VITAL_BUCKETS[metric], counts) : null;
      };
      const lcpCounts = hist.get(keyOf(route, device, 'LCP')) ?? [];
      vitals[device] = {
        lcpP75: p75('LCP'),
        clsP75: p75('CLS'),
        inpP75: p75('INP'),
        samples: lcpCounts.reduce((a, b) => a + b, 0),
      };
    }
  }
  return out;
}
