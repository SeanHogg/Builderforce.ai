/**
 * The runway report (PRD 19 B1) — BurnRateOS's Runway Tracker and Cashflow
 * Visualizer, as ONE read with two provenances named side by side.
 *
 * ── TWO SOURCES, NEVER BLENDED ───────────────────────────────────────────────
 *   • OBSERVED — the `finance.*` metric facts the rollup writes from approved
 *     expenses, processed payroll and synced ledgers (`kernel/rollups/finance.ts`).
 *     Monthly buckets, tenant-wide. Present only once a tenant has spend or a
 *     connected book; absent for a company that has typed nothing in and connected
 *     nothing — which is most companies on day one.
 *   • DECLARED — what the founder said in onboarding (`companies.cash_on_hand`,
 *     `monthly_budget`, `monthly_revenue`, stamped `finance_declared_at`), and the
 *     runway and cashflow PROJECTION computed from it by the shared formula.
 *
 * BurnRateOS showed one runway figure and the reader could not tell whether it
 * came from a bank feed or a form. The report carries both, labelled, and the
 * surface renders the label — the Claim-to-Proof rule the fundraising pack
 * already applies to its `grounding`.
 *
 * ── CACHED, ON TWO TOKENS ────────────────────────────────────────────────────
 * The declared side changes when a founder saves; the observed side changes when
 * the daily rollup runs. `runwayCache.ts` folds both tokens into the key.
 */

import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import {
  computeRunway,
  monthKey,
  projectCashflow,
  type CashflowPoint,
  type DeclaredFinance,
  type RunwayVerdict,
} from '@builderforce/creation-canvas-contract';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { companies, metricFacts } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getCacheVersion, getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import {
  FINANCE_ROLLUP_VERSION_KEY,
  RUNWAY_REPORT_TTL_SECONDS,
  runwayReportCacheKey,
  runwayVersionKey,
} from './runwayCache';

/** How many months of observed history the report carries. */
export const REPORT_MONTHS = 12;
/** How far the declared projection looks ahead. */
export const PROJECTION_MONTHS = 12;

const OBSERVED_METRICS = ['finance.burn', 'finance.revenue', 'finance.cash', 'finance.mrr', 'finance.runway_months', 'finance.monthly_burn'] as const;
type ObservedMetric = (typeof OBSERVED_METRICS)[number];

export interface ObservedMonth {
  month: string;
  burn: number | null;
  revenue: number | null;
  cash: number | null;
  mrr: number | null;
}

export interface ObservedFinance {
  available: boolean;
  monthlyBurn: number | null;
  runwayMonths: number | null;
  cash: number | null;
  mrr: number | null;
  asOf: string | null;
  months: ObservedMonth[];
  /** The observed series folded into the cashflow shape the visualizer draws. */
  cashflow: CashflowPoint[];
}

export interface DeclaredReport {
  companyId: number;
  companyName: string;
  finance: DeclaredFinance;
  runway: RunwayVerdict | null;
  /** Where the balance goes at the declared burn, month by month. */
  projection: CashflowPoint[];
}

export interface RunwayReport {
  observed: ObservedFinance;
  /** Null when the tenant has no company yet, or the requested one is not theirs. */
  declared: DeclaredReport | null;
  /** The companies the picker offers — id and name only. */
  companies: Array<{ id: number; name: string; declaredAt: string | null }>;
}

export async function runwayReport(db: Db, env: Env | undefined, tenantId: number, companyId: number | null): Promise<RunwayReport> {
  const load = () => loadRunwayReport(db, tenantId, companyId);
  if (!env) return load();
  const [tenantVersion, rollupVersion] = await Promise.all([
    getCacheVersion(env, runwayVersionKey(tenantId)),
    getCacheVersion(env, FINANCE_ROLLUP_VERSION_KEY),
  ]);
  return getOrSetCached(env, runwayReportCacheKey(tenantVersion, rollupVersion, tenantId, companyId), load, { kvTtlSeconds: RUNWAY_REPORT_TTL_SECONDS });
}

