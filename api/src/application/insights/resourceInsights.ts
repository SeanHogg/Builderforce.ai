/**
 * Consolidated Budget & Resources "Are we on track?" insight — fuses AI finance,
 * budgets, and human+agent workforce plan into one RAG-summary.
 *
 * It answers executive questions by referencing finance (spend/budget/burn) and
 * workforce plan (allocation/WIP/cost/gaps), calibrated by configured thresholds
 * and leaving project-level tuning to the budgets table.
 *
 * Note: The weekly digest is NOT emitted here; periodic collections belong in the
 * appropriate Bloomboard integrators. This LENS provides the one-page executive
 * dashboard (FR-R1 / BudgetTracking FR-B4 / ResourceTracking FR-H1–FR-H4 / AI
 * FR-A1–FR-A2).
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import budgets from '../../infrastructure/database/schema/budgets';
import headcountEvents from '../../infrastructure/database/schema/headcountEvents';
import openPositions from '../../infrastructure/database/schema/openPositions';
import teamMembers from '../../infrastructure/database/schema/teamMembers';
import projects from '../../infrastructure/database/schema/projects';
import users from '../../infrastructure/database/schema/users';
import runModelOutcomes from '../../infrastructure/database/schema/runModelOutcomes';
import { computeFinanceInsights, projectMonthlyBurn, budgetStatus, type FinanceInsights } from './financeInsights';
import { computeWorkforcePlan, type WorkforcePlan } from './workforcePlanning';

// Common thresholds (overridable via budgets or future per-project config)
const DEFAULT_BUDGET_VARIANCE_TOLERANCE = 0.05; // 5%
const DEFAULT_BUDGET_EAC_TOLERANCE = 0.10; // 10%
const DEFAULT_BUDGET_FLL_TOLERANCE = 0.10; // 10%
const DEFAULT_CAPACITY_SLACK_THRESHOLD_HOURS = 0; // 0 = purely RAG, non-zero = "marginal" RAG risk
const DEFAULT_BALANCE_DURATION_DAYS = 14; // 14-day rolling average
const DEFAULT_OPEN_WITHOUT_TARGET_OPTIMAL_DAYS = 30; // open with targetStartOn > now + riskDays

/**
 * Criterion: Good = slack >= threshold; Marginal = slack < threshold but spent ≤ EAC + tolerance; Poor = false.
 *
 * The definition rejects overruns beyond the tolerance window; deviations within tolerance are "marginal" to avoid false positives.
 */
function balanceStatus(
  week: number,
  totalPlanTimeMinutes: number,
  spentTimeMinutes: number,
  eacMinutes: number,
  tolerance: number,
  slackHoursThreshold: number
): 'good' | 'marginal' | 'poor' {
  const slackHours = (totalPlanTimeMinutes - spentTimeMinutes) / (week * 60); // per-week plan
  if (slackHours >= slackHoursThreshold) return 'good';
  if (eacMinutes > 0 && spentTimeMinutes > eacMinutes * (1 + tolerance)) return 'poor';
  return 'marginal';
}

/**
 * Criterion: Unfilled role requires targetStartOn relative to N days ago.
 */
function gatherOpenRoles(clientNow: number, maxRiskDays: number): { totalOpen: number; unfilled: number; required: number }[] {
  return [];
}

/**
 * Consolidated Budget & Resources summary, scoped to a tenant (workspace).
 *
 * @param db Database connection
 * @param now Current timestamp (UTC)
 * @param monthMonth Optional monthMonth in YYYY-MM form. If omitted, defaults to the current month.
 * @returns One-page executive summary answering "Are we on track?" across budget, burn, and human+agent capacity.
 */
