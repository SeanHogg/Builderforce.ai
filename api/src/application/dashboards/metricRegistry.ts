/**
 * Metric registry — the WHITELIST that makes custom dashboards + AI queries safe.
 *
 * A widget (or an NL query) never carries SQL. It carries a `metric_key` from this
 * registry; each entry knows how to COMPUTE its single scalar by calling an EXISTING
 * compute* insight/metrics service and plucking ONE field. There is no arbitrary
 * query path — the only metrics that can ever be surfaced are the ones declared here.
 *
 * Each `compute(db, tenantId, days)` returns `number | null` (null = no data / not
 * applicable in the window); the route caches the resolved values on a short TTL.
 */

import type { Db } from '../../infrastructure/database/connection';
import { computeEngineeringInsights } from '../insights/engineeringInsights';
import { computeFinanceInsights } from '../insights/financeInsights';
import { computeAllocationInsights } from '../insights/allocationInsights';
import { computeAiImpact } from '../insights/aiImpactInsights';
import { computeDora } from '../metrics/workforceMetrics';
import { computeQualityInsights } from '../insights/qualityInsights';
import { computePeopleInsights } from '../insights/peopleInsights';
import { computeRdFinancials } from '../insights/rdFinancialsInsights';

export interface MetricDef {
  /** Human label for the widget header / query answer. */
  label: string;
  /** Unit suffix for display ('USD', '%', '/day', 'hours', 'score', ''). */
  unit: string;
  /** One-line plain description used by the NL-query explanation. */
  description: string;
  /** Compute the scalar for this metric over the tenant + window. */
  compute(db: Db, tenantId: number, days: number): Promise<number | null>;
}

/** Current calendar month 'YYYY-MM' (UTC) — finance lens is month-keyed. */
function currentPeriodMonth(now: number): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * THE WHITELIST. Keys are stable, dotted `lens.metric` strings stored on widgets
 * and matched by the NL parser. Each compute calls an existing service and plucks
 * one already-computed field — no new aggregation, no SQL here.
 */
