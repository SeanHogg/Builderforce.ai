/**
 * The Insights export sources — the downloads the insight lenses offer.
 *
 * Each is DATA for `export/exportSource`: who may pull it, its formats, and the
 * rows. None of them serialises or builds a response; the one renderer does.
 *
 *   insights.evidence-pack    LENS #6 compliance evidence pack     [manager, premium]
 *   insights.capitalization   capitalization report (2 sheets)     [manager, premium]
 *   insights.dataset          EMP-20 key insight datasets          [manager]
 *
 * None is cached: a download is a deliberate point-in-time snapshot handed to
 * finance or an auditor, so it must be what the numbers are now, not what they
 * were up to a TTL ago. Each reuses the exact collectors its on-screen lens
 * renders from, so a downloaded file can never disagree with the page.
 */

import { TenantRole } from '../../domain/shared/types';
import { boundedIntParam, daysParam, positiveIntParam } from '../../domain/shared/boundedInt';
import { currentPeriodMonth } from '../../domain/shared/period';
import { ValidationError } from '../../domain/shared/errors';
import type { Db } from '../../infrastructure/database/connection';
import { exportStamp, type ExportTable, type TenantExportSource } from '../export/exportSource';
import { buildEvidencePack, evidencePackTable } from './complianceInsights';
import { computeAllocationHistory, computeAllocationInsights } from './allocationInsights';
import { capitalizationFlatTable, capitalizationTables } from '../metrics/capitalizationReport';
import { computeDora } from '../metrics/workforceMetrics';
import { computeFinanceInsights } from './financeInsights';
import { computeBenchmarking } from './benchmarkingInsights';

/** The paid-plan flag the premium lenses (and so their downloads) sit behind. */
export const PREMIUM_INSIGHTS_FEATURE = 'advancedInsights';

/** `GET /api/insights/compliance/export` — the audit evidence pack. */
export const evidencePackExportSource: TenantExportSource = {
  id: 'insights.evidence-pack',
  label: 'Compliance evidence pack',
  scope: 'tenant',
  minRole: TenantRole.MANAGER,
  planFeature: PREMIUM_INSIGHTS_FEATURE,
  formats: ['csv', 'json', 'xlsx'],
  async load(ctx) {
    const days = daysParam(ctx.param('days'), 90);
    const rows = await buildEvidencePack(ctx.db, ctx.tenantId, days);
    return {
      filename: `evidence-pack-${exportStamp(ctx.now)}`,
      title: 'Compliance evidence pack',
      table: evidencePackTable(rows),
      json: { generatedAt: new Date(ctx.now).toISOString(), windowDays: days, rows },
    };
  },
};

/**
 * `GET /api/insights/allocation/history/export` — the capitalization report.
 * `xlsx` is the one a finance reviewer works in (two sheets, real numbers);
 * `csv` is the interchange fallback; `json` is for a script.
 */
export const capitalizationExportSource: TenantExportSource = {
  id: 'insights.capitalization',
  label: 'Capitalization report',
  scope: 'tenant',
  minRole: TenantRole.MANAGER,
  planFeature: PREMIUM_INSIGHTS_FEATURE,
  formats: ['csv', 'xlsx', 'json'],
  async load(ctx) {
    const months = boundedIntParam(ctx.param('months'), { def: 12, min: 1, max: 24 });
    const projectId = positiveIntParam(ctx.param('projectId'));
    const [history, current] = await Promise.all([
      computeAllocationHistory(ctx.db, ctx.tenantId, months, ctx.now, { projectId }, { lineage: true }),
      computeAllocationInsights(ctx.db, ctx.tenantId, 30 * months, ctx.now, { projectId }, new Map(), { lineage: true }),
    ]);
    const scopeTag = projectId == null ? '' : `-project-${projectId}`;
    return {
      filename: `capitalization-${months}m${scopeTag}-${exportStamp(ctx.now)}`,
      title: 'Capitalization report',
      table: capitalizationFlatTable(history, current),
      sheets: capitalizationTables(history, current),
      json: { generatedAt: new Date(ctx.now).toISOString(), months, projectId: projectId ?? null, history, current },
    };
  },
};

