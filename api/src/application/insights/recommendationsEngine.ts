/**
 * AI-driven Insights & Recommendations — the prescriptive layer ON TOP of the
 * existing read-only lenses.
 *
 * The lenses answer "what are the numbers"; this answers "what should I DO". It
 * re-runs the already-cached collectors (finance / engineering / allocation /
 * DORA), then applies deterministic rules + cheap current-vs-prior anomaly checks
 * to emit a RANKED list of prescriptive recommendations:
 *
 *   - cost  — spend forecast over budget signal, cost-per-merged-PR spike (anomaly)
 *   - quality — low overall merge rate, a model that under-merges vs the fleet,
 *               high degraded/CI-red rate
 *   - allocation — a category materially below its goal target (e.g. innovation),
 *                  low capitalizable share
 *   - delivery — DORA change-failure-rate / MTTR / lead-time pressure
 *
 * Recommendations are NOT stored — they are recomputed each call so they always
 * reflect current data. Only DISMISSALS persist (recommendation_dismissals); a
 * dismissed rec_key is filtered out. The pure rule functions are exported so the
 * ranking/anomaly logic is unit-testable without a DB.
 */

import { and, eq } from 'drizzle-orm';
import {
  integer,
  pgTable,
  serial,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';
import type { Db } from '../../infrastructure/database/connection';
import { tenants } from '../../infrastructure/database/schema';
import { computeFinanceInsights, type FinanceInsights } from './financeInsights';
import { computeEngineeringInsights, type EngineeringInsights } from './engineeringInsights';
import { computeAllocationInsights, type AllocationInsights } from './allocationInsights';
import { computeDora } from '../metrics/workforceMetrics';
import type { DoraRollup } from '../metrics/workforceMetrics';

/**
 * Persisted dismissals only (recommendations themselves are computed live).
 * Defined here — not in the shared schema.ts — because this feature owns the
 * table; mirrors migration 0232 exactly.
 */
export const recommendationDismissals = pgTable('recommendation_dismissals', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  recKey:      varchar('rec_key', { length: 120 }).notNull(),
  dismissedBy: varchar('dismissed_by', { length: 36 }),
  dismissedAt: timestamp('dismissed_at').notNull().defaultNow(),
}, (t) => [
  unique('recommendation_dismissals_tenant_id_rec_key_key').on(t.tenantId, t.recKey),
]);

const HOUR_MS = 3_600_000;

export type RecSeverity = 'critical' | 'warning' | 'info';
export type RecCategory = 'cost' | 'quality' | 'allocation' | 'delivery';

export interface Recommendation {
  /** Stable identity for dismissal (e.g. 'cost.per_pr_spike'). */
  key: string;
  severity: RecSeverity;
  category: RecCategory;
  title: string;
  /** Human-readable explanation grounded in the computed figure. */
  detail: string;
  /** The headline figure the recommendation is built on (for the UI badge). */
  metric: string;
  /** The prescriptive action to take. */
  recommendation: string;
  /** Sort weight (higher = more urgent). Derived from severity + magnitude. */
  rank: number;
}

export interface RecommendationsResult {
  windowDays: number;
  recommendations: Recommendation[];
}

const SEVERITY_BASE: Record<RecSeverity, number> = { critical: 1000, warning: 500, info: 100 };

/** Severity → base rank + a 0..100 magnitude bump so worse offenders sort first. */
function ranked(r: Omit<Recommendation, 'rank'>, magnitude = 0): Recommendation {
  return { ...r, rank: SEVERITY_BASE[r.severity] + Math.max(0, Math.min(100, magnitude)) };
}

const pctStr = (n: number) => `${n.toFixed(0)}%`;
const usdStr = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

// ── Pure rule inputs (kept DB-free so the rules are unit-testable) ─────────────

export interface RuleInputs {
  finance: FinanceInsights;
  /** Finance for the equivalent PRIOR month, for the cost anomaly check. */
  priorFinance: FinanceInsights | null;
  engineering: EngineeringInsights;
  allocation: AllocationInsights;
  dora: DoraRollup;
}

