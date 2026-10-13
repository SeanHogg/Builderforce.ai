/**
 * The effect of a ticket raised from a replay moment (PRD 33 §5.3.4, S3 + S4d).
 *
 * The player writes the moment onto the ticket (`formatReplayMomentTrailer` — the
 * site, recording, time, release, route and the rollup metric the moment speaks
 * to). `effectFor` reads it back and compares that metric's per-session rate on
 * the moment's route between the moment's release (before) and the NEWEST release
 * since (after), from `replay_route_daily` — exact counts over every session, not
 * kept recordings. It is `waiting` until the newer release has
 * {@link REPLAY_EFFECT_MIN_VISITS} sessions on that route; a delta on a handful of
 * visits would be a coincidence wearing a verdict.
 *
 * Computed on read, never stored; cached under the site's replay version.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  fnv1a64,
  replayMomentFromDescription,
  type ReplayMoment,
  type ReplayTicketEffectDto,
} from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { replayReleases, replayRouteDaily, tasks } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { NotFoundError } from '../../domain/shared/errors';
import type { ReplayScope } from '../../domain/replay/replayScope';
import { replayReadKeys } from './replayCacheKeys';
import { replayTelemetryDb } from './replayDatabase';
import { getSiteForTenant } from './replaySites';

/** Sessions the newer release needs on the route before the delta is reported. */
export const REPLAY_EFFECT_MIN_VISITS = 200;
const TTL = { kvTtlSeconds: 300, l1TtlMs: 30_000 };

/** The rollup column each moment metric reads. */
const METRIC_COLUMNS = {
  frustrated: replayRouteDaily.frustrated,
  errors: replayRouteDaily.errors,
  conversions: replayRouteDaily.conversions,
} as const;

interface ReleaseStats {
  releaseKey: string;
  sessions: number;
  hits: number;
}

const rate = (stats: ReleaseStats | undefined): number | null =>
  stats && stats.sessions > 0 ? stats.hits / stats.sessions : null;

/** Pure: the effect from the releases (oldest first) and their stats on the route. */
export function foldTicketEffect(
  taskId: number,
  moment: ReplayMoment,
  releases: ReadonlyArray<{ releaseKey: string; firstSeenAt: Date }>,
  stats: readonly ReleaseStats[],
): ReplayTicketEffectDto {
  const byKey = new Map(stats.map((s) => [s.releaseKey, s]));
  const base = byKey.get(moment.releaseKey);
  const before = { releaseKey: moment.releaseKey, sessions: base?.sessions ?? 0, rate: rate(base) };
  const baseSeen = releases.find((r) => r.releaseKey === moment.releaseKey)?.firstSeenAt ?? null;
  const newer = baseSeen ? releases.filter((r) => r.firstSeenAt.getTime() > baseSeen.getTime()) : [];
  const newest = newer[newer.length - 1];
  const afterStats = newest ? byKey.get(newest.releaseKey) : undefined;
  const after = newest ? { releaseKey: newest.releaseKey, sessions: afterStats?.sessions ?? 0, rate: rate(afterStats) } : null;
  const measured = !!after && after.sessions >= REPLAY_EFFECT_MIN_VISITS && after.rate !== null && before.rate !== null;
  return {
    taskId,
    status: measured ? 'measured' : 'waiting',
    metric: moment.metric,
    route: moment.route,
    before,
    after,
    delta: measured ? after!.rate! - before.rate! : null,
    minVisits: REPLAY_EFFECT_MIN_VISITS,
  };
}

async function readEffect(env: Env, db: Db, scope: ReplayScope, taskId: number, moment: ReplayMoment): Promise<ReplayTicketEffectDto> {
  const store = replayTelemetryDb(env, db);
  const releases = (await store
    .select({ releaseKey: replayReleases.releaseKey, firstSeenAt: replayReleases.firstSeenAt })
    .from(replayReleases)
    .where(and(eq(replayReleases.tenantId, scope.tenantId), eq(replayReleases.siteId, scope.siteId)))
    .orderBy(replayReleases.firstSeenAt))
    .map((r) => ({ releaseKey: r.releaseKey, firstSeenAt: r.firstSeenAt instanceof Date ? r.firstSeenAt : new Date(String(r.firstSeenAt)) }));

  const base = releases.find((r) => r.releaseKey === moment.releaseKey);
  const keys = [moment.releaseKey, ...(base ? releases.filter((r) => r.firstSeenAt > base.firstSeenAt).slice(-1).map((r) => r.releaseKey) : [])];
  const column = METRIC_COLUMNS[moment.metric];
  const rows = await store
    .select({
      releaseKey: replayRouteDaily.releaseKey,
      sessions: sql<number>`coalesce(sum(${replayRouteDaily.sessions}), 0)`,
      hits: sql<number>`coalesce(sum(${column}), 0)`,
    })
    .from(replayRouteDaily)
    .where(and(
      eq(replayRouteDaily.tenantId, scope.tenantId),
      eq(replayRouteDaily.siteId, scope.siteId),
      eq(replayRouteDaily.route, moment.route),
      inArray(replayRouteDaily.releaseKey, keys),
    ))
    .groupBy(replayRouteDaily.releaseKey);
  return foldTicketEffect(taskId, moment, releases, rows.map((r) => ({
    releaseKey: r.releaseKey,
    sessions: Number(r.sessions) || 0,
    hits: Number(r.hits) || 0,
  })));
}

/**
 * The effect of a moment with no ticket behind it (S4f: a fix a person applied by hand
 * from its prompt) — the same fold, read and cache as a ticket's. `taskId` is 0.
 */
export async function momentEffect(env: Env, db: Db, scope: ReplayScope, moment: ReplayMoment): Promise<ReplayTicketEffectDto> {
  const keys = await replayReadKeys(env, scope);
  return getOrSetCached(env, keys.ticketEffect(0, fnv1a64(JSON.stringify(moment))), () => readEffect(env, db, scope, 0, moment), TTL);
}

/**
 * The ticket's measured effect, or null when it was not raised from a replay
 * moment. 404 for a task outside the workspace; 403 when the moment names a site
 * that is not the workspace's (`getSiteForTenant`).
 */
export async function effectFor(env: Env, db: Db, input: { tenantId: number; taskId: number }): Promise<ReplayTicketEffectDto | null> {
  const [task] = await db
    .select({ id: tasks.id, description: tasks.description })
    .from(tasks)
    .where(scopedToTenant(tasks, input.tenantId, eq(tasks.id, input.taskId)))
    .limit(1);
  if (!task) throw new NotFoundError('Task', input.taskId);
  const moment = replayMomentFromDescription(task.description);
  if (!moment) return null;
  const site = await getSiteForTenant(env, db, input.tenantId, moment.siteId);
  const scope: ReplayScope = { tenantId: input.tenantId, siteId: site.id };
  const keys = await replayReadKeys(env, scope);
  return getOrSetCached(env, keys.ticketEffect(task.id, fnv1a64(JSON.stringify(moment))), () => readEffect(env, db, scope, task.id, moment), TTL);
}