/** The exportable insight datasets. Kept small and explicit so the export
 *  surface is auditable (no arbitrary passthrough). */
export const INSIGHT_EXPORT_DATASETS = ['dora', 'finance', 'allocation', 'benchmarking'] as const;
export type InsightExportDataset = (typeof INSIGHT_EXPORT_DATASETS)[number];

function isInsightExportDataset(x: string): x is InsightExportDataset {
  return (INSIGHT_EXPORT_DATASETS as readonly string[]).includes(x);
}

interface DatasetScope { db: Db; tenantId: number; segmentId: string; days: number; projectId?: number; now: number }

/** One loader per dataset — a registry, so a new dataset is an entry, not a branch. */
const DATASET_TABLES: Record<InsightExportDataset, (s: DatasetScope) => Promise<ExportTable>> = {
  async dora({ db, tenantId, days, projectId }) {
    const dora = await computeDora(db, tenantId, days, projectId);
    return {
      columns: ['week', 'deploy_freq_per_day', 'total_deployments', 'lead_time_hours', 'change_failure_rate_pct', 'mttr_hours'],
      rows: dora.series.map((s) => [
        s.bucketStart, s.deploymentFrequencyPerDay, s.totalDeployments, s.leadTimeHours, s.changeFailureRatePct, s.mttrHours,
      ]),
    };
  },
  async finance({ db, tenantId, segmentId, projectId, now }) {
    const fin = await computeFinanceInsights(db, tenantId, segmentId, currentPeriodMonth(now), now);
    return {
      columns: ['project', 'project_id', 'spend_usd'],
      rows: fin.byProject
        .filter((p) => projectId == null || p.projectId === projectId)
        .map((p) => [p.projectName, p.projectId, p.usd]),
    };
  },
  async allocation({ db, tenantId, days, projectId, now }) {
    const alloc = await computeAllocationInsights(db, tenantId, days, now, { projectId });
    return {
      columns: ['category', 'label', 'hours', 'pct', 'task_count', 'cost_usd', 'capex_usd', 'opex_usd'],
      rows: alloc.byCategory.map((b) => [b.category, b.label, b.hours, b.pct, b.taskCount, b.costUsd, b.capexUsd, b.opexUsd]),
    };
  },
  async benchmarking({ db, tenantId, days, projectId }) {
    const bench = await computeBenchmarking(db, tenantId, days, projectId);
    return {
      columns: ['metric', 'label', 'value', 'unit', 'percentile', 'rating', 'p50', 'p90'],
      rows: bench.metrics.map((m) => [m.metric, m.label, m.value, m.unit, m.percentile, m.rating, m.p50, m.p90]),
    };
  },
};

/** `GET /api/insights/export?dataset=…` — EMP-20 key insight datasets. */
export const insightDatasetExportSource: TenantExportSource = {
  id: 'insights.dataset',
  label: 'Insight dataset',
  scope: 'tenant',
  minRole: TenantRole.MANAGER,
  formats: ['csv', 'html', 'xlsx', 'json'],
  async load(ctx) {
    const dataset = ctx.param('dataset') ?? '';
    if (!isInsightExportDataset(dataset)) {
      throw new ValidationError(`dataset must be one of: ${INSIGHT_EXPORT_DATASETS.join(', ')}`);
    }
    const table = await DATASET_TABLES[dataset]({
      db: ctx.db,
      tenantId: ctx.tenantId,
      segmentId: ctx.segmentId,
      days: daysParam(ctx.param('days'), 30),
      projectId: positiveIntParam(ctx.param('projectId')),
      now: ctx.now,
    });
    const stamp = exportStamp(ctx.now);
    return { filename: `${dataset}-${stamp}`, title: `${dataset} export — ${stamp}`, table };
  },
};
