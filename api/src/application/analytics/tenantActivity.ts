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
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { activityEvents, contributors, ideAgents, projects } from '../../infrastructure/database/schema';
import { computeInteractionActivity } from './interactionActivity';

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
  const now = new Date();
  const since = new Date(now.getTime() - days * 24 * HOUR_MS);
  const scope = and(eq(activityEvents.tenantId, tenantId), gte(activityEvents.occurredAt, since));

  const [
    byTypeRows, byProviderRows, byRepoRows, byProjectRows, dailyRows, topRows, totalsRow,
    gitActorRows, contribRows, interaction,
  ] = await Promise.all([
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
    }).from(activityEvents).where(scope),
    // Distinct git actors mapped to their user/host identity so the active-actor
    // union dedupes a person who both commits AND uses the product in-window.
    db.select({ contributorId: activityEvents.contributorId, userId: contributors.userId, agentHostId: contributors.agentHostId })
      .from(activityEvents)
      .leftJoin(contributors, eq(contributors.id, activityEvents.contributorId))
      .where(scope)
      .groupBy(activityEvents.contributorId, contributors.userId, contributors.agentHostId),
    // Contributor identity map — folds interaction totals back onto named rows.
    db.select({ id: contributors.id, displayName: contributors.displayName, userId: contributors.userId, agentHostId: contributors.agentHostId })
      .from(contributors).where(and(eq(contributors.tenantId, tenantId), eq(contributors.isActive, true))),
    // The usage/interaction ledgers (AI calls + code-change deltas).
    computeInteractionActivity(db, tenantId, since, now),
  ]);

  // ── by type: git event types + interaction buckets ──────────────────────────
  const byType: Record<string, number> = {};
  for (const r of byTypeRows) byType[r.k] = Number(r.c);
  if (interaction.byType.ai_interaction > 0) byType.ai_interaction = interaction.byType.ai_interaction;
  if (interaction.byType.code_change > 0) byType.code_change = interaction.byType.code_change;

  // ── active contributors: union of git actors + interaction actors ───────────
  const actorKeys = new Set<string>();
  for (const r of gitActorRows) {
    if (r.userId) actorKeys.add(`u:${r.userId}`);
    else if (r.agentHostId != null) actorKeys.add(`h:${r.agentHostId}`);
    else if (r.contributorId != null) actorKeys.add(`c:${r.contributorId}`);
  }
  for (const uid of interaction.distinctHumanUserIds) actorKeys.add(`u:${uid}`);
  for (const hid of interaction.distinctAgentHostIds) actorKeys.add(`h:${hid}`);
  for (const ref of interaction.distinctCloudAgentRefs) actorKeys.add(`ca:${ref}`);

  // ── daily: git events + interactions, merged per day ────────────────────────
  const dailyMap = new Map<string, number>();
  for (const r of dailyRows) dailyMap.set(r.d, Number(r.c));
  for (const [day, n] of interaction.daily) dailyMap.set(day, (dailyMap.get(day) ?? 0) + n);
  const daily = [...dailyMap.entries()].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date));

  // ── top contributors: git counts + interaction totals mapped onto rows ──────
  const byUserId = new Map<string, { id: number; displayName: string }>();
  const byHostId = new Map<number, { id: number; displayName: string }>();
  for (const cr of contribRows) {
    if (cr.userId) byUserId.set(cr.userId, { id: cr.id, displayName: cr.displayName });
    if (cr.agentHostId != null) byHostId.set(cr.agentHostId, { id: cr.id, displayName: cr.displayName });
  }
  const topIndex = new Map<number, { displayName: string; count: number }>();
  for (const r of topRows) topIndex.set(r.contributorId, { displayName: r.displayName, count: Number(r.c) });
  const bumpTop = (id: number, displayName: string, n: number) => {
    const cur = topIndex.get(id) ?? { displayName, count: 0 };
    cur.count += n; topIndex.set(id, cur);
  };
  for (const [uid, n] of interaction.humanTotalsByUserId) {
    const cr = byUserId.get(uid); if (cr) bumpTop(cr.id, cr.displayName, n);
  }
  for (const [hid, n] of interaction.agentTotalsByHostId) {
    const cr = byHostId.get(hid); if (cr) bumpTop(cr.id, cr.displayName, n);
  }
  // Cloud agents (ide_agents) have no contributors row — resolve names by ref and
  // fold them in under synthetic negative ids so they rank on the top list too.
  if (interaction.cloudAgentTotalsByRef.size > 0) {
    const refs = [...interaction.cloudAgentTotalsByRef.keys()];
    const agentRows = await db
      .select({ id: ideAgents.id, name: ideAgents.name })
      .from(ideAgents).where(and(eq(ideAgents.tenantId, tenantId), inArray(ideAgents.id, refs)));
    const nameByRef = new Map(agentRows.map((r) => [r.id, r.name] as const));
    let cloudSynth = 0;
    for (const [ref, n] of interaction.cloudAgentTotalsByRef) {
      bumpTop(-(1_000_000 + (++cloudSynth)), nameByRef.get(ref) ?? ref, n);
    }
  }
  const topContributors = [...topIndex.entries()]
    .map(([contributorId, v]) => ({ contributorId, displayName: v.displayName, count: v.count }))
    .sort((a, b) => b.count - a.count).slice(0, TOP_N);

  // ── by project: git attribution + interaction attribution, names resolved ───
  const projMap = new Map<number, { name: string; count: number }>();
  for (const r of byProjectRows) projMap.set(r.projectId, { name: r.projectName, count: Number(r.c) });
  const missingProjectIds = [...interaction.byProject.keys()].filter((id) => !projMap.has(id));
  const projectNameById = new Map<number, string>();
  if (missingProjectIds.length > 0) {
    const rows = await db.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.id, missingProjectIds));
    for (const r of rows) projectNameById.set(r.id, r.name);
  }
  for (const [id, n] of interaction.byProject) {
    const existing = projMap.get(id);
    if (existing) existing.count += n;
    else projMap.set(id, { name: projectNameById.get(id) ?? `Project ${id}`, count: n });
  }
  const byProject = [...projMap.entries()]
    .map(([projectId, v]) => ({ projectId, projectName: v.name, count: v.count }))
    .sort((a, b) => b.count - a.count).slice(0, TOP_N);

  return {
    windowDays: days,
    range: { from: since.toISOString(), to: now.toISOString() },
    totalEvents: Number(totalsRow[0]?.total ?? 0) + interaction.totalEvents,
    activeContributors: actorKeys.size,
    totals: { linesAdded: Number(totalsRow[0]?.la ?? 0), linesRemoved: Number(totalsRow[0]?.lr ?? 0) },
    byType,
    byProvider: byProviderRows.map((r) => ({ provider: r.k, count: Number(r.c) })),
    byRepository: byRepoRows.map((r) => ({ repository: r.k ?? '—', count: Number(r.c) })),
    byProject,
    topContributors,
    daily,
  };
}

/** Cached read-through wrapper. Version-token keyed; 5-min KV TTL backstop. */
export async function getTenantActivityRollup(env: Env, db: Db, tenantId: number, days: number): Promise<TenantActivityRollup> {
  const version = await readTenantActivityVersion(env, tenantId);
  return getOrSetCached(env, rollupKey(tenantId, version, days), () => computeTenantActivityRollup(db, tenantId, days), { kvTtlSeconds: 300 });
}