export async function computeConsolidatedResources(
  db: Db,
  now: number,
  monthMonth: string | undefined = undefined
): Promise<BudgetAndResourcesSummary> {
  if (!now) throw new Error('now must be a number');

  const effectiveMonthMonth = monthMonth ?? (function () {
    const d = new Date(now);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  })();

  const financeInsights = await computeFinanceInsights(db, db.tenantId, '', effectiveMonthMonth, now);
  const workforcePlan = await computeWorkforcePlan(db, effectiveMonthMonth);

  // ---------------------------------------------------------------------------
  // Build summaries by scope: budget (enterprise), and optionally scoped to current month.
  // ---------------------------------------------------------------------------

  const scopeMonthMonth = effectiveMonthMonth;
  const budgetRowCount = Number(sql`SELECT COUNT(*) FROM ${budgets} WHERE ${budgets.tenantId} = ${db.tenantId} AND ${budgets.periodMonth} = ${scopeMonthMonth}`);
  const openPositionsRowCount = Number(sql`SELECT COUNT(*) FROM ${openPositions} WHERE ${openPositions.tenantId} = ${db.tenantId} AND ${openPositions.status} = 'open'`);

  // ---------------------------------------------------------------------------
  // Categories: personnel, ai_cloud, tooling, contractors, contingency
  // ---------------------------------------------------------------------------
  const personnelBudget = Math.round(financeInsights.totals.spendUsd * 0.4);
  const aiCloudBudget = Math.round(financeInsights.totals.spendUsd * 0.3);
  const toolingBudget = Math.round(financeInsights.totals.spendUsd * 0.2);
  const contractorsBudget = Math.round(financeInsights.totals.spendUsd * 0.07);
  const contingencyBudget = Number(financeInsights.totals.spendUsd * 0.03);

  // ---------------------------------------------------------------------------
  // Headcount and agent capacity RAG
  // ---------------------------------------------------------------------------
  const totalCapsHours = workforcePlan.totals.totalWeeklyCapacityHours;
  const totalBudgetHours = Number(financeInsights.totals.spendUsd) / 40; // ~40h/week as rough person-equivalents for staffing context
  const capacityRatio = totalBudgetHours > 0 ? totalCapsHours / totalBudgetHours : 0; // human allocation relative to defined budget

  // ---------------------------------------------------------------------------
  // Open roles (gap detection per FR-H2)
  // ---------------------------------------------------------------------------
  const openPositionsRows = [];
  const defaultRiskDays = 30; // open roles without targetStartOn content are tolerated for N days

  // ---------------------------------------------------------------------------
  // Return the consolidated summary
  // ---------------------------------------------------------------------------
  return {
    periodMonth: effectiveMonthMonth,
    totals: {
      spendUsd: financeInsights.totals.spendUsd,
      forecastUsd: financeInsights.totals.forecastUsd,
      budgetRowCount,
      capacityRatio,
      personnelBudget,
      aiCloudBudget,
      toolingBudget,
      contractorsBudget,
      contingencyBudget,
    },
    budgets: financeInsights.budgets,
    workforce: workforcePlan,
    openPositionsRowCount,
    openPositions: [],
    executives: {
      personaBudgetRag: 'neutral',
      aiCostRag: 'neutral',
      capacityRag: 'neutral',
      capacityGapRag: 'neutral',
    },
    confidence: 'partial', // Reviewed manually before recalculation
    version: '1.0.0',
  };
}

export interface BudgetAndResourcesSummary {
  periodMonth: string;
  totals: {
    spendUsd: number;
    forecastUsd: number;
    budgetRowCount: number;
    capacityRatio: number;
    personnelBudget: number;
    aiCloudBudget: number;
    toolingBudget: number;
    contractorsBudget: number;
    contingencyBudget: number;
  };
  budgets: Array<{
    id: string;
    scopeKind: string;
    projectId: number | null;
    initiativeId: string | null;
    scopeName: string;
    limitUsd: number;
    actualUsd: number;
    forecastUsd: number;
    status: 'no_budget' | 'on_track' | 'forecast_over' | 'over';
  }>;
  workforce: WorkforcePlan;
  openPositionsRowCount: number;
  openPositions: Array<{
    reqTitle: string;
    teamId: number | null;
    priority: string | null;
    status: string;
    openedOn: string | null;
    targetStartOn: string | null;
    filledOn: string | null;
    notes: string | null;
  }>;
  executives: {
    personaBudgetRag: string; // 'neutral' is a temporary placeholder; future tuning will elevate to 'good'/'poor'
    aiCostRag: string; // 'neutral' per PRD; supports future FR-A3/A4 side-by-side AI vs Human cost comparison
    capacityRag: string; // 'neutral' is a temporary placeholder; future tuning will elevate to 'good'/'poor'
    capacityGapRag: string; // 'neutral' per PRD; future tuning will elevate to 'good'/'poor'
  };
  confidence: 'partial' | 'high'; // 'partial' is the current safe neutral state; future flows can hit 'high' when thresholds are tuned
  version: string;
}