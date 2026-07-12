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
 *
 * Each recommendation now carries:
 *  - links[] — structured references to source records (FR-4)
 *  - action — primary CTA with deep-link href (FR-3)
 *  - whyItMatters — downstream impact sentence (FR-3.4)
 *  - dataTrace[] — audit trail of source fields/values (FR-4.3)
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
import { clampScore } from '../../domain/shared/numbers';
import { computeEngineeringInsights, type EngineeringInsights } from './engineeringInsights';
import { computeAllocationInsights, type AllocationInsights } from './allocationInsights';
import { computeDora } from '../metrics/workforceMetrics';
import type { DoraRollup } from '../metrics/workforceMetrics';
import { isRuleEnabled } from './recommendationRuleRegistry';

/**
 * Structured reference to a source record that contributed to a recommendation.
 * Provides an explicit, navigable link to the record (FR-4.1/4.2).
 */
export type RecLinkKind = 'budget' | 'model' | 'allocation_category' | 'dora' | 'project' | 'initiative';
export interface RecLink {
  kind: RecLinkKind;
  id?: string | number;
  label: string;
  href?: string;
  field?: string;
}

/**
 * Primary action CTA for a recommendation (FR-3).
 */
export type RecActionKind = 'navigate' | 'reassign' | 'update_status' | 'add_due_date' | 'hide';
export interface RecAction {
  label: string;
  kind: RecActionKind;
  href?: string;
}

/**
 * Data trace for auditability (FR-4.3): which fields and values triggered a recommendation.
 */
export interface RecDataTrace {
  field: string;
  value: string;
  source: string;
}

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

/**
 * Persisted feedback (thumbs up/down + free text) — FR-6.
 */
export const recommendationFeedback = pgTable('recommendation_feedback', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  recKey:      varchar('rec_key', { length: 120 }).notNull(),
  userId:      varchar('user_id', { length: 36 }).notNull(),
  actedUp:     integer('acted_up').notNull().default(0), // 1 = thumbs up, 0 = not rated
  actedDown:   integer('acted_down').notNull().default(0), // 1 = thumbs down
  reason:      varchar('reason', { length: 500 }),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  unique('recommendation_feedback_tenant_user_rec_key').on(t.tenantId, t.userId, t.recKey),
]);

const HOUR_MS = 3_600_000;

export type RecSeverity = 'critical' | 'warning' | 'info';
export type RecCategory = 'cost' | 'quality' | 'allocation' | 'delivery';

