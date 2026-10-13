/**
 * Flushing the rollup buffer — one ADDITIVE upsert per table (PRD 33 D18 (1)).
 *
 * `n = n + EXCLUDED.n` on every counter, keyed by each table's primary key, so
 * concurrent isolates flushing the same cell sum instead of overwriting. Each key
 * appears once per statement because the buffer already summed by key (Postgres
 * refuses an ON CONFLICT that touches one row twice). Issues upsert by fingerprint
 * first and their daily rows follow with the ids that came back.
 */

import { sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import {
  replayBreakdownDaily,
  replayHeatDaily,
  replayIssueDaily,
  replayIssues,
  replayLive,
  replayReleases,
  replayRouteDaily,
  replayVitalsDaily,
} from '../../infrastructure/database/schema';
import { excluded } from '../../infrastructure/database/upsert';
import { replayTelemetryDb } from './replayDatabase';
import type { ReplayRollupBatch } from './replayRollupBuffer';

const k = (...parts: Array<string | number>) => parts.join('|');

/** Rows per statement — far below Postgres' parameter ceiling for the widest table. */
const STATEMENT_ROWS = 400;

function slices<T>(rows: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += STATEMENT_ROWS) out.push(rows.slice(i, i + STATEMENT_ROWS));
  return out;
}

const plus = (column: Parameters<typeof excluded>[0]) => sql`${column} + ${excluded(column)}`;

/**
 * Persist a drained batch. One additive statement per table (per slice). Never
 * throws past a table: a failed table is reported and the others still land.
 */
