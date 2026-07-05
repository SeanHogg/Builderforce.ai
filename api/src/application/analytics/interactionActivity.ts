/**
 * Interaction activity — the "usage & interactions" half of team analytics.
 *
 * The contributor calendar and tenant rollup were originally git/PR-only: they
 * read activity_events + contributor_daily_metrics (commits/PRs/issues) and agent
 * OTel spans. But a teammate who works through the product — Brain chats, IDE/CLI
 * turns, cloud runs — produces NO git event; their footprint lives in the usage
 * ledgers instead:
 *   - llm_usage_log : one row per AI call, attributed by userId (human) or
 *     agentHostId (on-prem agent), plus projectId.
 *   - work_deltas   : one row per chat turn that changed code, attributed by
 *     createdBy (userId or agent ref) + projectId + modality.
 *
 * This module rolls both ledgers into per-actor / per-day / per-project counts so
 * the calendar heatmap, the leaderboard, and the owner rollup reflect real usage
 * — not just what landed in a connected repo. Pure aggregation (no cache); the
 * callers own their own caching.
 */
import { and, eq, gte, isNotNull, lte, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { llmUsageLog, workDeltas } from '../../infrastructure/database/schema';

/** `to_char(date_trunc('day', col), 'YYYY-MM-DD')` — UTC day bucket. */
function dayCol(col: unknown) {
  return sql<string>`to_char(date_trunc('day', ${col}), 'YYYY-MM-DD')`;
}
function dayTrunc(col: unknown) {
  return sql`date_trunc('day', ${col})`;
}

export interface InteractionActivity {
  /** userId → (day → interaction count). Feeds the human side of the calendar. */
  humanDaysByUserId: Map<string, Map<string, number>>;
  /** agentHostId → (day → interaction count). Feeds the agent side of the calendar. */
  agentDaysByHostId: Map<number, Map<string, number>>;
  /** userId → total interactions (leaderboard / top contributors). */
  humanTotalsByUserId: Map<string, number>;
  /** agentHostId → total interactions. */
  agentTotalsByHostId: Map<number, number>;
  /** Distinct human actors with AI usage in-window (active-contributor count). */
  distinctHumanUserIds: Set<string>;
  /** Distinct on-prem agent actors with AI usage in-window. */
  distinctAgentHostIds: Set<number>;
  /** day → total interaction count (AI calls + code-change deltas). */
  daily: Map<string, number>;
  /** projectId → interaction count (cross-project attribution). */
  byProject: Map<number, number>;
  /** Bucketed interaction volume for the rollup "by type" panel. */
  byType: { ai_interaction: number; code_change: number };
  /** All interactions in-window (AI calls + code-change deltas). */
  totalEvents: number;
}

function addDay(map: Map<string, Map<string, number>> | Map<number, Map<string, number>>, key: string | number, day: string, n: number) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = map as Map<any, Map<string, number>>;
  let inner = m.get(key);
  if (!inner) { inner = new Map(); m.set(key, inner); }
  inner.set(day, (inner.get(day) ?? 0) + n);
}
function addTotal(map: Map<string, number> | Map<number, number>, key: string | number, n: number) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = map as Map<any, number>;
  m.set(key, (m.get(key) ?? 0) + n);
}

/**
 * Aggregate llm_usage_log + work_deltas for a tenant over [from, to] into the
 * per-actor / per-day / per-project shapes the calendar and rollup consume.
 */