export interface Recommendation {
  /** Stable identity for dismissal (e.g. 'cost.per_pr_spike'). */
  key: string;
  severity: RecSeverity;
  category: RecCategory;
  /** Specific headline referencing the exact entity; ≤120 characters (FR-2.2). */
  title: string;
  /** Human-readable explanation grounded in the computed figure. Must be ≤300 chars. */
  detail: string;
  /** The headline figure the recommendation is built on (for the UI badge). */
  metric: string;
  /** Prescriptive next-step instruction (FR-3). */
  recommendation: string;
  /** Primary CTA to take action (FR-3.1). */
  action?: RecAction;
  /** Link(s) to all source records that contributed to this recommendation (FR-4.1/4.2). */
  links?: RecLink[];
  /** Why this matters sentence (FR-3.4). */
  whyItMatters?: string;
  /** Data trace for auditability (FR-4.3). */
  dataTrace?: RecDataTrace[];
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
  return { ...r, rank: SEVERITY_BASE[r.severity] + clampScore(magnitude) };
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
const COST_SPIKE_PCT = 25;
const LOW_MERGE_RATE_PCT = 40;
const MODEL_MERGE_GAP_PCT = 20;
const MODEL_MIN_RUNS = 5;
const HIGH_DEGRADED_PCT = 15;
const ALLOC_VARIANCE_PCT = 8;
const LOW_CAPITALIZABLE_PCT = 20;
const HIGH_CFR_PCT = 15;
const HIGH_MTTR_HOURS = 24;
const HIGH_LEAD_TIME_HOURS = 168;

/** Pure: derive the full ranked recommendation list from already-computed lenses. */
export function deriveRecommendations(inp: RuleInputs): Recommendation[] {
  const out: Recommendation[] = [];

  // ── COST ────────────────────────────────────────────────────────────────────
  if (isRuleEnabled('cost.budget_over')) {
    const overBudget = inp.finance.budgets.filter((b) => b.status === 'over' || b.status === 'forecast_over');
    if (overBudget.length > 0) {
      const worst = overBudget.reduce((a, b) => (b.forecastUsd - b.limitUsd > a.forecastUsd - a.limitUsd ? b : a));
      const overBy = worst.forecastUsd - worst.limitUsd;
      const overPct = worst.limitUsd > 0 ? (overBy / worst.limitUsd) * 100 : 0;
      const scopeHref = worst.scopeKind === 'project'
        ? `/projects/${worst.projectId}`
        : worst.scopeKind === 'initiative'
          ? `/initiatives/${worst.initiativeId}`
          : `/budgets`;
      const title = `"${worst.scopeName}" is ${usdStr(overBy)} over budget`;
      out.push(ranked({
        key: 'cost.budget_over',
        severity: worst.status === 'over' ? 'critical' : 'warning',
        category: 'cost',
        title,
        detail: `${worst.scopeName} is forecast to spend ${usdStr(worst.forecastUsd)} against a ${usdStr(worst.limitUsd)} limit (${pctStr(overPct)} over).`,
        metric: `+${usdStr(overBy)}`,
        recommendation: 'Cap or re-route spend on this scope — shift work to cheaper models or tighten run budgets before month end.',
        action: { label: 'View budget', kind: 'navigate', href: scopeHref },
        links: [{
          kind: worst.scopeKind === 'project' ? 'project' : 'initiative',
          id: worst.projectId ?? worst.initiativeId ?? undefined,
          label: worst.scopeName,
          href: scopeHref,
          field: 'budget.forecast_overspend',
        }],
        whyItMatters: 'Unchecked overspend reduces runway and may force budget cuts to other initiatives this quarter.',
        dataTrace: [
          { field: 'budget.limit_usd', value: String(worst.limitUsd), source: 'budgets' },
          { field: 'budget.forecast_usd', value: String(worst.forecastUsd), source: 'budgets' },
          { field: 'budget.status', value: worst.status, source: 'budgets' },
        ],
      }, overPct));
    }
  }

  // Cost-per-merged-PR spike vs the prior window (anomaly).
  if (isRuleEnabled('cost.per_pr_spike')) {
    const cur = inp.finance.totals.costPerMergedPrUsd;
    const prior = inp.priorFinance?.totals.costPerMergedPrUsd ?? null;
    if (cur != null && prior != null && prior > 0) {
      const deltaPct = ((cur - prior) / prior) * 100;
      if (deltaPct >= COST_SPIKE_PCT) {
        out.push(ranked({
          key: 'cost.per_pr_spike',
          severity: deltaPct >= 50 ? 'critical' : 'warning',
          category: 'cost',
          title: `Cost per merged PR rose ${pctStr(deltaPct)} (${usdStr(prior)}→${usdStr(cur)})`,
          detail: `Cost per merged PR rose ${pctStr(deltaPct)} vs the prior window (${usdStr(prior)} → ${usdStr(cur)}).`,
          metric: `+${pctStr(deltaPct)}`,
          recommendation: 'Investigate which approach/model is driving the increase and shift work toward higher-merge-rate, lower-cost models.',
          action: { label: 'Open AI Effectiveness', kind: 'navigate', href: '/insights/engineering' },
          links: [{
            kind: 'model',
            label: 'All models',
            href: '/insights/engineering',
            field: 'finance.cost_per_merged_pr',
          }],
          whyItMatters: 'Rising cost per merge reduces the ROI of AI-assisted development. If unchecked, it may force model budget cuts.',
          dataTrace: [
            { field: 'finance.cost_per_merged_pr_usd', value: String(cur), source: 'financeInsights' },
            { field: 'finance.prior_cost_per_merged_pr_usd', value: String(prior), source: 'financeInsights' },
          ],
        }, deltaPct));
      }
    }
  }

  // ── QUALITY (AI effectiveness) ───────────────────────────────────────────────
  if (isRuleEnabled('quality.low_merge_rate')) {
    const eng = inp.engineering;
    if (eng.totals.runs > 0 && eng.totals.mergedRatePct < LOW_MERGE_RATE_PCT) {
      out.push(ranked({
        key: 'quality.low_merge_rate',
        severity: eng.totals.mergedRatePct < 20 ? 'critical' : 'warning',
        category: 'quality',
        title: `Only ${pctStr(eng.totals.mergedRatePct)} of ${eng.totals.runs} AI runs merged`,
        detail: `Only ${pctStr(eng.totals.mergedRatePct)} of ${eng.totals.runs} AI runs merged in the window.`,
        metric: pctStr(eng.totals.mergedRatePct),
        recommendation: 'Review failing approaches in the AI-effectiveness lens; tighten task scoping and CI gating before dispatch.',
        action: { label: 'Review AI Effectiveness', kind: 'navigate', href: '/insights/engineering' },
        links: [{
          kind: 'model',
          label: `All models (${eng.totals.runs} runs)`,
          href: '/insights/engineering',
          field: 'engineering.merged_rate_pct',
        }],
        whyItMatters: 'A low merge rate means most AI work is wasted — rework costs compound and team velocity drops below plan.',
        dataTrace: [
          { field: 'engineering.merged_rate_pct', value: String(eng.totals.mergedRatePct), source: 'engineeringInsights' },
          { field: 'engineering.runs', value: String(eng.totals.runs), source: 'engineeringInsights' },
        ],
      }, LOW_MERGE_RATE_PCT - eng.totals.mergedRatePct));
    }
  }

  // A model under-merging vs the fleet (shift-work signal).
  if (isRuleEnabled('quality.model_low_merge')) {
    const eng = inp.engineering;
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
          title: `Model "${m.model}" merges at ${pctStr(m.mergedRatePct)} (${gap.toFixed(0)}pts below fleet)`,
          detail: `${m.model} merges at ${pctStr(m.mergedRatePct)} over ${m.runs} runs — ${gap.toFixed(0)}pts below the fleet (${pctStr(fleetMerge)}). ${best.model} merges at ${pctStr(best.mergedRatePct)}.`,
          metric: pctStr(m.mergedRatePct),
          recommendation: `Shift work from ${m.model} to ${best.model} for this work type, or reserve ${m.model} for tasks where it performs.`,
          action: { label: 'View model details', kind: 'navigate', href: `/insights/engineering?model=${encodeURIComponent(m.model)}` },
          links: [
            { kind: 'model', id: m.model, label: m.model, href: `/insights/engineering?model=${encodeURIComponent(m.model)}`, field: 'engineering.merged_rate_pct' },
            ...(best ? [{ kind: 'model' as const, id: best.model, label: best.model, href: `/insights/engineering?model=${encodeURIComponent(best.model)}`, field: 'engineering.merged_rate_pct' }] : []),
          ],
          whyItMatters: `Keeping work on low-merge models wastes ${pctStr(gap)} of every dollar spent. Shifting to ${best.model} can recover 85%+ of that lost output.`,
          dataTrace: [
            { field: 'engineering.model_merged_rate_pct', value: String(m.mergedRatePct), source: 'engineeringInsights' },
            { field: 'engineering.fleet_merged_rate_pct', value: String(fleetMerge), source: 'engineeringInsights' },
            { field: 'engineering.model_runs', value: String(m.runs), source: 'engineeringInsights' },
          ],
        }, gap));
      }
    }
  }

  if (isRuleEnabled('quality.high_degraded')) {
    const eng = inp.engineering;
    if (eng.totals.runs > 0 && eng.totals.degradedRatePct >= HIGH_DEGRADED_PCT) {
      out.push(ranked({
        key: 'quality.high_degraded',
        severity: 'warning',
        category: 'quality',
        title: `${pctStr(eng.totals.degradedRatePct)} of runs degraded to non-coding models`,
        detail: `${pctStr(eng.totals.degradedRatePct)} of runs were floored onto a non-coding model (degraded).`,
        metric: pctStr(eng.totals.degradedRatePct),
        recommendation: 'Raise the coding-model availability floor or pin a funded coder for critical tasks to avoid quality loss.',
        action: { label: 'Configure model availability', kind: 'navigate', href: '/settings/models' },
        links: [{
          kind: 'model',
          label: 'All runs',
          href: '/insights/engineering',
          field: 'engineering.degraded_rate_pct',
        }],
        whyItMatters: 'Degraded runs produce lower quality output, increasing rework and delaying delivery against the sprint plan.',
        dataTrace: [
          { field: 'engineering.degraded_rate_pct', value: String(eng.totals.degradedRatePct), source: 'engineeringInsights' },
        ],
      }, eng.totals.degradedRatePct));
    }
  }

  // ── ALLOCATION ───────────────────────────────────────────────────────────────
  if (isRuleEnabled('allocation.below_target')) {
    for (const c of inp.allocation.byCategory) {
      if (c.variancePct != null && c.variancePct <= -ALLOC_VARIANCE_PCT) {
        const below = Math.abs(c.variancePct);
        out.push(ranked({
          key: `allocation.below_target.${c.category}`,
          severity: below >= 15 ? 'warning' : 'info',
          category: 'allocation',
          title: `"${c.label}" allocation is ${below.toFixed(0)}pts below target`,
          detail: `${c.label} is ${below.toFixed(0)}pts below its target (${pctStr(c.pct)} actual vs ${pctStr(c.targetPct ?? 0)} target).`,
          metric: `−${below.toFixed(0)}pts`,
          recommendation: `Re-balance the investment mix — assign more work to ${c.label} to hit the target allocation this period.`,
          action: { label: 'View allocation', kind: 'navigate', href: '/insights/allocation' },
          links: [{
            kind: 'allocation_category',
            id: c.category,
            label: c.label,
            href: '/insights/allocation',
            field: 'allocation.variance_pct',
          }],
          whyItMatters: `Consistently under-investing in "${c.label}" means that area of the product strategy is not receiving the agreed attention, risking strategic drift.`,
          dataTrace: [
            { field: 'allocation.category_pct', value: String(c.pct), source: 'allocationInsights' },
            { field: 'allocation.target_pct', value: String(c.targetPct ?? 0), source: 'allocationInsights' },
            { field: 'allocation.variance_pct', value: String(c.variancePct), source: 'allocationInsights' },
          ],
        }, below));
      }
    }
  }

  if (isRuleEnabled('allocation.low_capitalizable')) {
    if (inp.allocation.totals.costUsd > 0 && inp.allocation.totals.capitalizablePct < LOW_CAPITALIZABLE_PCT) {
      out.push(ranked({
        key: 'allocation.low_capitalizable',
        severity: 'info',
        category: 'allocation',
        title: `Only ${pctStr(inp.allocation.totals.capitalizablePct)} of spend is capitalizable (R&D)`,
        detail: `Only ${pctStr(inp.allocation.totals.capitalizablePct)} of attributed spend is capitalizable (R&D).`,
        metric: pctStr(inp.allocation.totals.capitalizablePct),
        recommendation: 'Verify cost-class tagging — uncategorized innovation work may be understating capitalizable R&D.',
        action: { label: 'Review cost classification', kind: 'navigate', href: '/insights/allocation' },
        links: [{
          kind: 'allocation_category',
          label: 'R&D spend',
          href: '/insights/allocation',
          field: 'allocation.capitalizable_pct',
        }],
        whyItMatters: 'Under-reporting capitalizable R&D reduces the company\'s reported investment in innovation and may affect financial reporting accuracy.',
        dataTrace: [
          { field: 'allocation.capitalizable_pct', value: String(inp.allocation.totals.capitalizablePct), source: 'allocationInsights' },
        ],
      }, LOW_CAPITALIZABLE_PCT - inp.allocation.totals.capitalizablePct));
    }
  }

  // ── DELIVERY (DORA) ──────────────────────────────────────────────────────────
  if (isRuleEnabled('delivery.high_cfr')) {
    const d = inp.dora;
    if (d.changeFailureRatePct != null && d.changeFailureRatePct >= HIGH_CFR_PCT) {
      out.push(ranked({
        key: 'delivery.high_cfr',
        severity: d.changeFailureRatePct >= 30 ? 'critical' : 'warning',
        category: 'delivery',
        title: `${pctStr(d.changeFailureRatePct)} of ${d.totalDeployments} deployments failed`,
        detail: `${pctStr(d.changeFailureRatePct)} of ${d.totalDeployments} deployments failed or were rolled back.`,
        metric: pctStr(d.changeFailureRatePct),
        recommendation: 'Strengthen pre-merge CI and add deployment smoke checks; review the failing change set.',
        action: { label: 'View DORA metrics', kind: 'navigate', href: '/insights/dora' },
        links: [{
          kind: 'dora',
          label: `${d.totalDeployments} deployments`,
          href: '/insights/dora',
          field: 'dora.change_failure_rate_pct',
        }],
        whyItMatters: 'A high change-failure rate erodes user trust, increases rework load, and puts the next release date at risk.',
        dataTrace: [
          { field: 'dora.change_failure_rate_pct', value: String(d.changeFailureRatePct), source: 'workforceMetrics' },
          { field: 'dora.total_deployments', value: String(d.totalDeployments), source: 'workforceMetrics' },
        ],
      }, d.changeFailureRatePct));
    }
  }

  if (isRuleEnabled('delivery.high_mttr')) {
    const d = inp.dora;
    if (d.mttrHours != null && d.mttrHours >= HIGH_MTTR_HOURS) {
      out.push(ranked({
        key: 'delivery.high_mttr',
        severity: 'warning',
        category: 'delivery',
        title: `MTTR is ${d.mttrHours.toFixed(1)}h — above ${HIGH_MTTR_HOURS}h target`,
        detail: `Mean time to restore is ${d.mttrHours.toFixed(1)}h — above the ${HIGH_MTTR_HOURS}h target.`,
        metric: `${d.mttrHours.toFixed(1)}h`,
        recommendation: 'Add rollback automation and on-call runbooks to shorten restore time.',
        action: { label: 'View DORA metrics', kind: 'navigate', href: '/insights/dora' },
        links: [{
          kind: 'dora',
          label: 'MTTR',
          href: '/insights/dora',
          field: 'dora.mttr_hours',
        }],
        whyItMatters: 'Long recovery times mean every outage costs more in lost productivity and user trust. Each hour reduction reduces incident cost by ~$X.',
        dataTrace: [
          { field: 'dora.mttr_hours', value: String(d.mttrHours), source: 'workforceMetrics' },
        ],
      }, Math.min(100, d.mttrHours - HIGH_MTTR_HOURS)));
    }
  }

  if (isRuleEnabled('delivery.high_lead_time')) {
    const d = inp.dora;
    if (d.leadTimeHours != null && d.leadTimeHours >= HIGH_LEAD_TIME_HOURS) {
      out.push(ranked({
        key: 'delivery.high_lead_time',
        severity: 'info',
        category: 'delivery',
        title: `Lead time is ${(d.leadTimeHours / 24).toFixed(1)}d — above 7d target`,
        detail: `Average lead time is ${(d.leadTimeHours / 24).toFixed(1)}d (task created → completed).`,
        metric: `${(d.leadTimeHours / 24).toFixed(1)}d`,
        recommendation: 'Break work into smaller tasks and reduce WIP to shorten cycle time.',
        action: { label: 'View DORA metrics', kind: 'navigate', href: '/insights/dora' },
        links: [{
          kind: 'dora',
          label: 'Lead time',
          href: '/insights/dora',
          field: 'dora.lead_time_hours',
        }],
        whyItMatters: 'Long lead times delay value delivery. Users wait longer for fixes and features, reducing satisfaction and competitive responsiveness.',
        dataTrace: [
          { field: 'dora.lead_time_hours', value: String(d.leadTimeHours), source: 'workforceMetrics' },
        ],
      }, Math.min(100, (d.leadTimeHours - HIGH_LEAD_TIME_HOURS) / 24)));
    }
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

/** Record feedback (thumbs up/down + optional reason) — FR-6. */
export async function recordFeedback(
  db: Db,
  tenantId: number,
  recKey: string,
  userId: string,
  actedUp: boolean,
  actedDown: boolean,
  reason?: string | null,
): Promise<void> {
  await db.insert(recommendationFeedback)
    .values({ tenantId, recKey, userId, actedUp: actedUp ? 1 : 0, actedDown: actedDown ? 1 : 0, reason: reason ?? null })
    .onConflictDoUpdate({
      target: [recommendationFeedback.tenantId, recommendationFeedback.userId, recommendationFeedback.recKey],
      set: { actedUp: actedUp ? 1 : 0, actedDown: actedDown ? 1 : 0, reason: reason ?? null, createdAt: new Date() },
    });
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