/**
 * Uncached reads behind the prescription aggregates (PRD 33 §5.1) — the few facts
 * the existing Insights services do not already answer. Each is ONE bounded,
 * aggregate statement (never a scan folded in memory), every statement carries
 * both halves of the scope, and `prescriptionAggregates.ts` caches the whole set
 * under the site's version token.
 *
 *   readIssueCohorts   converting vs not among kept recordings with / without an
 *                      issue on its route (≈, weighted by `sample_weight`)
 *   readDropIssueFps   the issue fingerprints a sample of funnel drop-outs carried
 *   readErrorIssues    which of those fingerprints are error issues
 *   readSplits         exact sessions + conversions per device and per release
 *   readKnownCohorts   identifiable visitors at a pricing / checkout moment
 *   readMissedProofs   the site's project's graded proofs
 */

import { and, desc, eq, gte, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import {
  realizations,
  replayIssues,
  replayRecordings,
  replayRouteDaily,
} from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { ReplayScope } from '../../domain/replay/replayScope';
import type {
  ImpactCohorts,
  KnownCohortAggregate,
  ProofAggregate,
  SplitAggregate,
} from '../../domain/replay/prescriptions/types';

const num = (value: unknown): number => Number(value ?? 0) || 0;
const rowsOf = <T>(result: unknown): T[] => (result as { rows?: T[] }).rows ?? [];

/** Kept recordings read for the known-visitor cohorts (newest first). */
export const KNOWN_SCAN_MAX = 1_000;
const PRICING_ROUTE = /(^|\/)(pricing|plans?|prices?)(\/|$)/i;
const CHECKOUT_ROUTE = /(^|\/)(checkout|cart|basket)(\/|$)/i;

function scopeWhere(scope: ReplayScope, since: Date): SQL {
  return and(
    eq(replayRecordings.tenantId, scope.tenantId),
    eq(replayRecordings.siteId, scope.siteId),
    gte(replayRecordings.startedAt, since),
  ) as SQL;
}

/**
 * Per issue: the kept recordings that visited its route, split by whether they hit
 * it, with the weighted conversions of each half.
 */
export async function readIssueCohorts(
  store: Db,
  scope: ReplayScope,
  since: Date,
  issues: ReadonlyArray<{ fingerprint: string; route: string }>,
): Promise<Map<string, ImpactCohorts>> {
  const out = new Map<string, ImpactCohorts>();
  if (issues.length === 0) return out;
  const w = replayRecordings.sampleWeight;
  const hit = sql`${replayRecordings.issueFps} @> array[bf_i.fp]::text[]`;
  const result = await store.execute(sql`
    select bf_i.fp as fp,
      coalesce(sum(case when ${hit} then ${w} else 0 end), 0) as with_visits,
      coalesce(sum(case when ${hit} and ${replayRecordings.converted} then ${w} else 0 end), 0) as with_conv,
      coalesce(sum(${w}), 0) as route_visits,
      coalesce(sum(case when ${replayRecordings.converted} then ${w} else 0 end), 0) as route_conv
    from (values ${sql.join(issues.map((i) => sql`(${i.fingerprint}::text, ${i.route}::text)`), sql`, `)}) as bf_i(fp, route)
    join ${replayRecordings} on ${replayRecordings.routes} @> array[bf_i.route]::text[]
    where ${scopeWhere(scope, since)}
    group by bf_i.fp
  `);
  for (const row of rowsOf<{ fp: string; with_visits: unknown; with_conv: unknown; route_visits: unknown; route_conv: unknown }>(result)) {
    const withVisits = num(row.with_visits);
    const withConv = num(row.with_conv);
    out.set(row.fp, {
      with: { visits: withVisits, conversions: withConv },
      without: { visits: Math.max(0, num(row.route_visits) - withVisits), conversions: Math.max(0, num(row.route_conv) - withConv) },
      estimated: true,
    });
  }
  return out;
}

/** The issue fingerprints each of these (dropped) recordings carried. */
export async function readDropIssueFps(store: Db, scope: ReplayScope, recordingIds: readonly string[]): Promise<Map<string, string[]>> {
  if (recordingIds.length === 0) return new Map();
  const rows = await store
    .select({ id: replayRecordings.id, issueFps: replayRecordings.issueFps })
    .from(replayRecordings)
    .where(and(
      eq(replayRecordings.tenantId, scope.tenantId),
      eq(replayRecordings.siteId, scope.siteId),
      inArray(replayRecordings.id, [...new Set(recordingIds)]),
    ));
  return new Map(rows.map((row) => [row.id, row.issueFps ?? []]));
}

/** The error issues among these fingerprints. */
export async function readErrorIssues(
  store: Db,
  scope: ReplayScope,
  fingerprints: readonly string[],
): Promise<Array<{ id: string; fingerprint: string; subject: string; route: string }>> {
  if (fingerprints.length === 0) return [];
  return store
    .select({ id: replayIssues.id, fingerprint: replayIssues.fingerprint, subject: replayIssues.subject, route: replayIssues.route })
    .from(replayIssues)
    .where(and(
      eq(replayIssues.tenantId, scope.tenantId),
      eq(replayIssues.siteId, scope.siteId),
      eq(replayIssues.kind, 'error'),
      inArray(replayIssues.fingerprint, [...new Set(fingerprints)]),
    ));
}

/** Exact sessions and conversions per device and per release over the window. */
export async function readSplits(
  store: Db,
  scope: ReplayScope,
  sinceDay: string,
): Promise<{ devices: SplitAggregate[]; releases: SplitAggregate[] }> {
  const where = and(
    eq(replayRouteDaily.tenantId, scope.tenantId),
    eq(replayRouteDaily.siteId, scope.siteId),
    gte(replayRouteDaily.day, sinceDay),
  );
  const sessions = sql<string>`sum(${replayRouteDaily.sessions})`;
  const conversions = sql<string>`sum(${replayRouteDaily.conversions})`;
  const [devices, releases] = await Promise.all([
    store.select({ value: replayRouteDaily.deviceClass, sessions, conversions }).from(replayRouteDaily).where(where).groupBy(replayRouteDaily.deviceClass),
    store.select({ value: replayRouteDaily.releaseKey, sessions, conversions }).from(replayRouteDaily).where(where).groupBy(replayRouteDaily.releaseKey),
  ]);
  const toSplit = (row: { value: string; sessions: unknown; conversions: unknown }): SplitAggregate =>
    ({ value: row.value, sessions: num(row.sessions), conversions: num(row.conversions) });
  return { devices: devices.map(toSplit), releases: releases.map(toSplit) };
}

/** The identity a recording carries: `identified_id`, else the `user` tag. Never shown, only grouped. */
export function identityOf(row: { identifiedId: string | null; tags: unknown }): string | null {
  if (row.identifiedId) return row.identifiedId;
  const tags = row.tags && typeof row.tags === 'object' && !Array.isArray(row.tags) ? (row.tags as Record<string, unknown>) : {};
  return typeof tags.user === 'string' && tags.user ? tags.user : null;
}

/** Identifiable visitors who reached pricing / began checkout, by route, and how many converted. */
export async function readKnownCohorts(store: Db, scope: ReplayScope, since: Date): Promise<KnownCohortAggregate[]> {
  const rows = await store
    .select({
      id: replayRecordings.id,
      identifiedId: replayRecordings.identifiedId,
      tags: replayRecordings.tags,
      routes: replayRecordings.routes,
      events: replayRecordings.events,
      converted: replayRecordings.converted,
    })
    .from(replayRecordings)
    .where(and(
      scopeWhere(scope, since),
      or(isNotNull(replayRecordings.identifiedId), sql`${replayRecordings.tags} ? 'user'`),
    ))
    .orderBy(desc(replayRecordings.startedAt))
    .limit(KNOWN_SCAN_MAX);

  type Bucket = { kind: 'pricing' | 'checkout'; route: string; visitors: Map<string, boolean>; recordingIds: string[] };
  const buckets = new Map<string, Bucket>();
  const note = (kind: Bucket['kind'], route: string, identity: string, converted: boolean, recordingId: string) => {
    const key = `${kind}|${route}`;
    const bucket = buckets.get(key) ?? { kind, route, visitors: new Map<string, boolean>(), recordingIds: [] };
    buckets.set(key, bucket);
    bucket.visitors.set(identity, (bucket.visitors.get(identity) ?? false) || converted);
    if (!converted && bucket.recordingIds.length < 10) bucket.recordingIds.push(recordingId);
  };
  for (const row of rows) {
    const identity = identityOf(row);
    if (!identity) continue;
    const routes = row.routes ?? [];
    const events = row.events ?? [];
    const pricing = routes.find((r) => PRICING_ROUTE.test(r));
    if (pricing) note('pricing', pricing, identity, row.converted, row.id);
    const checkout = events.includes('begin checkout') ? (routes.find((r) => CHECKOUT_ROUTE.test(r)) ?? '') : routes.find((r) => CHECKOUT_ROUTE.test(r));
    if (checkout !== undefined) note('checkout', checkout, identity, events.includes('purchase'), row.id);
  }
  return [...buckets.values()].map((b) => ({
    kind: b.kind,
    route: b.route,
    identifiedVisitors: b.visitors.size,
    convertedVisitors: [...b.visitors.values()].filter(Boolean).length,
    recordingIds: b.recordingIds,
  }));
}

/** The graded proofs of a hosted site's project, newest first. */
export async function readGradedProofs(db: Db, tenantId: number, projectId: number): Promise<ProofAggregate[]> {
  const rows = await db
    .select({ id: realizations.id, title: realizations.title, verdict: realizations.verdict, verdictMetric: realizations.verdictMetric })
    .from(realizations)
    .where(scopedToTenant(realizations, tenantId, eq(realizations.projectId, projectId), inArray(realizations.verdict, ['met', 'missed'])))
    .orderBy(desc(realizations.updatedAt))
    .limit(5);
  return rows.map((row) => {
    const metric = row.verdictMetric && typeof row.verdictMetric === 'object' ? (row.verdictMetric as Record<string, unknown>) : {};
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    return {
      realizationId: row.id,
      title: row.title,
      verdict: row.verdict === 'met' ? 'met' : 'missed',
      metricLabel: typeof metric.metricLabel === 'string' ? metric.metricLabel : null,
      metricValue: n(metric.metricValue),
      target: n(metric.target),
    };
  });
}
