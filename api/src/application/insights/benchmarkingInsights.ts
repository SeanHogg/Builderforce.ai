/**
 * LENS — Industry Benchmarking.
 *
 * Maps a tenant's live delivery metrics onto a SEEDED industry/size-band cohort
 * distribution (percentiles p10..p90 from `industry_benchmarks`, migration 0230)
 * to produce, per metric: a percentile rank (0..100) and a rating bucket
 * (elite | high | medium | low).
 *
 * The tenant's current values reuse the existing collectors — {@link computeDora}
 * for the DORA four-keys and {@link computeEngineeringInsights} for the AI
 * effectiveness signals (merge rate, cost-per-merged-PR, adoption) — so there is
 * no new collection and the figures match the other lenses exactly.
 *
 * {@link rankPercentile} is a pure helper (interpolated against the five seeded
 * percentile anchors, direction-aware via higherIsBetter) so it is unit-testable
 * without a DB.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { industryBenchmarks, tenantBenchmarkProfiles } from '../../infrastructure/database/schema';
import { clampScore } from '../../domain/shared/numbers';
import { computeDora } from '../metrics/workforceMetrics';
import { computeEngineeringInsights } from './engineeringInsights';

export const DEFAULT_INDUSTRY = 'software_saas';
export const DEFAULT_SIZE_BAND = 'mid';

export type BenchmarkRating = 'elite' | 'high' | 'medium' | 'low';

/** The five seeded percentile anchors for one (industry, size_band, metric). */
export interface BenchmarkDistribution {
  p10: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
}

export interface BenchmarkMetric {
  metric: string;
  label: string;
  unit: string | null;
  value: number | null;
  percentile: number | null;     // 0..100, null when no value or no distribution
  rating: BenchmarkRating | null;
  p50: number | null;
  p90: number | null;
  higherIsBetter: boolean;
}

export interface BenchmarkingResult {
  industry: string;
  sizeBand: string;
  windowDays: number;
  metrics: BenchmarkMetric[];
}

/** Stable metric → human label map (i18n happens in the UI; this is a fallback). */
const METRIC_LABELS: Record<string, string> = {
  deploy_freq_per_week: 'Deployment frequency',
  lead_time_hours: 'Lead time',
  change_failure_rate_pct: 'Change failure rate',
  mttr_hours: 'Time to restore',
  ai_merge_rate_pct: 'AI merge rate',
  cost_per_merged_pr_usd: 'Cost per merged PR',
  ai_adoption_pct: 'AI adoption',
};

/** The metric order shown in the lens (DORA four-keys, then AI signals). */
export const BENCHMARK_METRICS = [
  'deploy_freq_per_week',
  'lead_time_hours',
  'change_failure_rate_pct',
  'mttr_hours',
  'ai_merge_rate_pct',
  'cost_per_merged_pr_usd',
  'ai_adoption_pct',
] as const;

function ratingForPercentile(p: number): BenchmarkRating {
  if (p >= 90) return 'elite';
  if (p >= 70) return 'high';
  if (p >= 40) return 'medium';
  return 'low';
}

/**
 * Pure: rank `value` against a five-point percentile distribution, returning a
 * 0..100 percentile. The anchors (p10..p90) are always given in the metric's
 * NATURAL direction (ascending value). When `higherIsBetter` is false (lead time,
 * CFR, MTTR, cost) the percentile is flipped so a SMALLER value scores higher.
 *
 * Interpolation is piecewise-linear between adjacent anchors; values below p10 /
 * above p90 clamp to the 5/95 tails (so an off-the-chart elite still reads ~95+).
 * Returns null when the value or the distribution is unusable.
 */
export function rankPercentile(
  value: number | null | undefined,
  dist: BenchmarkDistribution,
  higherIsBetter: boolean,
): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  // Anchor (percentile, value) pairs in ascending VALUE order.
  const anchors: Array<{ p: number; v: number }> = [];
  const push = (p: number, v: number | null) => { if (v != null && Number.isFinite(v)) anchors.push({ p, v }); };
  push(10, dist.p10); push(25, dist.p25); push(50, dist.p50); push(75, dist.p75); push(90, dist.p90);
  if (anchors.length < 2) return null;
  anchors.sort((a, b) => a.v - b.v);

  // Length >= 2 guaranteed above, so the endpoints are present.
  const first = anchors[0]!;
  const last = anchors[anchors.length - 1]!;
  let ascPercentile: number;
  if (value <= first.v) {
    // Below the lowest anchor: clamp toward the 5th-percentile tail.
    ascPercentile = Math.max(5, first.p - 5);
  } else if (value >= last.v) {
    ascPercentile = Math.min(95, last.p + 5);
  } else {
    ascPercentile = last.p;
    for (let i = 0; i < anchors.length - 1; i++) {
      const lo = anchors[i]!, hi = anchors[i + 1]!;
      if (value >= lo.v && value <= hi.v) {
        const span = hi.v - lo.v;
        const frac = span === 0 ? 0 : (value - lo.v) / span;
        ascPercentile = lo.p + frac * (hi.p - lo.p);
        break;
      }
    }
  }

  // ascPercentile = "share of the cohort with a SMALLER raw value". When higher is
  // better that IS the standing; when lower is better, invert it.
  const percentile = higherIsBetter ? ascPercentile : 100 - ascPercentile;
  return Math.round(clampScore(percentile));
}

