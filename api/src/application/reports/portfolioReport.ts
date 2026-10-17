import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { portfolios } from '../../infrastructure/database/schema';
import { computePortfolioRollup } from '../pmo/portfolioRollup';

/**
 * Portfolio rollup report (PMO exec summary) — one row per portfolio with its
 * delivery / spend / DORA / OKR / dependency-health rollup. Reuses the canonical
 * computePortfolioRollup so the scheduled report and the live /pmo lens never
 * drift. Portfolios compute concurrently (few per tenant; MANAGER-gated, infrequent).
 */
export async function generatePortfolioReport(db: Db, tenantId: number, segmentId: string) {
  const pfRows = await db
    .select({ id: portfolios.id, name: portfolios.name, status: portfolios.status })
    .from(portfolios)
    .where(and(eq(portfolios.tenantId, tenantId), eq(portfolios.segmentId, segmentId)));

  const now = Date.now();
  const items: Array<Record<string, unknown>> = [];
  // The rollups are independent reads, so every portfolio computes at once; the
  // items still come out in portfolio order.
  const rollups = await Promise.all(pfRows.map((pf) =>
    computePortfolioRollup(db, tenantId, segmentId, { kind: 'portfolio', id: pf.id }, { now })));
  for (const [i, pf] of pfRows.entries()) {
    const r = rollups[i];
    if (!r) continue;
    items.push({
      portfolioId: pf.id,
      name: pf.name,
      status: pf.status,
      initiativeCount: r.initiativeCount,
      projectCount: r.projectCount,
      completedTasks: r.delivery.completedCount,
      openTasks: r.delivery.openCount,
      agentLlmCostUsd: r.spend.agentLlmCostUsd,
      okrProgressPct: Math.round(r.okr.avgProgress * 100),
      deploymentsWindow: r.dora.totalDeployments,
      changeFailureRatePct: r.dora.changeFailureRatePct,
      criticalPathLength: r.criticalPath.length,
      blockedInitiatives: r.byInitiative.filter((i) => i.isBlocked).length,
    });
  }

  const totalCost = items.reduce((s, i) => s + (i.agentLlmCostUsd as number), 0);
  const avgOkr = items.length
    ? Math.round(items.reduce((s, i) => s + (i.okrProgressPct as number), 0) / items.length)
    : 0;
  return {
    reportType: 'portfolio_rollup',
    generatedAt: new Date().toISOString(),
    summary: {
      portfolios: items.length,
      totalAgentLlmCostUsd: totalCost,
      avgOkrProgressPct: avgOkr,
    },
    portfolios: items,
  };
}
