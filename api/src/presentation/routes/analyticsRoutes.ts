/**
 * Analytics routes – /api/analytics
 *
 * Unified team-performance analytics that merge HUMAN contributors (git/PR
 * activity, already aggregated into contributor_daily_metrics) with AI AGENT
 * contributors (CoderClaw telemetry: task spans + tool-audit events). Agents are
 * first-class contributors (contributors.kind = 'agent', linked by claw_id), so
 * the activity calendar shows the whole team — people and claws — on one
 * GitHub-style heatmap.
 *
 * GET  /api/analytics/activity-calendar   365-day unified heatmap (MANAGER+)
 * POST /api/analytics/sync-agents         Upsert an agent contributor per claw (MANAGER+)
 */

import { Hono } from 'hono';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import {
  contributors,
  contributorDailyMetrics,
  telemetrySpans,
  toolAuditEvents,
  coderclawInstances,
} from '../../infrastructure/database/schema';
import { TenantRole } from '../../domain/shared/types';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

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

export function createAnalyticsRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.use('*', authMiddleware);
  router.use('*', requireRole(TenantRole.MANAGER));

  // ── GET /api/analytics/activity-calendar ──────────────────────────────────
  // Merges human daily metrics with agent telemetry into one per-contributor +
  // team-wide contribution calendar.
  router.get('/activity-calendar', async (c) => {
    const tenantId = c.get('tenantId') as number;

    const toParam = c.req.query('to');
    const fromParam = c.req.query('from');
    const toDate = toParam ? new Date(toParam) : new Date();
    const fromDate = fromParam ? new Date(fromParam) : new Date(toDate.getTime() - 364 * DAY_MS);
    const fromFloor = dayFloorUTC(fromDate);
    const onlyId = c.req.query('contributorId') ? Number(c.req.query('contributorId')) : null;

    // 1. Contributors in scope (humans + agents).
    const contribConds = [eq(contributors.tenantId, tenantId), eq(contributors.isActive, true)];
    if (onlyId) contribConds.push(eq(contributors.id, onlyId));
    const people = await db.select().from(contributors).where(and(...contribConds));

    // 2. Human activity — daily aggregated metrics (activityScore = intensity).
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

    // 3. Agent activity — task spans + tool-audit events, grouped by claw + day.
    const spanRows = await db
      .select({
        clawId: telemetrySpans.clawId,
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
      .groupBy(telemetrySpans.clawId, sql`date_trunc('day', ${telemetrySpans.ts})`);

    const toolRows = await db
      .select({
        clawId: toolAuditEvents.clawId,
        day: sql<string>`to_char(date_trunc('day', ${toolAuditEvents.ts}), 'YYYY-MM-DD')`,
        c: sql<number>`count(*)::int`,
      })
      .from(toolAuditEvents)
      .where(and(
        eq(toolAuditEvents.tenantId, tenantId),
        gte(toolAuditEvents.ts, fromFloor),
        lte(toolAuditEvents.ts, toDate),
      ))
      .groupBy(toolAuditEvents.clawId, sql`date_trunc('day', ${toolAuditEvents.ts})`);

    // Index agent activity by clawId → (day → count).
    const agentByClaw = new Map<number, Map<string, number>>();
    const addAgent = (clawId: number | null, day: string, n: number) => {
      if (clawId == null) return;
      let m = agentByClaw.get(clawId);
      if (!m) { m = new Map(); agentByClaw.set(clawId, m); }
      m.set(day, (m.get(day) ?? 0) + n);
    };
    for (const r of spanRows) addAgent(r.clawId, r.day, Number(r.c));
    for (const r of toolRows) addAgent(r.clawId, r.day, Number(r.c));

    // Index human activity by contributorId → (day → score).
    const humanByContributor = new Map<number, Map<string, number>>();
    for (const r of humanRows) {
      let m = humanByContributor.get(r.contributorId);
      if (!m) { m = new Map(); humanByContributor.set(r.contributorId, m); }
      const day = fmtDay(r.date as Date);
      m.set(day, (m.get(day) ?? 0) + (r.score ?? 0));
    }

    // 4. Build per-contributor day cells + a merged team calendar.
    const merged = new Map<string, number>();
    let maxCount = 0;

    const perContributor = people.map((p) => {
      const map = p.kind === 'agent' && p.clawId != null
        ? (agentByClaw.get(p.clawId) ?? new Map<string, number>())
        : (humanByContributor.get(p.id) ?? new Map<string, number>());

      let total = 0;
      const days = [...map.entries()]
        .map(([date, count]) => {
          total += count;
          merged.set(date, (merged.get(date) ?? 0) + count);
          if (count > maxCount) maxCount = count;
          return { date, count };
        })
        .sort((a, b) => a.date.localeCompare(b.date));

      return {
        id: p.id,
        displayName: p.displayName,
        kind: p.kind,
        avatarUrl: p.avatarUrl,
        jobTitle: p.jobTitle,
        clawId: p.clawId,
        total,
        days: days.map((d) => ({ ...d, level: 0 })), // levels filled below (need maxCount)
      };
    });

    // Second pass: assign intensity levels now that maxCount is known.
    for (const pc of perContributor) {
      for (const d of pc.days) d.level = levelFor(d.count, maxCount);
    }
    const calendar = [...merged.entries()]
      .map(([date, count]) => ({ date, count, level: levelFor(count, maxCount) }))
      .sort((a, b) => a.date.localeCompare(b.date));

    perContributor.sort((a, b) => b.total - a.total);

    return c.json({
      range: { from: fromFloor.toISOString(), to: toDate.toISOString() },
      maxCount,
      contributors: perContributor,
      calendar,
    });
  });

  // ── POST /api/analytics/sync-agents ───────────────────────────────────────
  // Ensure every CoderClaw instance has an agent contributor so its telemetry
  // shows up on the calendar alongside human teammates.
  router.post('/sync-agents', async (c) => {
    const tenantId = c.get('tenantId') as number;

    const claws = await db
      .select()
      .from(coderclawInstances)
      .where(eq(coderclawInstances.tenantId, tenantId));

    let created = 0;
    let updated = 0;
    for (const claw of claws) {
      const [existing] = await db
        .select({ id: contributors.id })
        .from(contributors)
        .where(and(eq(contributors.tenantId, tenantId), eq(contributors.clawId, claw.id)));

      if (existing) {
        await db
          .update(contributors)
          .set({ displayName: claw.name, isActive: claw.status === 'active', updatedAt: new Date() })
          .where(eq(contributors.id, existing.id));
        updated++;
      } else {
        await db.insert(contributors).values({
          tenantId,
          displayName: claw.name,
          kind: 'agent',
          clawId: claw.id,
          roleType: 'agent',
        });
        created++;
      }
    }

    return c.json({ created, updated, total: claws.length });
  });

  return router;
}
