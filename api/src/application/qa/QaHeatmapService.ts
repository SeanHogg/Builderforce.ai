/**
 * QaHeatmapService — rank the app's "hot zones" from raw client journey events.
 *
 * The Agentic Tester decides WHAT to exercise by looking at interaction *heat*:
 * the per-(route, selector) frequency already captured in qa_journey_events. A
 * control thousands of users click every day is a far more valuable thing to
 * smoke than one nobody touches, so heat (recency-weighted) is the ranking.
 *
 * Heat is tenant-wide (events carry no project_id — capture runs in the app
 * shell, not per customer site), mirroring QaFlowService.aggregate. The
 * exploration that consumes a plan still targets a specific project/target/URL.
 *
 * Read-through cached behind a per-tenant version token bumped on event ingest,
 * so a hot read costs nothing until new interactions land.
 */

import { and, desc, gte, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { qaJourneyEvents } from '../../infrastructure/database/schema';
import { getCacheVersion, getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import type { Env } from '../../env';
import type { QaHeatZone } from './qaTypes';

export const QA_HEAT_VERSION_KEY = (tenantId: number): string => `qa-heat-version:tenant:${tenantId}`;

/** Recency decay applied per day since a zone's last interaction (0.97/day ≈ a
 *  ~23-day half-life): a zone hot last week outranks one equally hot last year. */
const DECAY_PER_DAY = 0.97;
const DAY_MS = 24 * 60 * 60 * 1000;

interface RankOpts {
  sinceDays?: number;
  /** How many ranked zones to return. */
  limit?: number;
}

function score(heat: number, lastTs: string | Date | null, now: number): number {
  if (!lastTs) return heat;
  const last = lastTs instanceof Date ? lastTs.getTime() : new Date(lastTs).getTime();
  if (!Number.isFinite(last)) return heat;
  const ageDays = Math.max(0, (now - last) / DAY_MS);
  return heat * Math.pow(DECAY_PER_DAY, ageDays);
}

export class QaHeatmapService {
  constructor(private readonly db: Db, private readonly env?: Env) {}

  /** Ranked hot zones for a tenant, recency-weighted, cached. */
  async rankZones(tenantId: number, opts: RankOpts = {}): Promise<QaHeatZone[]> {
    const sinceDays = Math.max(1, opts.sinceDays ?? 30);
    const limit = Math.min(Math.max(1, opts.limit ?? 50), 200);

    const load = () => this.computeZones(tenantId, sinceDays, limit);
    if (!this.env) return load();

    const ver = await getCacheVersion(this.env, QA_HEAT_VERSION_KEY(tenantId));
    return getOrSetCached(
      this.env,
      `qa-heatmap:tenant:${tenantId}:v:${ver}:d:${sinceDays}:n:${limit}`,
      load,
      { kvTtlSeconds: 300 },
    );
  }

  private async computeZones(tenantId: number, sinceDays: number, limit: number): Promise<QaHeatZone[]> {
    const since = new Date(Date.now() - sinceDays * DAY_MS);
    const now = Date.now();

    // Element-level zones: a specific control, by its dominant interaction kind.
    const elementRows = await this.db
      .select({
        route:    qaJourneyEvents.route,
        selector: qaJourneyEvents.selector,
        kind:     qaJourneyEvents.type,
        label:    sql<string | null>`max(${qaJourneyEvents.label})`,
        heat:     sql<number>`count(*)::int`,
        lastTs:   sql<string>`max(${qaJourneyEvents.ts})`,
      })
      .from(qaJourneyEvents)
      .where(and(
        gte(qaJourneyEvents.ts, since),
        isNotNull(qaJourneyEvents.selector),
        sql`${qaJourneyEvents.tenantId} = ${tenantId}`,
      ))
      .groupBy(qaJourneyEvents.route, qaJourneyEvents.selector, qaJourneyEvents.type)
      .orderBy(desc(sql`count(*)`))
      .limit(limit * 3);

    // Route-level zones: a page, by how often it's viewed.
    const routeRows = await this.db
      .select({
        route:  qaJourneyEvents.route,
        heat:   sql<number>`count(*)::int`,
        lastTs: sql<string>`max(${qaJourneyEvents.ts})`,
      })
      .from(qaJourneyEvents)
      .where(and(
        gte(qaJourneyEvents.ts, since),
        isNotNull(qaJourneyEvents.route),
        sql`${qaJourneyEvents.type} in ('pageview','nav')`,
        sql`${qaJourneyEvents.tenantId} = ${tenantId}`,
      ))
      .groupBy(qaJourneyEvents.route)
      .orderBy(desc(sql`count(*)`))
      .limit(limit);

    const zones: QaHeatZone[] = [];
    for (const r of routeRows) {
      if (!r.route) continue;
      zones.push({ route: r.route, selector: null, kind: 'pageview', label: null, heat: Number(r.heat), score: score(Number(r.heat), r.lastTs, now) });
    }
    for (const e of elementRows) {
      if (!e.selector) continue;
      zones.push({
        route: e.route ?? '/',
        selector: e.selector,
        kind: e.kind,
        label: e.label ?? null,
        heat: Number(e.heat),
        score: score(Number(e.heat), e.lastTs, now),
      });
    }

    return zones.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