export const METRIC_REGISTRY: Record<string, MetricDef> = {
  // ── FinOps (computeFinanceInsights → totals.*) ─────────────────────────────
  'finance.spend': {
    label: 'LLM spend (month to date)',
    unit: 'USD',
    description: 'Total attributed LLM spend for the current calendar month.',
    async compute(db, tenantId) {
      const now = Date.now();
      const fin = await computeFinanceInsights(db, tenantId, '', currentPeriodMonth(now), now);
      return fin.totals.spendUsd;
    },
  },
  'finance.forecast': {
    label: 'Forecast month-end spend',
    unit: 'USD',
    description: 'Linear month-end projection of LLM spend at the current burn rate.',
    async compute(db, tenantId) {
      const now = Date.now();
      const fin = await computeFinanceInsights(db, tenantId, '', currentPeriodMonth(now), now);
      return fin.totals.forecastUsd;
    },
  },
  'finance.costPerMergedPr': {
    label: 'Cost per merged PR',
    unit: 'USD',
    description: 'Month-to-date LLM spend divided by merged runs (null until a PR merges).',
    async compute(db, tenantId) {
      const now = Date.now();
      const fin = await computeFinanceInsights(db, tenantId, '', currentPeriodMonth(now), now);
      return fin.totals.costPerMergedPrUsd;
    },
  },

  // ── DORA (computeDora → DoraRollup.*) ──────────────────────────────────────
  'dora.deployFreq': {
    label: 'Deployment frequency',
    unit: '/day',
    description: 'Average deployments per day over the window (DORA).',
    async compute(db, tenantId, days) {
      const dora = await computeDora(db, tenantId, days);
      return dora.deploymentFrequencyPerDay;
    },
  },
  'dora.leadTime': {
    label: 'Lead time for changes',
    unit: 'hours',
    description: 'Average task created→completed lead time over the window (DORA).',
    async compute(db, tenantId, days) {
      const dora = await computeDora(db, tenantId, days);
      return dora.leadTimeHours;
    },
  },
  'dora.changeFailureRate': {
    label: 'Change failure rate',
    unit: '%',
    description: 'Share of deployments flagged as failures over the window (DORA).',
    async compute(db, tenantId, days) {
      const dora = await computeDora(db, tenantId, days);
      return dora.changeFailureRatePct;
    },
  },

  // ── Engineering effectiveness (computeEngineeringInsights → totals.*) ───────
  'engineering.mergeRate': {
    label: 'AI merge rate',
    unit: '%',
    description: 'Share of AI runs that merged over the window (run effectiveness).',
    async compute(db, tenantId, days) {
      const eng = await computeEngineeringInsights(db, tenantId, days);
      return eng.totals.mergedRatePct;
    },
  },
  'engineering.avgScore': {
    label: 'AI run quality score',
    unit: 'score',
    description: 'Average per-run outcome score (0..1) over the window.',
    async compute(db, tenantId, days) {
      const eng = await computeEngineeringInsights(db, tenantId, days);
      return eng.totals.avgScore;
    },
  },

  // ── AI impact (computeAiImpact → productivity.score) ───────────────────────
  'aiImpact.productivity': {
    label: 'AI productivity score',
    unit: 'score',
    description: 'Composite AI productivity score (throughput · quality · efficiency).',
    async compute(db, tenantId, days) {
      const impact = await computeAiImpact(db, tenantId, days);
      return impact.productivity.score;
    },
  },

  // ── Investment allocation (computeAllocationInsights → totals.*) ────────────
  'allocation.capexPct': {
    label: 'Capitalizable spend',
    unit: '%',
    description: 'Capex share of LLM spend (capex / (capex + opex)) over the window.',
    async compute(db, tenantId, days) {
      const alloc = await computeAllocationInsights(db, tenantId, days, Date.now());
      return alloc.totals.capitalizablePct;
    },
  },

  // ── Quality (computeQualityInsights) ───────────────────────────────────────
  'quality.uptime': {
    label: 'Uptime',
    unit: '%',
    description: 'Average production uptime over the window (Quality slide).',
    async compute(db, tenantId, days) {
      return (await computeQualityInsights(db, tenantId, days)).uptimePct;
    },
  },
  'quality.mttr': {
    label: 'MTTR (prod incidents)',
    unit: 'hours',
    description: 'Mean time to resolve production incidents over the window.',
    async compute(db, tenantId, days) {
      return (await computeQualityInsights(db, tenantId, days)).prodIncidents.mttrHours;
    },
  },

  // ── People (computePeopleInsights) ─────────────────────────────────────────
  'people.attrition': {
    label: 'Attrition rate',
    unit: '%',
    description: 'Departures over the window relative to average headcount.',
    async compute(db, tenantId, days) {
      return (await computePeopleInsights(db, tenantId, Math.max(1, Math.round(days / 30)))).attritionRatePct;
    },
  },
  'people.devSatisfaction': {
    label: 'Developer satisfaction',
    unit: 'score',
    description: 'Mean DevEx survey score (0..100) over recent campaigns.',
    async compute(db, tenantId, days) {
      return (await computePeopleInsights(db, tenantId, Math.max(1, Math.round(days / 30)))).devSatisfaction.score;
    },
  },

  // ── R&D financials (computeRdFinancials → latest quarter) ───────────────────
  'rdFinancials.rdToRevenue': {
    label: 'Total R&D $ / Revenue',
    unit: '%',
    description: 'R&D spend as a share of revenue for the latest reported quarter.',
    async compute(db, tenantId) {
      const fy = new Date().getUTCFullYear();
      const rd = await computeRdFinancials(db, tenantId, fy);
      const last = rd.quarters[rd.quarters.length - 1];
      return last?.rdToRevenuePct ?? null;
    },
  },
};

/** The whitelisted metric keys (stable order) — drives the widget picker + parser. */
export function listMetricKeys(): string[] {
  return Object.keys(METRIC_REGISTRY);
}

/** A metric key is valid iff it is in the registry — the safety check for writes. */
export function isMetricKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(METRIC_REGISTRY, key);
}
