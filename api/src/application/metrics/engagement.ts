/**
 * Unified engagement scoring (slice 3) — gauges how engaged each human teammate
 * is by folding EVERY signal we already capture into one score, instead of the
 * task-only board behaviour that {@link ./workforceMetrics} measures:
 *
 *   - external dev activity — commits / PRs / issues from connected repos & boards
 *     (activity_events), attributed to the person via the contributor↔user link
 *     (contributors.user_id, the link the merge flow maintains);
 *   - platform usage — actions taken in Builderforce itself (audit_events);
 *   - tooling presence — a live VS Code extension connection (vscode_connections);
 *   - delivery — tasks the person completed in the window (tasks).
 *
 * One pure scorer ({@link scoreEngagement}) so the weighting is unit-testable.
 * The DB fetch ({@link computeTenantEngagement}) lists every active human member
 * — including people who are engaged but carry no assigned tasks (whom the
 * task-only scorecard misses entirely).
 */
import { and, eq, gte, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { readWorkforceMetricsVersion } from './workforceMetrics';
import {
  activityEvents,
  auditEvents,
  contributors,
  projects,
  tasks,
  tenantMembers,
  users,
  vscodeConnections,
} from '../../infrastructure/database/schema';

const HOUR_MS = 3_600_000;
const clamp = (n: number) => Math.max(0, Math.min(100, n));

export interface EngagementSignals {
  /** External dev activity events (commits/PRs/issues) attributed to this person. */
  activityEvents: number;
  /** In-product actions (audit_events). */
  platformActions: number;
  /** A VS Code extension was seen connected within the window. */
  vscodeActive: boolean;
  /** Tasks completed in the window. */
  completedTasks: number;
}

export type EngagementLevel = 'inactive' | 'low' | 'moderate' | 'high' | 'very_high';

export interface EngagementBreakdown {
  activityPts: number;
  platformPts: number;
  toolingPts: number;
  deliveryPts: number;
}

export interface EngagementScore {
  score: number;       // 0..100 composite
  level: EngagementLevel;
  breakdown: EngagementBreakdown;
}

/**
 * Pure composite. Each signal contributes up to a capped ceiling so no single
 * dimension dominates; the caps sum to 100. Weights documented inline.
 */
export function scoreEngagement(s: EngagementSignals): EngagementScore {
  const activityPts = Math.min(40, s.activityEvents * 2);   // dev activity is the strongest signal — up to 40
  const platformPts = Math.min(25, s.platformActions * 0.5); // in-product usage — up to 25
  const toolingPts = s.vscodeActive ? 20 : 0;                // live editor connection — 20
  const deliveryPts = Math.min(15, s.completedTasks * 3);    // shipped work — up to 15
  const score = clamp(activityPts + platformPts + toolingPts + deliveryPts);
  const level: EngagementLevel =
    score <= 0 ? 'inactive' : score < 25 ? 'low' : score < 50 ? 'moderate' : score < 75 ? 'high' : 'very_high';
  return { score, level, breakdown: { activityPts, platformPts, toolingPts, deliveryPts } };
}

export interface MemberEngagement extends EngagementScore {
  userId: string;
  displayName: string;
  role: string;
  signals: EngagementSignals;
  lastVscodeSeenAt: string | null;
}

export async function computeTenantEngagement(db: Db, tenantId: number, days: number): Promise<MemberEngagement[]> {
  const since = new Date(Date.now() - days * 24 * HOUR_MS);

  // Every active human member (the population — including the task-less but
  // otherwise-engaged, whom the task scorecard never lists).
  const members = await db
    .select({ userId: tenantMembers.userId, role: tenantMembers.role, displayName: users.displayName, email: users.email })
    .from(tenantMembers)
    .innerJoin(users, eq(users.id, tenantMembers.userId))
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.isActive, true)));
  if (members.length === 0) return [];

  // External dev activity per linked user (activity_events → contributors.user_id).
  const activityRows = await db
    .select({ userId: contributors.userId, c: sql<number>`count(*)::int` })
    .from(activityEvents)
    .innerJoin(contributors, eq(contributors.id, activityEvents.contributorId))
    .where(and(eq(activityEvents.tenantId, tenantId), gte(activityEvents.occurredAt, since), isNotNull(contributors.userId)))
    .groupBy(contributors.userId);

  // Platform actions per user (audit_events).
  const auditRows = await db
    .select({ userId: auditEvents.userId, c: sql<number>`count(*)::int` })
    .from(auditEvents)
    .where(and(eq(auditEvents.tenantId, tenantId), isNotNull(auditEvents.userId), gte(auditEvents.createdAt, since)))
    .groupBy(auditEvents.userId);

  // VS Code presence per user (most-recent heartbeat).
  const vscodeRows = await db
    .select({ userId: vscodeConnections.userId, lastSeenAt: sql<Date>`max(${vscodeConnections.lastSeenAt})` })
    .from(vscodeConnections)
    .where(and(eq(vscodeConnections.tenantId, tenantId), isNotNull(vscodeConnections.userId)))
    .groupBy(vscodeConnections.userId);

  // Tasks completed per user in the window (tasks carry no tenant_id → scope via projects).
  const completedRows = await db
    .select({ userId: tasks.assignedUserId, c: sql<number>`count(*)::int` })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(projects.tenantId, tenantId), isNotNull(tasks.assignedUserId), isNotNull(tasks.completedAt), gte(tasks.completedAt, since)))
    .groupBy(tasks.assignedUserId);

  const activityBy = new Map(activityRows.map((r) => [r.userId, Number(r.c)]));
  const auditBy = new Map(auditRows.map((r) => [r.userId, Number(r.c)]));
  const vscodeBy = new Map(vscodeRows.map((r) => [r.userId, r.lastSeenAt ? new Date(r.lastSeenAt) : null]));
  const completedBy = new Map(completedRows.map((r) => [r.userId, Number(r.c)]));

  const out = members.map((m) => {
    const lastSeen = vscodeBy.get(m.userId) ?? null;
    const signals: EngagementSignals = {
      activityEvents: activityBy.get(m.userId) ?? 0,
      platformActions: auditBy.get(m.userId) ?? 0,
      vscodeActive: lastSeen != null && lastSeen.getTime() >= since.getTime(),
      completedTasks: completedBy.get(m.userId) ?? 0,
    };
    const scored = scoreEngagement(signals);
    return {
      userId: m.userId,
      displayName: m.displayName || m.email || m.userId,
      role: m.role,
      signals,
      lastVscodeSeenAt: lastSeen ? lastSeen.toISOString() : null,
      ...scored,
    } satisfies MemberEngagement;
  });

  // Most engaged first; stable name tiebreak.
  return out.sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName));
}

/** Cached read-through. Reuses the workforce-metrics version token (engagement
 *  shares the task/merge write paths that bump it); 5-min KV TTL backstop. */
export async function getTenantEngagement(env: Env, db: Db, tenantId: number, days: number): Promise<MemberEngagement[]> {
  const version = await readWorkforceMetricsVersion(env, tenantId);
  return getOrSetCached(env, `engagement:tenant:${tenantId}:v:${version}:days:${days}`, () => computeTenantEngagement(db, tenantId, days), { kvTtlSeconds: 300 });
}