// Thresholds — documented, deterministic, tuned to surface signal not noise.
const COST_SPIKE_PCT = 25;           // cost-per-merged-PR rose ≥25% vs prior window
const LOW_MERGE_RATE_PCT = 40;       // overall merged rate below this is a quality flag
const MODEL_MERGE_GAP_PCT = 20;      // a model ≥20pts below the fleet merge rate
const MODEL_MIN_RUNS = 5;            // …with enough runs to be meaningful
const HIGH_DEGRADED_PCT = 15;        // degraded (floored-onto-non-coder) rate ceiling
const ALLOC_VARIANCE_PCT = 8;        // a category ≥8pts below its goal target
const LOW_CAPITALIZABLE_PCT = 20;    // capitalizable share floor (R&D capex signal)
const HIGH_CFR_PCT = 15;             // change-failure-rate ceiling (DORA "low" band)
const HIGH_MTTR_HOURS = 24;          // MTTR ceiling
const HIGH_LEAD_TIME_HOURS = 168;    // lead time > 1 week

/** Pure: derive the full ranked recommendation list from already-computed lenses. */
export function deriveRecommendations(inp: RuleInputs): Recommendation[] {
  const out: Recommendation[] = [];

  // ── COST ────────────────────────────────────────────────────────────────────
  // Forecast-over-budget: any budget line forecast to exceed its limit.
  const overBudget = inp.finance.budgets.filter((b) => b.status === 'over' || b.status === 'forecast_over');
  if (overBudget.length > 0) {
    const worst = overBudget.reduce((a, b) => (b.forecastUsd - b.limitUsd > a.forecastUsd - a.limitUsd ? b : a));
    const overBy = worst.forecastUsd - worst.limitUsd;
    const overPct = worst.limitUsd > 0 ? (overBy / worst.limitUsd) * 100 : 0;
    out.push(ranked({
      key: 'cost.budget_over',
      severity: worst.status === 'over' ? 'critical' : 'warning',
      category: 'cost',
      title: 'Budget at risk of overspend',
      detail: `${worst.scopeName} is forecast to spend ${usdStr(worst.forecastUsd)} against a ${usdStr(worst.limitUsd)} limit (${pctStr(overPct)} over).`,
      metric: `+${usdStr(overBy)}`,
      recommendation: 'Cap or re-route spend on this scope — shift work to cheaper models or tighten run budgets before month end.',
    }, overPct));
  }

  // Cost-per-merged-PR spike vs the prior window (anomaly).
  const cur = inp.finance.totals.costPerMergedPrUsd;
  const prior = inp.priorFinance?.totals.costPerMergedPrUsd ?? null;
  if (cur != null && prior != null && prior > 0) {
    const deltaPct = ((cur - prior) / prior) * 100;
    if (deltaPct >= COST_SPIKE_PCT) {
      out.push(ranked({
        key: 'cost.per_pr_spike',
        severity: deltaPct >= 50 ? 'critical' : 'warning',
        category: 'cost',
        title: 'Cost per merged PR is rising',
        detail: `Cost per merged PR rose ${pctStr(deltaPct)} vs the prior window (${usdStr(prior)} → ${usdStr(cur)}).`,
        metric: `+${pctStr(deltaPct)}`,
        recommendation: 'Investigate which approach/model is driving the increase and shift work toward higher-merge-rate, lower-cost models.',
      }, deltaPct));
    }
  }

  // ── QUALITY (AI effectiveness) ───────────────────────────────────────────────
  const eng = inp.engineering;
  if (eng.totals.runs > 0 && eng.totals.mergedRatePct < LOW_MERGE_RATE_PCT) {
    out.push(ranked({
      key: 'quality.low_merge_rate',
      severity: eng.totals.mergedRatePct < 20 ? 'critical' : 'warning',
      category: 'quality',
      title: 'Low overall merge rate',
      detail: `Only ${pctStr(eng.totals.mergedRatePct)} of ${eng.totals.runs} AI runs merged in the window.`,
      metric: pctStr(eng.totals.mergedRatePct),
      recommendation: 'Review failing approaches in the AI-effectiveness lens; tighten task scoping and CI gating before dispatch.',
    }, LOW_MERGE_RATE_PCT - eng.totals.mergedRatePct));
  }

  // A model under-merging vs the fleet (shift-work signal). Compare each
  // sufficiently-evidenced model against the fleet-wide merge rate.
  const fleetMerge = eng.totals.mergedRatePct;
  const candidates = eng.byModel.filter((m) => m.runs >= MODEL_MIN_RUNS);
  const best = [...candidates].sort((a, b) => b.mergedRatePct - a.mergedRatePct)[0];
  for (const m of candidates) {
    const gap = fleetMerge - m.mergedRatePct;
    if (gap >= MODEL_MERGE_GAP_PCT && best && best.model !== m.model) {
      out.push(ranked({
        key: `quality.model_low_merge.${m.model}`,
        severity: 'warning',
        category: 'quality',
        title: `Model ${m.model} under-merges`,
        detail: `${m.model} merges at ${pctStr(m.mergedRatePct)} over ${m.runs} runs — ${gap.toFixed(0)}pts below the fleet (${pctStr(fleetMerge)}). ${best.model} merges at ${pctStr(best.mergedRatePct)}.`,
        metric: pctStr(m.mergedRatePct),
        recommendation: `Shift work from ${m.model} to ${best.model} for this work type, or reserve ${m.model} for tasks where it performs.`,
      }, gap));
    }
  }

  if (eng.totals.runs > 0 && eng.totals.degradedRatePct >= HIGH_DEGRADED_PCT) {
    out.push(ranked({
      key: 'quality.high_degraded',
      severity: 'warning',
      category: 'quality',
      title: 'Coding-model degradation is frequent',
      detail: `${pctStr(eng.totals.degradedRatePct)} of runs were floored onto a non-coding model (degraded).`,
      metric: pctStr(eng.totals.degradedRatePct),
      recommendation: 'Raise the coding-model availability floor or pin a funded coder for critical tasks to avoid quality loss.',
    }, eng.totals.degradedRatePct));
  }

  // ── ALLOCATION ───────────────────────────────────────────────────────────────
  for (const c of inp.allocation.byCategory) {
    if (c.variancePct != null && c.variancePct <= -ALLOC_VARIANCE_PCT) {
      const below = Math.abs(c.variancePct);
      out.push(ranked({
        key: `allocation.below_target.${c.category}`,
        severity: below >= 15 ? 'warning' : 'info',
        category: 'allocation',
        title: `${c.label} allocation below target`,
        detail: `${c.label} is ${below.toFixed(0)}pts below its target (${pctStr(c.pct)} actual vs ${pctStr(c.targetPct ?? 0)} target).`,
        metric: `−${below.toFixed(0)}pts`,
        recommendation: `Re-balance the investment mix — assign more work to ${c.label} to hit the target allocation this period.`,
      }, below));
    }
  }

  if (inp.allocation.totals.costUsd > 0 && inp.allocation.totals.capitalizablePct < LOW_CAPITALIZABLE_PCT) {
    out.push(ranked({
      key: 'allocation.low_capitalizable',
      severity: 'info',
      category: 'allocation',
      title: 'Low capitalizable share of spend',
      detail: `Only ${pctStr(inp.allocation.totals.capitalizablePct)} of attributed spend is capitalizable (R&D).`,
      metric: pctStr(inp.allocation.totals.capitalizablePct),
      recommendation: 'Verify cost-class tagging — uncategorized innovation work may be understating capitalizable R&D.',
    }, LOW_CAPITALIZABLE_PCT - inp.allocation.totals.capitalizablePct));
  }

  // ── DELIVERY (DORA) ──────────────────────────────────────────────────────────
  const d = inp.dora;
  if (d.changeFailureRatePct != null && d.changeFailureRatePct >= HIGH_CFR_PCT) {
    out.push(ranked({
      key: 'delivery.high_cfr',
      severity: d.changeFailureRatePct >= 30 ? 'critical' : 'warning',
      category: 'delivery',
      title: 'High change-failure rate',
      detail: `${pctStr(d.changeFailureRatePct)} of ${d.totalDeployments} deployments failed or were rolled back.`,
      metric: pctStr(d.changeFailureRatePct),
      recommendation: 'Strengthen pre-merge CI and add deployment smoke checks; review the failing change set.',
    }, d.changeFailureRatePct));
  }
  if (d.mttrHours != null && d.mttrHours >= HIGH_MTTR_HOURS) {
    out.push(ranked({
      key: 'delivery.high_mttr',
      severity: 'warning',
      category: 'delivery',
      title: 'Slow recovery from failures (MTTR)',
      detail: `Mean time to restore is ${d.mttrHours.toFixed(1)}h — above the ${HIGH_MTTR_HOURS}h target.`,
      metric: `${d.mttrHours.toFixed(1)}h`,
      recommendation: 'Add rollback automation and on-call runbooks to shorten restore time.',
    }, Math.min(100, d.mttrHours - HIGH_MTTR_HOURS)));
  }
  if (d.leadTimeHours != null && d.leadTimeHours >= HIGH_LEAD_TIME_HOURS) {
    out.push(ranked({
      key: 'delivery.high_lead_time',
      severity: 'info',
      category: 'delivery',
      title: 'Long lead time for changes',
      detail: `Average lead time is ${(d.leadTimeHours / 24).toFixed(1)}d (task created → completed).`,
      metric: `${(d.leadTimeHours / 24).toFixed(1)}d`,
      recommendation: 'Break work into smaller tasks and reduce WIP to shorten cycle time.',
    }, Math.min(100, (d.leadTimeHours - HIGH_LEAD_TIME_HOURS) / 24)));
  }

  // Most urgent first; stable key tiebreak.
  return out.sort((a, b) => b.rank - a.rank || a.key.localeCompare(b.key));
}

