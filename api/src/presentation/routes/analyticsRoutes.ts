/**
 * Analytics routes – /api/analytics
 *
 * Unified team-performance analytics that merge HUMAN contributors (git/PR
 * activity, already aggregated into contributor_daily_metrics) with AI AGENT
 * contributors (BuilderForce Agents telemetry: task spans + tool-audit events). Agents are
 * first-class contributors (contributors.kind = 'agent', linked by agent_host_id), so
 * the activity calendar shows the whole team — people and agentHosts — on one
 * GitHub-style heatmap.
 *
 * GET  /api/analytics/activity-calendar   365-day unified heatmap (MANAGER+)
 * POST /api/analytics/sync-agents         Upsert an agent contributor per agentHost (MANAGER+)
 */

import { Hono } from 'hono';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import {
  contributors,
  contributorDailyMetrics,
  telemetrySpans,
  toolAuditEvents,
  agentHosts,
  ideAgents,
  tenantMembers,
  users,
} from '../../infrastructure/database/schema';
import { TenantRole } from '../../domain/shared/types';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { getTenantActivityRollup } from '../../application/analytics/tenantActivity';
import { computeInteractionActivity } from '../../application/analytics/interactionActivity';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';

const DAY_MS = 24 * 60 * 60 * 1000;

function dayFloorUTC(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function fmtDay(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

/** GitHub-style 0–4 intensity bucket for `count` relative to `max`. */
function levelFor(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  const r = count / max;
  if (r >= 0.75) return 4;
  if (r >= 0.5) return 3;
  if (r >= 0.25) return 2;
  return 1;
}

/**
 * Assemble the whole-team contribution calendar from all activity sources:
 *   - human git/PR intensity (contributor_daily_metrics),
 *   - agent telemetry (task spans + tool-audit events),
 *   - the usage/interaction ledgers (AI calls + code-change deltas).
 * Every active human tenant member is surfaced as a contributor — those without
 * a git-derived contributors row get a synthetic (negative-id) entry so their
 * usage/interaction footprint is visible on the roster and heatmap.
 */
async function buildActivityCalendar(
  db: Db,
  tenantId: number,
  fromFloor: Date,
  toDate: Date,
  onlyId: number | null,
) {
  // 1. Git-derived contributors in scope (humans + agents).
  const contribConds = [eq(contributors.tenantId, tenantId), eq(contributors.isActive, true)];
  if (onlyId) contribConds.push(eq(contributors.id, onlyId));
  const people = await db.select().from(contributors).where(and(...contribConds));

  // Roster entry — a real contributor, a synthesised human member, or a synthesised
  // cloud agent (which has no contributors row — it lives in ide_agents).
  type Entry = {
    id: number;
    displayName: string;
    kind: 'human' | 'agent';
    avatarUrl: string | null;
    jobTitle: string | null;
    agentHostId: number | null;
    userId: string | null;
    cloudAgentRef: string | null;
  };
  const roster: Entry[] = people.map((p) => ({
    id: p.id,
    displayName: p.displayName,
    kind: (p.kind === 'agent' ? 'agent' : 'human'),
    avatarUrl: p.avatarUrl,
    jobTitle: p.jobTitle,
    agentHostId: p.agentHostId,
    userId: p.userId,
    cloudAgentRef: null,
  }));

  // 2. Surface every active human tenant member, even with no git activity — a
  //    teammate who only works through the product still belongs on the roster.
  //    Skip when scoped to a single contributor (server-side drill-down).
  if (!onlyId) {
    const coveredUserIds = new Set(roster.filter((r) => r.userId).map((r) => r.userId as string));
    const memberRows = await db
      .select({
        userId: tenantMembers.userId,
        displayName: users.displayName,
        username: users.username,
        email: users.email,
        avatarUrl: users.avatarUrl,
      })
      .from(tenantMembers)
      .innerJoin(users, eq(users.id, tenantMembers.userId))
      .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.isActive, true)));

    let synth = 0;
    for (const m of memberRows) {
      if (coveredUserIds.has(m.userId)) continue;
      coveredUserIds.add(m.userId);
      roster.push({
        id: -(++synth), // synthetic, stable within this response; used only as a key
        displayName: m.displayName || m.username || m.email,
        kind: 'human',
        avatarUrl: m.avatarUrl,
        jobTitle: null,
        agentHostId: null,
        userId: m.userId,
        cloudAgentRef: null,
      });
    }
  }

  // 3. Human git activity — daily aggregated metrics (activityScore = intensity),
  //    keyed by contributor id.
  const humanRows = await db
    .select({
      contributorId: contributorDailyMetrics.contributorId,
      date: contributorDailyMetrics.date,
      score: contributorDailyMetrics.activityScore,
    })
    .from(contributorDailyMetrics)
    .where(and(
      eq(contributorDailyMetrics.tenantId, tenantId),
      gte(contributorDailyMetrics.date, fromFloor),
      lte(contributorDailyMetrics.date, toDate),
    ));

  // 4. Agent activity — task spans + tool-audit events, grouped by agentHost + day.
  const spanRows = await db
    .select({
      agentHostId: telemetrySpans.agentHostId,
      day: sql<string>`to_char(date_trunc('day', ${telemetrySpans.ts}), 'YYYY-MM-DD')`,
      c: sql<number>`count(*)::int`,
    })
    .from(telemetrySpans)
    .where(and(
      eq(telemetrySpans.tenantId, tenantId),
      gte(telemetrySpans.ts, fromFloor),
      lte(telemetrySpans.ts, toDate),
      sql`${telemetrySpans.kind} like 'task.%'`,
    ))
    .groupBy(telemetrySpans.agentHostId, sql`date_trunc('day', ${telemetrySpans.ts})`);

  const toolRows = await db
    .select({
      agentHostId: toolAuditEvents.agentHostId,
      day: sql<string>`to_char(date_trunc('day', ${toolAuditEvents.ts}), 'YYYY-MM-DD')`,
      c: sql<number>`count(*)::int`,
    })
    .from(toolAuditEvents)
    .where(and(
      eq(toolAuditEvents.tenantId, tenantId),
      gte(toolAuditEvents.ts, fromFloor),
      lte(toolAuditEvents.ts, toDate),
    ))
    .groupBy(toolAuditEvents.agentHostId, sql`date_trunc('day', ${toolAuditEvents.ts})`);

  // 5. Usage/interaction ledgers (AI calls + code-change deltas).
  const interaction = await computeInteractionActivity(db, tenantId, fromFloor, toDate);

  // 5b. Surface cloud agents (ide_agents) that have AI usage but no contributors
  //     row — they're keyed by cloud_agent_ref, not agent_host_id. Synthesise an
  //     agent entry per used ref so a purely-cloud agent shows on the leaderboard.
  if (!onlyId && interaction.distinctCloudAgentRefs.size > 0) {
    const refs = [...interaction.distinctCloudAgentRefs];
    const agentRows = await db
      .select({ id: ideAgents.id, name: ideAgents.name })
      .from(ideAgents)
      .where(and(eq(ideAgents.tenantId, tenantId), inArray(ideAgents.id, refs)));
    const nameByRef = new Map(agentRows.map((r) => [r.id, r.name] as const));
    let cloudSynth = 0;
    for (const ref of refs) {
      roster.push({
        id: -(1_000_000 + (++cloudSynth)), // negative id space distinct from human synth
        displayName: nameByRef.get(ref) ?? ref,
        kind: 'agent',
        avatarUrl: null,
        jobTitle: null,
        agentHostId: null,
        userId: null,
        cloudAgentRef: ref,
      });
    }
  }

  // Index agent activity by agentHostId → (day → count): telemetry + AI usage.
  const agentByAgentHost = new Map<number, Map<string, number>>();
  const addAgent = (agentHostId: number | null, day: string, n: number) => {
    if (agentHostId == null) return;
    let m = agentByAgentHost.get(agentHostId);
    if (!m) { m = new Map(); agentByAgentHost.set(agentHostId, m); }
    m.set(day, (m.get(day) ?? 0) + n);
  };
  for (const r of spanRows) addAgent(r.agentHostId, r.day, Number(r.c));
  for (const r of toolRows) addAgent(r.agentHostId, r.day, Number(r.c));
  for (const [hostId, days] of interaction.agentDaysByHostId) {
    for (const [day, n] of days) addAgent(hostId, day, n);
  }

  // Index human activity by contributor id → (day → count): git intensity +
  // interaction counts (mapped from userId onto the roster entry).
  const humanByContributor = new Map<number, Map<string, number>>();
  const addHuman = (contributorId: number, day: string, n: number) => {
    let m = humanByContributor.get(contributorId);
    if (!m) { m = new Map(); humanByContributor.set(contributorId, m); }
    m.set(day, (m.get(day) ?? 0) + n);
  };
  for (const r of humanRows) addHuman(r.contributorId, fmtDay(r.date as Date), r.score ?? 0);

  const entryByUserId = new Map<string, number>();
  for (const r of roster) if (r.kind === 'human' && r.userId) entryByUserId.set(r.userId, r.id);
  for (const [userId, days] of interaction.humanDaysByUserId) {
    const cid = entryByUserId.get(userId);
    if (cid == null) continue; // author isn't a roster member (e.g. an agent ref)
    for (const [day, n] of days) addHuman(cid, day, n);
  }

  // 6. Build per-contributor day cells + a merged team calendar.
  //
  // Intensity is NORMALIZED PER KIND: an AI agent emits far more raw events
  // (tool calls / spans) per day than a human commits, so a single global max
  // would flatten every human cell to level 0-1 (a busy engineer reading as
  // "idle" beside an agent). We track a separate max for humans vs agents and
  // level each contributor's cells against its own kind's peak, and the merged
  // team calendar against a per-kind-normalized blend — so the heatmap reflects
  // "busy for a human" and "busy for an agent" on the same footing.
  const mergedHuman = new Map<string, number>();
  const mergedAgent = new Map<string, number>();
  let maxHuman = 0;
  let maxAgent = 0;

  const perContributor = roster.map((p) => {
    const map = p.kind === 'agent'
      ? (p.agentHostId != null
          ? (agentByAgentHost.get(p.agentHostId) ?? new Map<string, number>())
          : p.cloudAgentRef != null
            ? (interaction.cloudAgentDaysByRef.get(p.cloudAgentRef) ?? new Map<string, number>())
            : new Map<string, number>())
      : (humanByContributor.get(p.id) ?? new Map<string, number>());

    const isAgent = p.kind === 'agent';
    let total = 0;
    const days = [...map.entries()]
      .map(([date, count]) => {
        total += count;
        if (isAgent) {
          mergedAgent.set(date, (mergedAgent.get(date) ?? 0) + count);
          if (count > maxAgent) maxAgent = count;
        } else {
          mergedHuman.set(date, (mergedHuman.get(date) ?? 0) + count);
          if (count > maxHuman) maxHuman = count;
        }
        return { date, count };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      id: p.id,
      displayName: p.displayName,
      kind: p.kind,
      avatarUrl: p.avatarUrl,
      jobTitle: p.jobTitle,
      agentHostId: p.agentHostId,
      total,
      days: days.map((d) => ({ ...d, level: 0 })), // levels filled below (need per-kind max)
    };
  });

  // Second pass: assign intensity levels against the contributor's own kind max.
  for (const pc of perContributor) {
    const kindMax = pc.kind === 'agent' ? maxAgent : maxHuman;
    for (const d of pc.days) d.level = levelFor(d.count, kindMax);
  }

  // Merged team calendar: raw `count` (for the tooltip) but a per-kind-normalized
  // intensity so a heavy-human / light-agent day and a light-human / heavy-agent
  // day read comparably. `norm` ∈ [0,2] → levelled against 2.
  const mergedDates = new Set<string>([...mergedHuman.keys(), ...mergedAgent.keys()]);
  const calendar = [...mergedDates]
    .map((date) => {
      const h = mergedHuman.get(date) ?? 0;
      const a = mergedAgent.get(date) ?? 0;
      const norm = (maxHuman > 0 ? h / maxHuman : 0) + (maxAgent > 0 ? a / maxAgent : 0);
      return { date, count: h + a, humanCount: h, agentCount: a, level: levelFor(norm, 2) };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  perContributor.sort((a, b) => b.total - a.total);

  return {
    range: { from: fromFloor.toISOString(), to: toDate.toISOString() },
    // Back-compat scalar (the larger of the two peaks) + the per-kind maxima so a
    // client legend can label the two normalization scales.
    maxCount: Math.max(maxHuman, maxAgent),
    maxHuman,
    maxAgent,
    contributors: perContributor,
    calendar,
  };
}

export function createAnalyticsRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.use('*', authMiddleware);
  router.use('*', requireRole(TenantRole.MANAGER));

  // ── GET /api/analytics/activity-calendar ──────────────────────────────────
  // The whole-team contribution calendar: git/PR daily metrics + agent telemetry
  // + the usage/interaction ledgers (AI calls, code-change deltas), so a teammate
  // who works through the product (Brain/IDE/CLI/cloud) shows up even with zero
  // git activity. Every human tenant member is surfaced as a contributor so the
  // roster is the real team, not just those who landed a commit. Cached (120s)
  // since it fans out across several aggregate queries.
  router.get('/activity-calendar', async (c) => {
    const tenantId = c.get('tenantId') as number;

    const toParam = c.req.query('to');
    const fromParam = c.req.query('from');
    const toDate = toParam ? new Date(toParam) : new Date();
    const fromDate = fromParam ? new Date(fromParam) : new Date(toDate.getTime() - 364 * DAY_MS);
    const fromFloor = dayFloorUTC(fromDate);
    const onlyId = c.req.query('contributorId') ? Number(c.req.query('contributorId')) : null;

    const cacheKey =
      `activity-calendar:tenant:${tenantId}:from:${fmtDay(fromFloor)}:to:${fmtDay(dayFloorUTC(toDate))}:only:${onlyId ?? 'all'}`;
    const payload = await getOrSetCached(
      c.env as Env,
      cacheKey,
      () => buildActivityCalendar(db, tenantId, fromFloor, toDate, onlyId),
      { kvTtlSeconds: 120 },
    );
    return c.json(payload);
  });

  // ── GET /api/analytics/tenant-rollup ──────────────────────────────────────
  // Owner-facing cross-project activity rollup: volume by type/provider/repo, the
  // daily trend, and top contributors — rolled up to the whole tenant. Cached.
  router.get('/tenant-rollup', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const days = Math.min(365, Math.max(1, Number(c.req.query('days') ?? '30') || 30));
    const rollup = await getTenantActivityRollup(c.env as Env, db, tenantId, days);
    return c.json(rollup);
  });

  // ── POST /api/analytics/sync-agents ───────────────────────────────────────
  // Ensure every BuilderForce Agents instance has an agent contributor so its telemetry
  // shows up on the calendar alongside human teammates.
  router.post('/sync-agents', async (c) => {
    const tenantId = c.get('tenantId') as number;

    const hostRows = await db
      .select()
      .from(agentHosts)
      .where(eq(agentHosts.tenantId, tenantId));

    let created = 0;
    let updated = 0;
    for (const agentHost of hostRows) {
      const [existing] = await db
        .select({ id: contributors.id })
        .from(contributors)
        .where(and(eq(contributors.tenantId, tenantId), eq(contributors.agentHostId, agentHost.id)));

      if (existing) {
        await db
          .update(contributors)
          .set({ displayName: agentHost.name, isActive: agentHost.status === 'active', updatedAt: new Date() })
          .where(eq(contributors.id, existing.id));
        updated++;
      } else {
        // onConflictDoUpdate against the partial unique index (migration 0124)
        // so a concurrent sync that inserted the same (tenant, host) first just
        // updates instead of creating a duplicate — idempotent import [1557].
        await db.insert(contributors).values({
          tenantId,
          displayName: agentHost.name,
          kind: 'agent',
          agentHostId: agentHost.id,
          roleType: 'agent',
        }).onConflictDoUpdate({
          target: [contributors.tenantId, contributors.agentHostId],
          targetWhere: sql`${contributors.kind} = 'agent'`,
          set: { displayName: agentHost.name, isActive: agentHost.status === 'active', updatedAt: new Date() },
        });
        created++;
      }
    }

    return c.json({ created, updated, total: hostRows.length });
  });

  return router;
}
