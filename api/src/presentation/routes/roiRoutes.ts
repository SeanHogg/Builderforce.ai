/**
 * Feature/portfolio ROI rollup — /api/roi/*
 *
 * "$ spent → time & cost" with NO new storage and NO per-task cost column. The
 * rollup is composed live from sources that already exist:
 *   - time:  tasks.completed_at + the task_status_transitions log (0117)
 *   - spend: sprints.runway_budget/actual_burn, llm_usage_log per-project cost
 *            (0103/0104), and cost_calculations (the segment cost model)
 *   - roi:   feature_roi pass-through
 *
 * `?project=<id>` scopes to one project; omit it for the segment-wide portfolio
 * (which also returns a per-project breakdown). Cached via a tenant ROI version
 * token bumped by task status changes and by sprint/cost/feature-roi writes
 * (see segmentTrackerRoutes bumpVersionKeys + taskRoutes PATCH).
 */

import { Hono } from 'hono';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import { getOrSetCached, getCacheVersion } from '../../infrastructure/cache/readThroughCache';
import {
  tasks, projects, sprints, costCalculations, featureRoi, llmUsageLog,
} from '../../infrastructure/database/schema';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { scope } from './segmentTrackerRoutes';

const MILLICENTS_PER_USD = 100_000;
const HOUR_MS = 3_600_000;
const WEEK_MS = 7 * 24 * HOUR_MS;

