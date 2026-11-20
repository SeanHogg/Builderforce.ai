import { describe, expect, it } from 'vitest';
import {
  buildLiveValues,
  GROWTH_BENCHMARK_REGISTRY_KEYS,
  type DeliveryLiveInputs,
} from './benchmarkLiveValues';
import { BENCHMARK_METRICS } from './benchmarkingInsights';
import { METRIC_REGISTRY } from '../dashboards/metricRegistry';

const delivery: DeliveryLiveInputs = {
  deploymentFrequencyPerDay: 2,
  leadTimeHours: 10,
  changeFailureRatePct: 5,
  mttrHours: 1,
  mergedRatePct: 80,
  runs: 4,
  costPerMergedPrUsd: 3,
  adoptionPct: 60,
};

describe('buildLiveValues', () => {
  it('maps each growth metric to its METRIC_REGISTRY key', async () => {
    const asked: string[] = [];
    const values = await buildLiveValues(delivery, async (key) => {
      asked.push(key);
      return key.length; // distinct per key
    });
    expect(GROWTH_BENCHMARK_REGISTRY_KEYS).toEqual({
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
    });
    expect(asked.sort()).toEqual(Object.values(GROWTH_BENCHMARK_REGISTRY_KEYS).sort());
    for (const [metric, regKey] of Object.entries(GROWTH_BENCHMARK_REGISTRY_KEYS)) {
      expect(values[metric]).toBe(regKey.length);
    }
  });

  it('keeps the seven delivery keys', async () => {
    const values = await buildLiveValues(delivery, async () => null);
    expect(values).toMatchObject({
      deploy_freq_per_week: 14,
      lead_time_hours: 10,
      change_failure_rate_pct: 5,
      mttr_hours: 1,
      ai_merge_rate_pct: 80,
      cost_per_merged_pr_usd: 3,
      ai_adoption_pct: 60,
    });
  });

  it('passes null through as null, never 0', async () => {
    const values = await buildLiveValues({ ...delivery, runs: 0, leadTimeHours: null }, async () => null);
    for (const metric of Object.keys(GROWTH_BENCHMARK_REGISTRY_KEYS)) {
      expect(values[metric]).toBeNull();
    }
    expect(values.ai_merge_rate_pct).toBeNull();
    expect(values.lead_time_hours).toBeNull();
  });

  it('preserves a genuine 0 from the registry', async () => {
    const values = await buildLiveValues(delivery, async () => 0);
    expect(values.nrr_pct).toBe(0);
  });

  it('every mapped registry key exists and is listed in BENCHMARK_METRICS', () => {
    for (const [metric, regKey] of Object.entries(GROWTH_BENCHMARK_REGISTRY_KEYS)) {
      expect(METRIC_REGISTRY[regKey], regKey).toBeDefined();
      expect(BENCHMARK_METRICS as readonly string[]).toContain(metric);
    }
  });
});
