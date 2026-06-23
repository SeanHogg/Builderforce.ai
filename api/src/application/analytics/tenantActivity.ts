/**
 * Tenant-level activity rollup — the owner's cross-project view of "what's
 * happening" from every connected source, rolled up to the whole tenant rather
 * than one project or segment.
 *
 * activity_events is already tenant-scoped (not project-scoped) and carries
 * commits / PRs / issues ingested from connected repos and boards, so the
 * tenant total is cross-project by construction. This turns the raw stream into
 * the summary an owner wants: volume by type, by provider, by repository, the
 * daily trend, and the top contributors — all behind the read-through cache,
 * version-token keyed (the day-window keyspace is unbounded) and invalidated by
 * the contributor-merge path so a consolidation re-attributes activity at once.
 */
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { activityEvents, contributors, projects } from '../../infrastructure/database/schema';

const HOUR_MS = 3_600_000;
const TOP_N = 15;

function versionKey(tenantId: number): string { return `tenant-activity:ver:tenant:${tenantId}`; }
function rollupKey(tenantId: number, version: number, days: number): string {
  return `tenant-activity:rollup:tenant:${tenantId}:v:${version}:days:${days}`;
}
export async function readTenantActivityVersion(env: Env, tenantId: number): Promise<number> {
  return getOrSetCached(env, versionKey(tenantId), async () => 0, { kvTtlSeconds: 86_400 });
}
/** Bump so every window-keyed rollup ages out — called from the contributor
 *  merge/unmerge path (which re-attributes activity across contributors). */
export async function bumpTenantActivityVersion(env: Env, tenantId: number): Promise<void> {
  const key = versionKey(tenantId);
  const current = await readTenantActivityVersion(env, tenantId);
  await invalidateCached(env, key);
  await getOrSetCached(env, key, async () => current + 1, { kvTtlSeconds: 86_400 });
}

export interface TenantActivityRollup {
  windowDays: number;
  range: { from: string; to: string };
  totalEvents: number;
  activeContributors: number;
  totals: { linesAdded: number; linesRemoved: number };
  byType: Record<string, number>;
  byProvider: Array<{ provider: string; count: number }>;
  byRepository: Array<{ repository: string; count: number }>;
  byProject: Array<{ projectId: number; projectName: string; count: number }>;
  topContributors: Array<{ contributorId: number; displayName: string; count: number }>;
  daily: Array<{ date: string; count: number }>;
}

export async function computeTenantActivityRollup(db: Db, tenantId: number, days: number): Promise<TenantActivityRollup> {
  const since = new Date(Date.now() - days * 24 * HOUR_MS);
  const scope = and(eq(activityEvents.tenantId, tenantId), gte(activityEvents.occurredAt, since));

  const [byTypeRows, byProviderRows, byRepoRows, byProjectRows, dailyRows, topRows, totalsRow] = await Promise.all([
    db.select({ k: activityEvents.eventType, c: sql<number>`count(*)::int` }).from(activityEvents).where(scope).groupBy(activityEvents.eventType),
    db.select({ k: activityEvents.provider, c: sql<number>`count(*)::int` }).from(activityEvents).where(scope).groupBy(activityEvents.provider).orderBy(desc(sql`count(*)`)),
    db.select({ k: activityEvents.repositoryFullName, c: sql<number>`count(*)::int` })
      .from(activityEvents)
      .where(and(scope, sql`${activityEvents.repositoryFullName} is not null`))
      .groupBy(activityEvents.repositoryFullName).orderBy(desc(sql`count(*)`)).limit(TOP_N),
    db.select({ projectId: projects.id, projectName: projects.name, c: sql<number>`count(*)::int` })
      .from(activityEvents)
      .innerJoin(projects, eq(projects.id, activityEvents.projectId))
      .where(scope)
      .groupBy(projects.id, projects.name).orderBy(desc(sql`count(*)`)).limit(TOP_N),
    db.select({ d: sql<string>`to_char(date_trunc('day', ${activityEvents.occurredAt}), 'YYYY-MM-DD')`, c: sql<number>`count(*)::int` })
      .from(activityEvents).where(scope).groupBy(sql`date_trunc('day', ${activityEvents.occurredAt})`).orderBy(sql`date_trunc('day', ${activityEvents.occurredAt})`),
    db.select({ contributorId: contributors.id, displayName: contributors.displayName, c: sql<number>`count(*)::int` })
      .from(activityEvents)
      .innerJoin(contributors, eq(contributors.id, activityEvents.contributorId))
      .where(scope).groupBy(contributors.id, contributors.displayName).orderBy(desc(sql`count(*)`)).limit(TOP_N),
    db.select({
      total: sql<number>`count(*)::int`,
      la: sql<number>`coalesce(sum(${activityEvents.linesAdded}), 0)::int`,
      lr: sql<number>`coalesce(sum(${activityEvents.linesRemoved}), 0)::int`,
      contribs: sql<number>`count(distinct ${activityEvents.contributorId})::int`,
    }).from(activityEvents).where(scope),
  ]);

  const byType: Record<string, number> = {};
  for (const r of byTypeRows) byType[r.k] = Number(r.c);

  return {
    windowDays: days,
    range: { from: since.toISOString(), to: new Date().toISOString() },
    totalEvents: Number(totalsRow[0]?.total ?? 0),
    activeContributors: Number(totalsRow[0]?.contribs ?? 0),
    totals: { linesAdded: Number(totalsRow[0]?.la ?? 0), linesRemoved: Number(totalsRow[0]?.lr ?? 0) },
    byType,
    byProvider: byProviderRows.map((r) => ({ provider: r.k, count: Number(r.c) })),
    byRepository: byRepoRows.map((r) => ({ repository: r.k ?? '—', count: Number(r.c) })),
    byProject: byProjectRows.map((r) => ({ projectId: r.projectId, projectName: r.projectName, count: Number(r.c) })),
    topContributors: topRows.map((r) => ({ contributorId: r.contributorId, displayName: r.displayName, count: Number(r.c) })),
    daily: dailyRows.map((r) => ({ date: r.d, count: Number(r.c) })),
  };
}

/** Cached read-through wrapper. Version-token keyed; 5-min KV TTL backstop. */
export async function getTenantActivityRollup(env: Env, db: Db, tenantId: number, days: number): Promise<TenantActivityRollup> {
  const version = await readTenantActivityVersion(env, tenantId);
  return getOrSetCached(env, rollupKey(tenantId, version, days), () => computeTenantActivityRollup(db, tenantId, days), { kvTtlSeconds: 300 });
}
