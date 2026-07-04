/**
 * LENS #3 — FinOps over `llm_usage_log` (gate insights.finance / CFO).
 *
 * Cost is already attributed (ticket→project→tenant, cache-aware, paid-overflow
 * flagged) — this turns *cost* into *FinOps*: spend rollup, budget-vs-actual,
 * a linear month-end forecast, overspend status, and cost-per-merged-PR (joining
 * `run_model_outcomes`). The math ({@link projectMonthlyBurn},
 * {@link budgetStatus}) is pure for unit testing; the route caches the rollup.
 */

import { and, eq, gte, lt, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { budgets, initiatives, llmUsageLog, projects, runModelOutcomes } from '../../infrastructure/database/schema';
import { MILLICENTS_PER_USD } from '../../domain/shared/money';

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ── Pure FinOps math (unit-tested) ───────────────────────────────────────────

/** Linear month-end projection: spend so far scaled by elapsed→total days.
 *  dayOfMonth/daysInMonth are 1-based; guards divide-by-zero on day 0. */
export function projectMonthlyBurn(spentSoFar: number, dayOfMonth: number, daysInMonth: number): number {
  if (dayOfMonth <= 0 || daysInMonth <= 0) return spentSoFar;
  return (spentSoFar / dayOfMonth) * daysInMonth;
}

export type BudgetState = 'no_budget' | 'on_track' | 'forecast_over' | 'over';

/** Classify a budget line: already over, forecast to exceed, on track, or unset. */
export function budgetStatus(limitUsd: number, actualUsd: number, forecastUsd: number): BudgetState {
  if (limitUsd <= 0) return 'no_budget';
  if (actualUsd > limitUsd) return 'over';
  if (forecastUsd > limitUsd) return 'forecast_over';
  return 'on_track';
}

// ── Rollup shapes ────────────────────────────────────────────────────────────

export interface BudgetLine {
  id: string;
  scopeKind: string;
  projectId: number | null;
  initiativeId: string | null;
  scopeName: string;
  limitUsd: number;
  actualUsd: number;
  forecastUsd: number;
  status: BudgetState;
}

export interface FinanceInsights {
  periodMonth: string;
  totals: {
    spendUsd: number;
    forecastUsd: number;
    paidOverflowUsd: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    costPerMergedPrUsd: number | null;
    mergedRuns: number;
  };
  daily: Array<{ date: string; usd: number }>;
  byProject: Array<{ projectId: number; projectName: string; usd: number }>;
  budgets: BudgetLine[];
}

/** Parse an ISO 'YYYY-MM' into 1-based (year, month), falling back to epoch-ish
 *  defaults so callers never receive NaN. */
function parseYearMonth(periodMonth: string): { y: number; m: number } {
  const [yStr, mStr] = periodMonth.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  return { y: Number.isFinite(y) && y > 0 ? y : 1970, m: Number.isFinite(m) && m >= 1 && m <= 12 ? m : 1 };
}

/** Days in the calendar month of an ISO 'YYYY-MM' (UTC). */
export function daysInMonth(periodMonth: string): number {
  const { y, m } = parseYearMonth(periodMonth);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Month bounds [start, nextMonthStart) in UTC for an ISO 'YYYY-MM'. */
function monthRange(periodMonth: string): { start: Date; end: Date } {
  const { y, m } = parseYearMonth(periodMonth);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}

/**
 * @param segmentId  A segment UUID to scope the budget rollup to, or an empty
 *   string for a whole-tenant rollup across every segment. Empty is the
 *   established sentinel used by the tenant-wide callers (recommendations, deck
 *   export, dashboard metrics); it MUST NOT be passed through to the `segment_id`
 *   uuid filter — Postgres rejects `''::uuid` at bind time even for zero rows.
 */
export async function computeFinanceInsights(
  db: Db,
  tenantId: number,
  segmentId: string,
  periodMonth: string,
  now: number,
): Promise<FinanceInsights> {
  const { start, end } = monthRange(periodMonth);

  // ── actuals (per-day + totals) over the attributed ledger ──────────────────
  const usageRows = await db
    .select({
      day: sql<string>`to_char(${llmUsageLog.createdAt}, 'YYYY-MM-DD')`,
      usd: sql<string>`coalesce(sum(${llmUsageLog.costUsdMillicents}),0)`,
      overflow: sql<string>`coalesce(sum(case when ${llmUsageLog.paidOverflow} then ${llmUsageLog.costUsdMillicents} else 0 end),0)`,
      cacheRead: sql<string>`coalesce(sum(${llmUsageLog.cacheReadTokens}),0)`,
      cacheCreate: sql<string>`coalesce(sum(${llmUsageLog.cacheCreationTokens}),0)`,
    })
    .from(llmUsageLog)
    .where(and(eq(llmUsageLog.tenantId, tenantId), gte(llmUsageLog.createdAt, start), lt(llmUsageLog.createdAt, end)))
    .groupBy(sql`to_char(${llmUsageLog.createdAt}, 'YYYY-MM-DD')`)
    .orderBy(sql`to_char(${llmUsageLog.createdAt}, 'YYYY-MM-DD')`);

  const daily = usageRows.map((r) => ({ date: r.day, usd: num(r.usd) / MILLICENTS_PER_USD }));
  const spendUsd = daily.reduce((a, d) => a + d.usd, 0);
  const paidOverflowUsd = usageRows.reduce((a, r) => a + num(r.overflow), 0) / MILLICENTS_PER_USD;
  const cacheReadTokens = usageRows.reduce((a, r) => a + num(r.cacheRead), 0);
  const cacheCreationTokens = usageRows.reduce((a, r) => a + num(r.cacheCreate), 0);

  // ── per-project spend ──────────────────────────────────────────────────────
  const projRows = await db
    .select({
      projectId: llmUsageLog.projectId,
      projectName: projects.name,
      usd: sql<string>`coalesce(sum(${llmUsageLog.costUsdMillicents}),0)`,
    })
    .from(llmUsageLog)
    .innerJoin(projects, eq(projects.id, llmUsageLog.projectId))
    .where(and(eq(llmUsageLog.tenantId, tenantId), gte(llmUsageLog.createdAt, start), lt(llmUsageLog.createdAt, end)))
    .groupBy(llmUsageLog.projectId, projects.name)
    .orderBy(sql`coalesce(sum(${llmUsageLog.costUsdMillicents}),0) desc`);
  const byProject = projRows
    .filter((r) => r.projectId != null)
    .map((r) => ({ projectId: r.projectId as number, projectName: r.projectName ?? `Project ${r.projectId}`, usd: num(r.usd) / MILLICENTS_PER_USD }));
  const usdByProject = new Map(byProject.map((p) => [p.projectId, p.usd]));

  // ── per-initiative spend (the link path projects.initiative_id → initiative) ─
  const initRows = await db
    .select({
      initiativeId: projects.initiativeId,
      usd: sql<string>`coalesce(sum(${llmUsageLog.costUsdMillicents}),0)`,
    })
    .from(llmUsageLog)
    .innerJoin(projects, eq(projects.id, llmUsageLog.projectId))
    .where(and(
      eq(llmUsageLog.tenantId, tenantId),
      gte(llmUsageLog.createdAt, start),
      lt(llmUsageLog.createdAt, end),
      sql`${projects.initiativeId} is not null`,
    ))
    .groupBy(projects.initiativeId);
  const usdByInitiative = new Map(
    initRows.filter((r) => r.initiativeId != null).map((r) => [r.initiativeId as string, num(r.usd) / MILLICENTS_PER_USD]),
  );

  // ── cost-per-merged-PR (join run_model_outcomes for the period) ────────────
  const [outcomeAgg] = await db
    .select({ merged: sql<string>`coalesce(sum(case when ${runModelOutcomes.merged} then 1 else 0 end),0)` })
    .from(runModelOutcomes)
    .where(and(eq(runModelOutcomes.tenantId, tenantId), gte(runModelOutcomes.createdAt, start), lt(runModelOutcomes.createdAt, end)));
  const mergedRuns = num(outcomeAgg?.merged);
  const costPerMergedPrUsd = mergedRuns > 0 ? spendUsd / mergedRuns : null;

  // ── forecast ───────────────────────────────────────────────────────────────
  const dim = daysInMonth(periodMonth);
  const nowDate = new Date(now);
  const isCurrentMonth = nowDate >= start && nowDate < end;
  const dayOfMonth = isCurrentMonth ? nowDate.getUTCDate() : dim; // past months are complete
  const forecastUsd = projectMonthlyBurn(spendUsd, dayOfMonth, dim);

  // ── budgets for the period (budget-vs-actual per scope, names joined) ──────
  const budgetRows = await db
    .select({
      id: budgets.id,
      scopeKind: budgets.scopeKind,
      projectId: budgets.projectId,
      initiativeId: budgets.initiativeId,
      limitUsd: budgets.limitUsd,
      projectName: projects.name,
      initiativeName: initiatives.name,
    })
    .from(budgets)
    .leftJoin(projects, eq(projects.id, budgets.projectId))
    .leftJoin(initiatives, eq(initiatives.id, budgets.initiativeId))
    .where(and(
      eq(budgets.tenantId, tenantId),
      // Empty segmentId = whole-tenant rollup: omit the uuid filter entirely
      // (binding '' as a uuid throws); a real segment id scopes the rollup.
      ...(segmentId ? [eq(budgets.segmentId, segmentId)] : []),
      eq(budgets.periodMonth, periodMonth),
    ));
  const budgetLines: BudgetLine[] = budgetRows.map((b) => {
    const actualUsd =
      b.scopeKind === 'project' && b.projectId != null
        ? usdByProject.get(b.projectId) ?? 0
        : b.scopeKind === 'initiative' && b.initiativeId != null
          ? usdByInitiative.get(b.initiativeId) ?? 0
          : spendUsd; // tenant scope = whole-workspace spend
    const scopeForecast = projectMonthlyBurn(actualUsd, dayOfMonth, dim);
    return {
      id: b.id,
      scopeKind: b.scopeKind,
      projectId: b.projectId ?? null,
      initiativeId: b.initiativeId ?? null,
      scopeName:
        b.scopeKind === 'project'
          ? b.projectName ?? `Project ${b.projectId}`
          : b.scopeKind === 'initiative'
            ? b.initiativeName ?? 'Initiative'
            : 'Workspace',
      limitUsd: num(b.limitUsd),
      actualUsd,
      forecastUsd: scopeForecast,
      status: budgetStatus(num(b.limitUsd), actualUsd, scopeForecast),
    };
  });

  return {
    periodMonth,
    totals: { spendUsd, forecastUsd, paidOverflowUsd, cacheReadTokens, cacheCreationTokens, costPerMergedPrUsd, mergedRuns },
    daily,
    byProject,
    budgets: budgetLines,
  };
}
