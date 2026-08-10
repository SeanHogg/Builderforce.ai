/**
 * EMP feature lenses — additional routers mounted on /api/insights.
 *
 * Kept in one NEW module (mounted alongside the other insight lenses; Hono merges
 * routers on the shared prefix, each carrying its own authMiddleware) so the shared
 * insightsRoutes.ts is untouched:
 *
 *   GET    /benchmarking/cross-team   EMP-5  internal cross-team percentile   [manager, cached]
 *   GET    /delay-taxonomy            EMP-9  delay root-cause distribution     [manager, cached]
 *   POST   /delay-taxonomy            EMP-9  tag a task's delay reason         [developer]
 *   DELETE /delay-taxonomy/:taskId    EMP-9  clear a task's delay reason       [developer]
 *   GET    /export?dataset=&format=   EMP-20 CSV / printable-HTML export       [manager]
 */

import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { scope } from './segmentTrackerRoutes';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { delayReasons } from '../../infrastructure/database/schema';
import { computeCrossTeamBenchmark } from '../../application/insights/crossTeamBenchmark';
import { computeDelayTaxonomy, isDelayReason } from '../../application/insights/delayTaxonomy';
import { computeDora } from '../../application/metrics/workforceMetrics';
import { computeFinanceInsights } from '../../application/insights/financeInsights';
import { computeAllocationInsights } from '../../application/insights/allocationInsights';
import { computeBenchmarking } from '../../application/insights/benchmarkingInsights';
import { toCsv, toHtmlTable, exportContentMeta, type ExportRow } from '../../application/export/tabularExport';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const SHORT_TTL = { kvTtlSeconds: 60, l1TtlMs: 15_000 };

function parseDays(raw: string | undefined, def = 30): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 365 ? Math.floor(n) : def;
}

