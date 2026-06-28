/**
 * Deck DataAssembly — gather the full {@link DeckData} bundle from the EXISTING
 * lenses (no new collection): executive summary, DORA, finance, AI-impact, plus
 * the board-deck collectors (quality / people / rd-financials) and PMO
 * initiatives/objectives. Wrapped in the read-through cache so a deck render and
 * a dashboard view share the same computed figures.
 */

import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { initiatives, objectives, aiProgramInitiatives, aiToolAdoption, tenants } from '../../infrastructure/database/schema';
import { buildExecutiveSummary } from '../reports/executiveSummary';
import { computeDora } from '../metrics/workforceMetrics';
import { computeFinanceInsights } from '../insights/financeInsights';
import { computeAiImpact } from '../insights/aiImpactInsights';
import { computeQualityInsights } from '../insights/qualityInsights';
import { computePeopleInsights } from '../insights/peopleInsights';
import { computeRdFinancials } from '../insights/rdFinancialsInsights';
import type { DeckData } from './types';

const DAY_MS = 86_400_000;

/** Current fiscal quarter label, e.g. '2026-Q2' (UTC). */
export function currentQuarter(now: number): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

function periodMonth(now: number): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const round = (n: number | null | undefined, dp = 1): number | null =>
  n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** dp) / 10 ** dp;

/** I/O: assemble the DeckData for a tenant + quarter (90-day window for the live
 *  lenses, fiscal-year for the quarterly financials). Cached on a short TTL. */
export async function assembleDeckData(db: Db, env: Env, tenantId: number, quarter: string): Promise<DeckData> {
  const key = `deck:data:t:${tenantId}:q:${quarter}`;
  return getOrSetCached(env, key, () => loadDeckData(db, tenantId, quarter), { kvTtlSeconds: 120, l1TtlMs: 30_000 });
}