async function loadRunwayReport(db: Db, tenantId: number, companyId: number | null): Promise<RunwayReport> {
  const [observed, companyRows] = await Promise.all([
    loadObserved(db, tenantId),
    db
      .select({
        id: companies.id,
        name: companies.name,
        cashOnHand: companies.cashOnHand,
        monthlyBudget: companies.monthlyBudget,
        monthlyRevenue: companies.monthlyRevenue,
        teamCost: companies.teamCost,
        financeDeclaredAt: companies.financeDeclaredAt,
      })
      .from(companies)
      .where(scopedToTenant(companies, tenantId))
      .orderBy(desc(companies.financeDeclaredAt), desc(companies.updatedAt))
      .limit(50),
  ]);

  // The requested company when it is the tenant's own; otherwise the one most
  // recently declared — a picker with nothing chosen should still show something.
  const chosen = (companyId != null ? companyRows.find((row) => row.id === companyId) : undefined) ?? companyRows[0];
  let declared: DeclaredReport | null = null;
  if (chosen) {
    const finance: DeclaredFinance = {
      cashOnHand: num(chosen.cashOnHand),
      monthlyBudget: num(chosen.monthlyBudget),
      monthlyRevenue: num(chosen.monthlyRevenue),
      teamCost: num(chosen.teamCost),
      declaredAt: chosen.financeDeclaredAt ? chosen.financeDeclaredAt.toISOString() : null,
    };
    const has = finance.declaredAt != null;
    declared = {
      companyId: chosen.id,
      companyName: chosen.name,
      finance,
      runway: has ? computeRunway(finance) : null,
      projection: has ? projectCashflow(finance, PROJECTION_MONTHS) : [],
    };
  }

  return {
    observed,
    declared,
    companies: companyRows.map((row) => ({
      id: row.id,
      name: row.name,
      declaredAt: row.financeDeclaredAt ? row.financeDeclaredAt.toISOString() : null,
    })),
  };
}

const num = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * The observed side: the tenant-wide, undimensioned monthly facts for the last
 * `REPORT_MONTHS`, pivoted into one row per month. One query; the pivot is in
 * memory because the row count is bounded (six metrics × twelve months).
 */
async function loadObserved(db: Db, tenantId: number): Promise<ObservedFinance> {
  const since = new Date();
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCMonth(since.getUTCMonth() - (REPORT_MONTHS - 1));

  const rows = await db
    .select({
      metric: metricFacts.metric,
      bucketAt: metricFacts.bucketAt,
      value: metricFacts.value,
      computedAt: metricFacts.computedAt,
    })
    .from(metricFacts)
    .where(and(
      scopedToTenant(metricFacts, tenantId, eq(metricFacts.bucket, 'month')),
      eq(metricFacts.dimensionKey, ''),
      inArray(metricFacts.metric, [...OBSERVED_METRICS]),
      gte(metricFacts.bucketAt, since),
    ))
    .orderBy(desc(metricFacts.bucketAt));

  return pivotObserved(rows.map((row) => ({
    metric: row.metric as ObservedMetric,
    bucketAt: row.bucketAt,
    value: Number(row.value),
    computedAt: row.computedAt,
  })));
}

/** Pure, so the pivot is testable without a database. Exported for that reason. */
export function pivotObserved(rows: Array<{ metric: ObservedMetric; bucketAt: Date; value: number; computedAt: Date | null }>): ObservedFinance {
  if (rows.length === 0) {
    return { available: false, monthlyBurn: null, runwayMonths: null, cash: null, mrr: null, asOf: null, months: [], cashflow: [] };
  }
  const byMonth = new Map<string, ObservedMonth>();
  const latest: Partial<Record<ObservedMetric, number>> = {};
  let asOf: Date | null = null;
  for (const row of rows) {
    if (!Number.isFinite(row.value)) continue;
    const key = monthKey(row.bucketAt);
    const month = byMonth.get(key) ?? { month: key, burn: null, revenue: null, cash: null, mrr: null };
    if (row.metric === 'finance.burn') month.burn = row.value;
    if (row.metric === 'finance.revenue') month.revenue = row.value;
    if (row.metric === 'finance.cash') month.cash = row.value;
    if (row.metric === 'finance.mrr') month.mrr = row.value;
    byMonth.set(key, month);
    // Rows arrive newest-first, so the first sighting of a metric is its latest.
    if (latest[row.metric] === undefined) latest[row.metric] = row.value;
    const at = row.computedAt ?? row.bucketAt;
    if (!asOf || at > asOf) asOf = at;
  }
  const months = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  const cashflow: CashflowPoint[] = months.map((m) => ({
    month: m.month,
    inflows: m.revenue ?? 0,
    outflows: m.burn ?? 0,
    net: (m.revenue ?? 0) - (m.burn ?? 0),
    endingBalance: m.cash ?? 0,
  }));
  return {
    available: true,
    monthlyBurn: latest['finance.monthly_burn'] ?? latest['finance.burn'] ?? null,
    runwayMonths: latest['finance.runway_months'] ?? null,
    cash: latest['finance.cash'] ?? null,
    mrr: latest['finance.mrr'] ?? null,
    asOf: asOf ? asOf.toISOString() : null,
    months,
    cashflow,
  };
}