/** Build one metric row from its live value + the seeded distribution row. */
function buildMetric(
  metric: string,
  value: number | null,
  row: {
    unit: string | null; p10: number | null; p25: number | null; p50: number | null;
    p75: number | null; p90: number | null; higherIsBetter: boolean;
  } | undefined,
): BenchmarkMetric {
  const higherIsBetter = row?.higherIsBetter ?? true;
  const dist: BenchmarkDistribution = {
    p10: row?.p10 ?? null, p25: row?.p25 ?? null, p50: row?.p50 ?? null,
    p75: row?.p75 ?? null, p90: row?.p90 ?? null,
  };
  const percentile = row ? rankPercentile(value, dist, higherIsBetter) : null;
  return {
    metric,
    label: METRIC_LABELS[metric] ?? metric,
    unit: row?.unit ?? null,
    value,
    percentile,
    rating: percentile == null ? null : ratingForPercentile(percentile),
    p50: dist.p50,
    p90: dist.p90,
    higherIsBetter,
  };
}

/**
 * Resolve the tenant's benchmark profile (industry + size band), defaulting when
 * no row exists. Exported so the route's profile GET/PATCH and the lens share one
 * default-resolution path.
 */
export async function getBenchmarkProfile(
  db: Db,
  tenantId: number,
): Promise<{ industry: string; sizeBand: string }> {
  const rows = await db
    .select({ industry: tenantBenchmarkProfiles.industry, sizeBand: tenantBenchmarkProfiles.sizeBand })
    .from(tenantBenchmarkProfiles)
    .where(eq(tenantBenchmarkProfiles.tenantId, tenantId))
    .limit(1);
  return {
    industry: rows[0]?.industry ?? DEFAULT_INDUSTRY,
    sizeBand: rows[0]?.sizeBand ?? DEFAULT_SIZE_BAND,
  };
}

/**
 * Compute the benchmarking lens for a tenant: live metric values (computeDora +
 * computeEngineeringInsights) ranked against the seeded cohort distribution for
 * the tenant's chosen (industry, size_band).
 */
export async function computeBenchmarking(
  db: Db,
  tenantId: number,
  days: number,
): Promise<BenchmarkingResult> {
  const { industry, sizeBand } = await getBenchmarkProfile(db, tenantId);

  // Seeded cohort distribution rows for this profile.
  const benchRows = await db
    .select({
      metric: industryBenchmarks.metric,
      unit: industryBenchmarks.unit,
      p10: industryBenchmarks.p10,
      p25: industryBenchmarks.p25,
      p50: industryBenchmarks.p50,
      p75: industryBenchmarks.p75,
      p90: industryBenchmarks.p90,
      higherIsBetter: industryBenchmarks.higherIsBetter,
    })
    .from(industryBenchmarks)
    .where(and(eq(industryBenchmarks.industry, industry), eq(industryBenchmarks.sizeBand, sizeBand)));
  const byMetric = new Map(benchRows.map((r) => [r.metric, r]));

  // Live tenant values from the existing collectors.
  const [dora, eng] = await Promise.all([
    computeDora(db, tenantId, days),
    computeEngineeringInsights(db, tenantId, days),
  ]);

  // AI adoption proxy: share of DORA lead-time deliveries that ran through an AI
  // approach is not directly available, so use the merged-run evidence as the
  // adoption signal — fraction of runs that merged is the merge rate; adoption is
  // the fraction of runs producing CI-green (touched) work over total runs. We
  // model adoption as the merged share scaled by run volume presence: when runs
  // exist, adoption = ciGreenRate (work AI actually carried through CI).
  const merged = eng.totals.mergedRatePct;
  const adoption = eng.totals.runs > 0 ? eng.totals.ciGreenRatePct : null;
  // Cost per merged PR: total spend / number of merged runs.
  const mergedRuns = eng.totals.runs * (eng.totals.mergedRatePct / 100);
  const costPerMergedPr = mergedRuns > 0 ? eng.totals.costUsd / mergedRuns : null;

  const liveValues: Record<string, number | null> = {
    deploy_freq_per_week: dora.deploymentFrequencyPerDay * 7,
    lead_time_hours: dora.leadTimeHours,
    change_failure_rate_pct: dora.changeFailureRatePct,
    mttr_hours: dora.mttrHours,
    ai_merge_rate_pct: eng.totals.runs > 0 ? merged : null,
    cost_per_merged_pr_usd: costPerMergedPr,
    ai_adoption_pct: adoption,
  };

  const metrics = BENCHMARK_METRICS.map((m) => buildMetric(m, liveValues[m] ?? null, byMetric.get(m)));

  return { industry, sizeBand, windowDays: days, metrics };
}