function parseProjectId(raw: string | undefined): number | undefined {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** Read a userId off the Hono context (set by authMiddleware) without a cast dance. */
function userIdOf(c: unknown): string | null {
  return (c as { get(k: string): string | undefined }).get('userId') ?? null;
}

/** The exportable insight datasets → a flat row set. Kept small + explicit so the
 *  export surface is auditable (no arbitrary passthrough). */
const EXPORT_DATASETS = ['dora', 'finance', 'allocation', 'benchmarking'] as const;
type ExportDataset = (typeof EXPORT_DATASETS)[number];
function isExportDataset(x: string): x is ExportDataset {
  return (EXPORT_DATASETS as readonly string[]).includes(x);
}

async function buildDatasetRows(db: Db, dataset: ExportDataset, tenantId: number, segmentId: string, days: number, projectId?: number): Promise<ExportRow[]> {
  const now = Date.now();
  switch (dataset) {
    case 'dora': {
      const dora = await computeDora(db, tenantId, days, projectId);
      return dora.series.map((s) => ({
        week: s.bucketStart,
        deploy_freq_per_day: s.deploymentFrequencyPerDay,
        total_deployments: s.totalDeployments,
        lead_time_hours: s.leadTimeHours,
        change_failure_rate_pct: s.changeFailureRatePct,
        mttr_hours: s.mttrHours,
      }));
    }
    case 'finance': {
      const period = `${new Date(now).getUTCFullYear()}-${String(new Date(now).getUTCMonth() + 1).padStart(2, '0')}`;
      const fin = await computeFinanceInsights(db, tenantId, segmentId, period, now);
      return fin.byProject
        .filter((p) => projectId == null || p.projectId === projectId)
        .map((p) => ({ project: p.projectName, project_id: p.projectId, spend_usd: p.usd }));
    }
    case 'allocation': {
      const alloc = await computeAllocationInsights(db, tenantId, days, now, { projectId });
      return alloc.byCategory.map((b) => ({
        category: b.category, label: b.label, hours: b.hours, pct: b.pct,
        task_count: b.taskCount, cost_usd: b.costUsd, capex_usd: b.capexUsd, opex_usd: b.opexUsd,
      }));
    }
    case 'benchmarking': {
      const bench = await computeBenchmarking(db, tenantId, days, projectId);
      return bench.metrics.map((m) => ({
        metric: m.metric, label: m.label, value: m.value, unit: m.unit,
        percentile: m.percentile, rating: m.rating, p50: m.p50, p90: m.p90,
      }));
    }
  }
}

export function createEmpFeatureRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // EMP-5 — internal cross-team benchmarking (manager, cached per tenant+window).
  router.get('/benchmarking/cross-team', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const days = parseDays(c.req.query('days'));
    const projectId = parseProjectId(c.req.query('projectId'));
    const env = c.env as Env;
    const key = `insights:xteam:t:${tenantId}:d:${days}:p:${projectId ?? 0}`;
    return c.json(await getOrSetCached(env, key, () => computeCrossTeamBenchmark(db, tenantId, days, projectId), SHORT_TTL));
  });

  // EMP-9 — delay root-cause distribution (manager, cached). Tag writes below bump
  // the cache indirectly by keying on a short TTL (the read is a rollup over hot
  // transition + tag tables; the short TTL keeps it fresh without a version token).
  router.get('/delay-taxonomy', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const days = parseDays(c.req.query('days'), 90);
    const projectId = parseProjectId(c.req.query('projectId'));
    const env = c.env as Env;
    const key = `insights:delaytax:t:${tenantId}:d:${days}:p:${projectId ?? 0}`;
    return c.json(await getOrSetCached(env, key, () => computeDelayTaxonomy(db, tenantId, days, projectId), SHORT_TTL));
  });

  // Tag a task's delay reason (developer+ — the same audience that works the board).
  // Upserts on the per-task unique index so re-tagging replaces.
  router.post('/delay-taxonomy', requireRole(TenantRole.DEVELOPER), async (c) => {
    const { tenantId } = scope(c);
    type Body = { taskId?: number; reasonCode?: string; notes?: string };
    const body = await c.req.json<Body>().catch(() => ({} as Body));
    const taskId = Number(body.taskId);
    if (!Number.isInteger(taskId) || taskId <= 0) return c.json({ error: 'taskId is required' }, 400);
    if (!isDelayReason(body.reasonCode)) return c.json({ error: 'invalid reasonCode' }, 400);
    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 2000) : null;

    const [row] = await db
      .insert(delayReasons)
      .values({ tenantId, taskId, reasonCode: body.reasonCode, notes, createdBy: userIdOf(c) })
      .onConflictDoUpdate({
        target: delayReasons.taskId,
        set: { reasonCode: body.reasonCode, notes, updatedAt: new Date() },
      })
      .returning();
    // Refresh the delay-taxonomy read caches for the common windows.
    for (const d of [30, 90]) await invalidateCached(c.env as Env, `insights:delaytax:t:${tenantId}:d:${d}`);
    return c.json(row, 201);
  });

  // Clear a task's delay reason.
  router.delete('/delay-taxonomy/:taskId', requireRole(TenantRole.DEVELOPER), async (c) => {
    const { tenantId } = scope(c);
    const taskId = Number(c.req.param('taskId'));
    if (!Number.isInteger(taskId)) return c.json({ error: 'invalid taskId' }, 400);
    await db.delete(delayReasons).where(and(eq(delayReasons.taskId, taskId), eq(delayReasons.tenantId, tenantId)));
    for (const d of [30, 90]) await invalidateCached(c.env as Env, `insights:delaytax:t:${tenantId}:d:${d}`);
    return c.json({ deleted: taskId });
  });

  // EMP-20 — export a key insight dataset as CSV or printable HTML. Not cached
  // (a download); the dataset compute is itself cheap/bounded. Manager-gated.
  router.get('/export', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const dataset = c.req.query('dataset') ?? '';
    if (!isExportDataset(dataset)) {
      return c.json({ error: `dataset must be one of: ${EXPORT_DATASETS.join(', ')}` }, 400);
    }
    const format = c.req.query('format') === 'html' ? 'html' : 'csv';
    const days = parseDays(c.req.query('days'));
    const projectId = parseProjectId(c.req.query('projectId'));
    const rows = await buildDatasetRows(db, dataset, tenantId, segmentId, days, projectId);
    const { contentType, ext } = exportContentMeta(format);
    const stamp = new Date().toISOString().slice(0, 10);
    const body = format === 'html' ? toHtmlTable(rows, { title: `${dataset} export — ${stamp}` }) : toCsv(rows);
    return new Response(body, {
      headers: {
        'content-type': contentType,
        'content-disposition': `attachment; filename="${dataset}-${stamp}.${ext}"`,
      },
    });
  });

  return router;
}