async function loadDeckData(db: Db, tenantId: number, quarter: string): Promise<DeckData> {
  const now = Date.now();
  const days = 90;
  const fy = Number(quarter.slice(0, 4)) || new Date(now).getUTCFullYear();

  const [exec, dora, finance, ai, quality, people, rdfin, inits, objs, aiPrograms, aiTools, tenantRow] = await Promise.all([
    buildExecutiveSummary(db, tenantId, new Date(now - days * DAY_MS), new Date(now)),
    computeDora(db, tenantId, days),
    computeFinanceInsights(db, tenantId, '', periodMonth(now), now),
    computeAiImpact(db, tenantId, days),
    computeQualityInsights(db, tenantId, days),
    computePeopleInsights(db, tenantId, 6),
    computeRdFinancials(db, tenantId, fy),
    db.select({ name: initiatives.name, description: initiatives.description })
      .from(initiatives).where(eq(initiatives.tenantId, tenantId)).limit(8),
    db.select({ title: objectives.title, status: objectives.status, period: objectives.period, initiativeId: objectives.initiativeId })
      .from(objectives).where(eq(objectives.tenantId, tenantId)).limit(12),
    db.select({ programName: aiProgramInitiatives.programName, objective: aiProgramInitiatives.objective, investedUsd: aiProgramInitiatives.investedUsd })
      .from(aiProgramInitiatives).where(eq(aiProgramInitiatives.tenantId, tenantId)).limit(8),
    db.select({ toolName: aiToolAdoption.toolName, activeUsers: aiToolAdoption.activeUsers, eligibleUsers: aiToolAdoption.eligibleUsers, estHoursSaved: aiToolAdoption.estHoursSaved, monthlyCostUsd: aiToolAdoption.monthlyCostUsd, periodMonth: aiToolAdoption.periodMonth })
      .from(aiToolAdoption).where(eq(aiToolAdoption.tenantId, tenantId)).orderBy(desc(aiToolAdoption.periodMonth)).limit(8),
    db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)).limit(1),
  ]);

  // Investment slide — latest quarter's financials within the fiscal year.
  const lastQuarter = rdfin.quarters[rdfin.quarters.length - 1] ?? null;
  const financialsByCategory = (lastQuarter?.byCategory ?? []).map((r) => [
    r.category, fmtUsd(r.actualUsd), fmtUsd(r.planUsd), r.actualVsPlanPct == null ? '—' : `${Math.round(r.actualVsPlanPct)}%`,
  ]);
  const fteByCategory = (lastQuarter?.fteByCategory ?? []).map((r) => [r.category, String(round(r.fte, 1) ?? '—')]);

  const aiProgramInvested = aiPrograms.reduce((a, p) => a + (p.investedUsd || 0), 0);

  return {
    meta: { quarter, tenantName: tenantRow[0]?.name ?? null, generatedAt: new Date(now).toISOString() },
    investment: {
      rdToRevenuePct: round(lastQuarter?.rdToRevenuePct ?? null),
      growthRdPct: round(lastQuarter?.growthVsPriorQPct ?? null),
      totalActualUsd: lastQuarter?.totalActualUsd ?? null,
      totalPlanUsd: lastQuarter?.totalPlanUsd ?? null,
      financialsByCategory,
      fteByCategory,
      initiatives: inits.map((i) => [i.name, i.description ?? '']),
    },
    deliverables: {
      // [objective, target-period, %complete, status, cost] — cost is left blank
      // (no per-objective lifetime-cost rollup yet; see ROADMAP).
      rows: objs.map((o) => [o.title, o.period ?? '', statusToPct(o.status), o.status, '']),
    },
    quality: {
      uptimePct: round(quality.uptimePct),
      mttrHours: round(quality.prodIncidents.mttrHours),
      alertsCount: quality.alertsCount,
      postProductionBugs: quality.postProductionBugs,
      supportTickets: quality.support.tickets,
      defectAging: quality.defectAging.map((b) => [b.bucket, String(b.count)]),
    },
    delivery: {
      deploymentFrequencyPerDay: round(dora.deploymentFrequencyPerDay, 2),
      leadTimeHours: round(dora.leadTimeHours),
      changeFailureRatePct: round(dora.changeFailureRatePct),
      mttrHours: round(dora.mttrHours),
      totalPrsMerged: exec.kpis.totalPrsMerged,
      totalIssuesResolved: exec.kpis.totalIssuesResolved,
    },
    people: {
      attritionRatePct: round(people.attritionRatePct),
      devSatisfactionScore: round(people.devSatisfaction.score),
      waterfall: people.waterfall.map((w) => [w.month, String(w.hires), String(w.departures), String(w.net), String(w.endHeadcount)]),
      openPositions: people.openPositions.map((p) => [p.reqTitle, p.priority, String(p.daysOpen), p.targetStartOn ?? '—']),
    },
    ai: {
      productivityScore: round(ai.productivity.score),
      programInvestedUsd: aiProgramInvested || null,
      adoption: aiTools.map((t) => [
        t.toolName,
        t.eligibleUsers > 0 ? `${Math.round((t.activeUsers / t.eligibleUsers) * 100)}%` : '—',
        String(round(t.estHoursSaved, 0) ?? '—'),
        fmtUsd(t.monthlyCostUsd),
      ]),
      programs: aiPrograms.map((p) => [p.programName, p.objective ?? '', fmtUsd(p.investedUsd)]),
    },
    finance: {
      spendUsd: round(finance.totals.spendUsd, 2),
      forecastUsd: round(finance.totals.forecastUsd, 2),
      costPerMergedPrUsd: round(finance.totals.costPerMergedPrUsd ?? null, 2),
    },
  };
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/** Coarse %-complete from an objective status (no per-objective progress column). */
function statusToPct(status: string): string {
  switch (status) {
    case 'achieved': return '100%';
    case 'missed': return '—';
    case 'archived': return '—';
    default: return 'In progress';
  }
}