export async function flushReplayRollups(
  env: Env | undefined,
  db: Db,
  batch: ReplayRollupBatch,
  report: (error: unknown, table: string) => void,
): Promise<void> {
  const store = replayTelemetryDb(env, db);
  const run = async (table: string, work: () => Promise<unknown>) => {
    try {
      await work();
    } catch (error) {
      report(error, table);
    }
  };

  await run('replay_route_daily', async () => {
    for (const rows of slices(batch.routes)) {
      await store.insert(replayRouteDaily).values(rows.map((r) => ({
        siteId: r.siteId, tenantId: r.tenantId, day: r.day, releaseKey: r.releaseKey, route: r.route,
        deviceClass: r.deviceClass, sessions: r.sessions, entries: r.entries, exits: r.exits,
        pageviews: r.pageviews, newVisitors: r.newVisitors, conversions: r.conversions,
        frustrated: r.frustrated, errors: r.errors, activeMsSum: r.activeMsSum, scrollDepthSum: r.scrollDepthSum,
      }))).onConflictDoUpdate({
        target: [replayRouteDaily.siteId, replayRouteDaily.day, replayRouteDaily.releaseKey, replayRouteDaily.route, replayRouteDaily.deviceClass],
        set: {
          sessions: plus(replayRouteDaily.sessions),
          entries: plus(replayRouteDaily.entries),
          exits: plus(replayRouteDaily.exits),
          pageviews: plus(replayRouteDaily.pageviews),
          newVisitors: plus(replayRouteDaily.newVisitors),
          conversions: plus(replayRouteDaily.conversions),
          frustrated: plus(replayRouteDaily.frustrated),
          errors: plus(replayRouteDaily.errors),
          activeMsSum: plus(replayRouteDaily.activeMsSum),
          scrollDepthSum: plus(replayRouteDaily.scrollDepthSum),
        },
      });
    }
  });

  await run('replay_breakdown_daily', async () => {
    for (const rows of slices(batch.breakdowns)) {
      await store.insert(replayBreakdownDaily).values(rows.map((r) => ({
        siteId: r.siteId, tenantId: r.tenantId, day: r.day, dim: r.dim, value: r.value, sessions: r.sessions,
      }))).onConflictDoUpdate({
        target: [replayBreakdownDaily.siteId, replayBreakdownDaily.day, replayBreakdownDaily.dim, replayBreakdownDaily.value],
        set: { sessions: plus(replayBreakdownDaily.sessions) },
      });
    }
  });

  await run('replay_heat_daily', async () => {
    for (const rows of slices(batch.heat)) {
      await store.insert(replayHeatDaily).values(rows.map((r) => ({
        siteId: r.siteId, tenantId: r.tenantId, day: r.day, releaseKey: r.releaseKey, route: r.route,
        deviceClass: r.deviceClass, kind: r.kind, selector: r.selector, label: r.label, gx: r.gx, gy: r.gy, n: r.n,
      }))).onConflictDoUpdate({
        target: [
          replayHeatDaily.siteId, replayHeatDaily.day, replayHeatDaily.releaseKey, replayHeatDaily.route,
          replayHeatDaily.deviceClass, replayHeatDaily.kind, replayHeatDaily.selector, replayHeatDaily.label,
          replayHeatDaily.gx, replayHeatDaily.gy,
        ],
        set: { n: plus(replayHeatDaily.n) },
      });
    }
  });

  await run('replay_vitals_daily', async () => {
    for (const rows of slices(batch.vitals)) {
      await store.insert(replayVitalsDaily).values(rows.map((r) => ({
        siteId: r.siteId, tenantId: r.tenantId, day: r.day, releaseKey: r.releaseKey, route: r.route,
        deviceClass: r.deviceClass, metric: r.metric, bucket: r.bucket, n: r.n,
      }))).onConflictDoUpdate({
        target: [
          replayVitalsDaily.siteId, replayVitalsDaily.day, replayVitalsDaily.releaseKey, replayVitalsDaily.route,
          replayVitalsDaily.deviceClass, replayVitalsDaily.metric, replayVitalsDaily.bucket,
        ],
        set: { n: plus(replayVitalsDaily.n) },
      });
    }
  });

  await run('replay_issues', async () => {
    for (const rows of slices(batch.issues)) {
      const upserted = await store.insert(replayIssues).values(rows.map((r) => ({
        siteId: r.siteId, tenantId: r.tenantId, fingerprint: r.fingerprint, kind: r.kind, route: r.route,
        subject: r.subject, title: r.title, firstRelease: r.firstRelease, lastRelease: r.lastRelease,
        firstSeenAt: r.firstSeenAt, lastSeenAt: r.lastSeenAt,
      }))).onConflictDoUpdate({
        target: [replayIssues.siteId, replayIssues.fingerprint],
        set: {
          lastRelease: excluded(replayIssues.lastRelease),
          lastSeenAt: sql`greatest(${replayIssues.lastSeenAt}, ${excluded(replayIssues.lastSeenAt)})`,
          // A verified fix seen again on a NEWER release has regressed; a new issue
          // still occurring a day later is ongoing. Everything else keeps its status.
          status: sql`case
            when ${replayIssues.status} = 'verified' and ${excluded(replayIssues.lastRelease)} is distinct from ${replayIssues.lastRelease} then 'regressed'
            when ${replayIssues.status} = 'new' and ${replayIssues.firstSeenAt} < now() - interval '1 day' then 'ongoing'
            else ${replayIssues.status} end`,
          updatedAt: sql`now()`,
        },
      }).returning({ id: replayIssues.id, siteId: replayIssues.siteId, fingerprint: replayIssues.fingerprint });

      const idFor = new Map(upserted.map((row) => [k(row.siteId, row.fingerprint), row.id]));
      const daily = rows.flatMap((r) => {
        const issueId = idFor.get(k(r.siteId, r.fingerprint));
        return issueId ? [...r.daily.values()].map((d) => ({ issueId, ...d })) : [];
      });
      for (const dailyRows of slices(daily)) {
        await store.insert(replayIssueDaily).values(dailyRows).onConflictDoUpdate({
          target: [replayIssueDaily.issueId, replayIssueDaily.day, replayIssueDaily.releaseKey, replayIssueDaily.deviceClass],
          set: { sessions: plus(replayIssueDaily.sessions) },
        });
      }
    }
  });

  await run('replay_live', async () => {
    for (const rows of slices(batch.live)) {
      await store.insert(replayLive).values(rows.map((r) => ({
        siteId: r.siteId, tenantId: r.tenantId, visitId: r.visitId, lastSeenAt: r.lastSeenAt, route: r.route,
        deviceClass: r.deviceClass, x: r.x, y: r.y, recordingId: r.recordingId,
      }))).onConflictDoUpdate({
        target: [replayLive.siteId, replayLive.visitId],
        set: {
          lastSeenAt: excluded(replayLive.lastSeenAt),
          route: excluded(replayLive.route),
          deviceClass: excluded(replayLive.deviceClass),
          x: sql`coalesce(${excluded(replayLive.x)}, ${replayLive.x})`,
          y: sql`coalesce(${excluded(replayLive.y)}, ${replayLive.y})`,
          recordingId: sql`coalesce(${excluded(replayLive.recordingId)}, ${replayLive.recordingId})`,
        },
      });
    }
  });

  await run('replay_releases', async () => {
    for (const rows of slices(batch.releases)) {
      await store.insert(replayReleases).values(rows.map((r) => ({
        siteId: r.siteId, tenantId: r.tenantId, releaseKey: r.releaseKey, source: r.source,
        firstSeenAt: r.firstSeenAt, lastSeenAt: r.lastSeenAt,
      }))).onConflictDoUpdate({
        target: [replayReleases.siteId, replayReleases.releaseKey],
        set: { lastSeenAt: sql`greatest(${replayReleases.lastSeenAt}, ${excluded(replayReleases.lastSeenAt)})` },
      });
    }
  });
}