interface RoiRollup {
  scope: { projectId: number | null };
  time: { completedCount: number; avgCycleTimeHours: number; throughputPerWeek: number };
  spend: { sprintRunwayBudget: number; sprintActualBurn: number; agentLlmCostUsd: number; costModelTotal: number };
  roi: Array<Record<string, unknown>>;
  byProject: Array<{ projectId: number; projectName: string; completedCount: number; agentLlmCostUsd: number }>;
  byTask: Array<{ taskId: number; taskKey: string; title: string; agentLlmCostUsd: number }>;
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function computeRollup(
  db: Db,
  tenantId: number,
  segmentId: string,
  projectId: number | undefined,
  now: number,
): Promise<RoiRollup> {
  // ── tasks in scope (segment-bounded; optional single project) ──────────────
  const taskConds = [eq(projects.tenantId, tenantId), eq(projects.segmentId, segmentId)];
  if (projectId !== undefined) taskConds.push(eq(tasks.projectId, projectId));
  const taskRows = await db
    .select({
      id: tasks.id,
      createdAt: tasks.createdAt,
      completedAt: tasks.completedAt,
      sprintId: tasks.sprintId,
      projectId: tasks.projectId,
      projectName: projects.name,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(...taskConds));

  const completed = taskRows.filter((t) => t.completedAt != null);
  const completedCount = completed.length;
  const throughputPerWeek = completed.filter(
    (t) => t.completedAt != null && now - new Date(t.completedAt).getTime() <= WEEK_MS,
  ).length;

  // ── cycle time: created_at → completed_at ──────────────────────────────────
  // Same definition as the workforce scorecards + DORA lead time
  // (workforceMetrics.scoreMembers / rollupDora) — board-lane-agnostic, so it
  // works regardless of free-form status keys. No transition-log query needed.
  const durations = completed
    .map((t) => (new Date(t.completedAt!).getTime() - new Date(t.createdAt).getTime()) / HOUR_MS)
    .filter((h) => h >= 0);
  const avgCycleTimeHours = durations.length
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : 0;

  // ── sprint spend (project: sprints touched by its tasks; portfolio: all) ────
  const sprintConds = [eq(sprints.tenantId, tenantId), eq(sprints.segmentId, segmentId)];
  if (projectId !== undefined) {
    const sprintIds = [...new Set(taskRows.map((t) => t.sprintId).filter((s): s is string => !!s))];
    if (sprintIds.length) sprintConds.push(inArray(sprints.id, sprintIds));
    else sprintConds.push(sql`false`); // no sprints touched → zero spend
  }
  const [sprintAgg] = await db
    .select({
      runway: sql<string>`coalesce(sum(${sprints.runwayBudget}),0)`,
      burn: sql<string>`coalesce(sum(${sprints.actualBurn}),0)`,
    })
    .from(sprints)
    .where(and(...sprintConds));

  // ── agent LLM spend (already attributed per project, 0103/0104) ────────────
  const llmConds = [eq(llmUsageLog.tenantId, tenantId)];
  if (projectId !== undefined) llmConds.push(eq(llmUsageLog.projectId, projectId));
  const [llmAgg] = await db
    .select({ millicents: sql<string>`coalesce(sum(${llmUsageLog.costUsdMillicents}),0)` })
    .from(llmUsageLog)
    .where(and(...llmConds));

  // ── segment cost model ─────────────────────────────────────────────────────
  const [costAgg] = await db
    .select({ total: sql<string>`coalesce(sum(${costCalculations.totalCost}),0)` })
    .from(costCalculations)
    .where(and(eq(costCalculations.tenantId, tenantId), eq(costCalculations.segmentId, segmentId)));

  // ── per-task agent spend (the real per-task dollar — llm_usage_log.task_id,
  //    0104). Top spenders in scope; innerJoin tasks drops web/SDK (null task). ──
  const taskCostConds = [eq(llmUsageLog.tenantId, tenantId)];
  if (projectId !== undefined) taskCostConds.push(eq(llmUsageLog.projectId, projectId));
  const taskCostRows = await db
    .select({
      taskId: llmUsageLog.taskId,
      taskKey: tasks.key,
      title: tasks.title,
      millicents: sql<string>`coalesce(sum(${llmUsageLog.costUsdMillicents}),0)`,
    })
    .from(llmUsageLog)
    .innerJoin(tasks, eq(tasks.id, llmUsageLog.taskId))
    .where(and(...taskCostConds))
    .groupBy(llmUsageLog.taskId, tasks.key, tasks.title)
    .orderBy(desc(sql`coalesce(sum(${llmUsageLog.costUsdMillicents}),0)`))
    .limit(10);
  const byTask = taskCostRows.map((r) => ({
    taskId: r.taskId as number,
    taskKey: r.taskKey ?? '',
    title: r.title ?? '',
    agentLlmCostUsd: num(r.millicents) / MILLICENTS_PER_USD,
  }));

  // ── feature ROI tracking list (segment-level) ──────────────────────────────
  const roi = await db
    .select()
    .from(featureRoi)
    .where(and(eq(featureRoi.tenantId, tenantId), eq(featureRoi.segmentId, segmentId)));

  // ── per-project breakdown (portfolio only) ─────────────────────────────────
  let byProject: RoiRollup['byProject'] = [];
  if (projectId === undefined) {
    const llmByProject = await db
      .select({
        projectId: llmUsageLog.projectId,
        millicents: sql<string>`coalesce(sum(${llmUsageLog.costUsdMillicents}),0)`,
      })
      .from(llmUsageLog)
      .where(eq(llmUsageLog.tenantId, tenantId))
      .groupBy(llmUsageLog.projectId);
    const llmCostByProject = new Map(
      llmByProject
        .filter((r) => r.projectId != null)
        .map((r) => [r.projectId as number, num(r.millicents) / MILLICENTS_PER_USD]),
    );
    const agg = new Map<number, { projectName: string; completedCount: number }>();
    for (const t of taskRows) {
      const entry = agg.get(t.projectId) ?? { projectName: t.projectName ?? `Project ${t.projectId}`, completedCount: 0 };
      if (t.completedAt != null) entry.completedCount += 1;
      agg.set(t.projectId, entry);
    }
    byProject = [...agg.entries()].map(([pid, v]) => ({
      projectId: pid,
      projectName: v.projectName,
      completedCount: v.completedCount,
      agentLlmCostUsd: llmCostByProject.get(pid) ?? 0,
    }));
  }

  return {
    scope: { projectId: projectId ?? null },
    time: { completedCount, avgCycleTimeHours, throughputPerWeek },
    spend: {
      sprintRunwayBudget: num(sprintAgg?.runway),
      sprintActualBurn: num(sprintAgg?.burn),
      agentLlmCostUsd: num(llmAgg?.millicents) / MILLICENTS_PER_USD,
      costModelTotal: num(costAgg?.total),
    },
    roi,
    byProject,
    byTask,
  };
}

export function createRoiRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // GET /api/roi/rollup?project=<id?>
  router.get('/rollup', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const raw = c.req.query('project');
    const parsed = raw == null ? undefined : Number(raw);
    const projectId = parsed !== undefined && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;

    const env = c.env as Env;
    const ver = await getCacheVersion(env, `roi-version:tenant:${tenantId}`);
    const key = `roi:t:${tenantId}:s:${segmentId}:scope:${projectId ?? 'all'}:v:${ver}`;
    // Structural writes (task status / sprint / cost / feature-roi) bump the
    // version token for immediate invalidation. Agent LLM spend is written on the
    // hot metering path (usageLedger) — far too frequent to version-bump — so a
    // short TTL keeps the spend figure fresh (≤60s lag) without cache thrash.
    const rollup = await getOrSetCached(
      env, key,
      () => computeRollup(db, tenantId, segmentId, projectId, Date.now()),
      { kvTtlSeconds: 60, l1TtlMs: 15_000 },
    );
    return c.json(rollup);
  });

  return router;
}