export async function computeInteractionActivity(db: Db, tenantId: number, from: Date, to: Date): Promise<InteractionActivity> {
  const llmScope = and(eq(llmUsageLog.tenantId, tenantId), gte(llmUsageLog.createdAt, from), lte(llmUsageLog.createdAt, to));
  const deltaScope = and(eq(workDeltas.tenantId, tenantId), gte(workDeltas.createdAt, from), lte(workDeltas.createdAt, to));

  const [
    llmUserRows, llmHostRows, llmProjRows, llmDailyRows,
    deltaUserRows, deltaProjRows, deltaDailyRows,
  ] = await Promise.all([
    // AI usage by human user + day.
    db.select({ userId: llmUsageLog.userId, day: dayCol(llmUsageLog.createdAt), c: sql<number>`count(*)::int` })
      .from(llmUsageLog).where(and(llmScope, isNotNull(llmUsageLog.userId)))
      .groupBy(llmUsageLog.userId, dayTrunc(llmUsageLog.createdAt)),
    // AI usage by on-prem agent host + day.
    db.select({ hostId: llmUsageLog.agentHostId, day: dayCol(llmUsageLog.createdAt), c: sql<number>`count(*)::int` })
      .from(llmUsageLog).where(and(llmScope, isNotNull(llmUsageLog.agentHostId)))
      .groupBy(llmUsageLog.agentHostId, dayTrunc(llmUsageLog.createdAt)),
    // AI usage by project.
    db.select({ projectId: llmUsageLog.projectId, c: sql<number>`count(*)::int` })
      .from(llmUsageLog).where(and(llmScope, isNotNull(llmUsageLog.projectId)))
      .groupBy(llmUsageLog.projectId),
    // AI usage total-by-day (all rows, incl. gateway calls with no actor).
    db.select({ day: dayCol(llmUsageLog.createdAt), c: sql<number>`count(*)::int` })
      .from(llmUsageLog).where(llmScope).groupBy(dayTrunc(llmUsageLog.createdAt)),
    // Code-change interactions by author + day.
    db.select({ by: workDeltas.createdBy, day: dayCol(workDeltas.createdAt), c: sql<number>`count(*)::int` })
      .from(workDeltas).where(and(deltaScope, isNotNull(workDeltas.createdBy)))
      .groupBy(workDeltas.createdBy, dayTrunc(workDeltas.createdAt)),
    // Code-change interactions by project.
    db.select({ projectId: workDeltas.projectId, c: sql<number>`count(*)::int` })
      .from(workDeltas).where(and(deltaScope, isNotNull(workDeltas.projectId)))
      .groupBy(workDeltas.projectId),
    // Code-change interactions total-by-day.
    db.select({ day: dayCol(workDeltas.createdAt), c: sql<number>`count(*)::int` })
      .from(workDeltas).where(deltaScope).groupBy(dayTrunc(workDeltas.createdAt)),
  ]);

  const humanDaysByUserId = new Map<string, Map<string, number>>();
  const agentDaysByHostId = new Map<number, Map<string, number>>();
  const humanTotalsByUserId = new Map<string, number>();
  const agentTotalsByHostId = new Map<number, number>();
  const distinctHumanUserIds = new Set<string>();
  const distinctAgentHostIds = new Set<number>();
  const byProject = new Map<number, number>();

  for (const r of llmUserRows) {
    const uid = r.userId as string; const n = Number(r.c);
    addDay(humanDaysByUserId, uid, r.day, n);
    addTotal(humanTotalsByUserId, uid, n);
    distinctHumanUserIds.add(uid); // llm_usage_log.userId is a real FK → reliable human actor
  }
  for (const r of llmHostRows) {
    const hid = r.hostId as number; const n = Number(r.c);
    addDay(agentDaysByHostId, hid, r.day, n);
    addTotal(agentTotalsByHostId, hid, n);
    distinctAgentHostIds.add(hid);
  }
  // Code-change deltas fold into human attribution when createdBy is a userId.
  // (An agent-ref createdBy simply won't match a contributor downstream — it's
  // dropped from the human calendar rather than mis-counted as a person.)
  for (const r of deltaUserRows) {
    const by = r.by as string; const n = Number(r.c);
    addDay(humanDaysByUserId, by, r.day, n);
    addTotal(humanTotalsByUserId, by, n);
  }
  for (const r of llmProjRows) addTotal(byProject, r.projectId as number, Number(r.c));
  for (const r of deltaProjRows) addTotal(byProject, r.projectId as number, Number(r.c));

  const daily = new Map<string, number>();
  let aiInteractions = 0;
  let codeChanges = 0;
  for (const r of llmDailyRows) { const n = Number(r.c); daily.set(r.day, (daily.get(r.day) ?? 0) + n); aiInteractions += n; }
  for (const r of deltaDailyRows) { const n = Number(r.c); daily.set(r.day, (daily.get(r.day) ?? 0) + n); codeChanges += n; }

  return {
    humanDaysByUserId,
    agentDaysByHostId,
    humanTotalsByUserId,
    agentTotalsByHostId,
    distinctHumanUserIds,
    distinctAgentHostIds,
    daily,
    byProject,
    byType: { ai_interaction: aiInteractions, code_change: codeChanges },
    totalEvents: aiInteractions + codeChanges,
  };
}