/**
 * Fetch + roll up the lenses, derive recommendations, and filter out any the
 * tenant has dismissed. The prior-window finance figure is computed cheaply (the
 * previous calendar month) only for the cost anomaly check.
 */
export async function computeRecommendations(db: Db, tenantId: number, days: number): Promise<RecommendationsResult> {
  const now = Date.now();
  const period = currentPeriodMonth(now);
  const priorPeriod = previousPeriodMonth(now);
  // Finance is segment-scoped; recommendations are a tenant-wide synthesis, so we
  // pass the tenant's default segment id (empty string → whole-tenant rollup is
  // budget-line driven; the cost-per-PR figure is tenant-wide regardless).
  const segmentId = '';

  const [finance, priorFinance, engineering, allocation, dora, dismissed] = await Promise.all([
    computeFinanceInsights(db, tenantId, segmentId, period, now),
    computeFinanceInsights(db, tenantId, segmentId, priorPeriod, now).catch(() => null),
    computeEngineeringInsights(db, tenantId, days),
    computeAllocationInsights(db, tenantId, days, now),
    computeDora(db, tenantId, days),
    db.select({ recKey: recommendationDismissals.recKey })
      .from(recommendationDismissals)
      .where(eq(recommendationDismissals.tenantId, tenantId)),
  ]);

  const dismissedKeys = new Set(dismissed.map((r) => r.recKey));
  const all = deriveRecommendations({ finance, priorFinance, engineering, allocation, dora });
  return {
    windowDays: days,
    recommendations: all.filter((r) => !dismissedKeys.has(r.key)),
  };
}

/** Upsert a dismissal (idempotent on the (tenant, recKey) unique). */
export async function dismissRecommendation(db: Db, tenantId: number, recKey: string, dismissedBy: string | null): Promise<void> {
  await db.insert(recommendationDismissals)
    .values({ tenantId, recKey, dismissedBy })
    .onConflictDoNothing({ target: [recommendationDismissals.tenantId, recommendationDismissals.recKey] });
}

// ── period helpers (UTC, 'YYYY-MM') ────────────────────────────────────────────

function currentPeriodMonth(now: number): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function previousPeriodMonth(now: number): string {
  const d = new Date(now);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export { HOUR_MS };
