/**
 * LENS — Industry Benchmarking: the tenant's LIVE metric values.
 *
 * Extracted from `computeBenchmarking` so the key mapping is unit-testable
 * without a DB. Returns the seven delivery (DORA / AI) keys the lens has always
 * shown, plus the growth keys (PRD 25 §6.5) read THROUGH `METRIC_REGISTRY` — the
 * same whitelist the dashboards use — so a benchmark can never disagree with the
 * tile showing the same number.
 *
 * `null` means "Not measured" and passes through untouched; it is never coerced
 * to 0 (a tenant that has not declared NRR is not at 0% NRR).
 */

import type { Db } from '../../infrastructure/database/connection';
import { METRIC_REGISTRY } from '../dashboards/metricRegistry';

/** benchmark metric key → METRIC_REGISTRY key, for the growth/AI metrics. */
export const GROWTH_BENCHMARK_REGISTRY_KEYS = {
  nrr_pct: 'growth.nrr',
  grr_pct: 'growth.grr',
  gross_margin_pct: 'growth.grossMargin',
  cac_payback_months: 'growth.cacPayback',
  ltv_cac_ratio: 'growth.ltvCac',
  magic_number: 'growth.magicNumber',
  burn_multiple: 'growth.burnMultiple',
  logo_churn_pct_monthly: 'growth.logoChurn',
  arr_growth_pct: 'growth.arrGrowth',
  inference_margin_pct: 'ai.inferenceMarginPct',
} as const;

export type GrowthBenchmarkMetric = keyof typeof GROWTH_BENCHMARK_REGISTRY_KEYS;

/** The already-collected delivery inputs (kept as plain numbers so this stays pure). */
export interface DeliveryLiveInputs {
  /** dora.deploymentFrequencyPerDay */
  deploymentFrequencyPerDay: number;
  leadTimeHours: number | null;
  changeFailureRatePct: number | null;
  mttrHours: number | null;
  /** eng.totals.mergedRatePct */
  mergedRatePct: number | null;
  /** eng.totals.runs */
  runs: number;
  costPerMergedPrUsd: number | null;
  adoptionPct: number | null;
}

/** Reads one registry metric; injectable for tests. */
export type GrowthMetricReader = (registryKey: string) => Promise<number | null>;

/** Default reader: METRIC_REGISTRY[key].compute, null when the key is not registered. */
export function registryReader(db: Db, tenantId: number, days: number): GrowthMetricReader {
  return async (registryKey) => {
    const def = METRIC_REGISTRY[registryKey];
    if (!def) return null;
    return def.compute(db, tenantId, days);
  };
}

/** Assemble every live value the benchmarking lens can rank. */
export async function buildLiveValues(
  delivery: DeliveryLiveInputs,
  readGrowth: GrowthMetricReader,
): Promise<Record<string, number | null>> {
  const growthEntries = await Promise.all(
    (Object.entries(GROWTH_BENCHMARK_REGISTRY_KEYS) as Array<[GrowthBenchmarkMetric, string]>).map(
      async ([metric, registryKey]) => [metric, (await readGrowth(registryKey)) ?? null] as const,
    ),
  );

  return {
    deploy_freq_per_week: delivery.deploymentFrequencyPerDay * 7,
    lead_time_hours: delivery.leadTimeHours,
    change_failure_rate_pct: delivery.changeFailureRatePct,
    mttr_hours: delivery.mttrHours,
    ai_merge_rate_pct: delivery.runs > 0 ? delivery.mergedRatePct : null,
    cost_per_merged_pr_usd: delivery.costPerMergedPrUsd,
    ai_adoption_pct: delivery.adoptionPct,
    ...Object.fromEntries(growthEntries),
  };
}
