/**
 * The impact of a finding, from the site's own data (PRD 33 §5.1.2) — pure.
 *
 *   impact = affected × (conversion WITHOUT the finding − conversion WITH it)
 *
 * projected to a 30-day horizon, with a range from the Wilson interval of BOTH
 * cohorts (the pessimistic end pairs the low "without" with the high "with"). Below
 * {@link MIN_COHORT_VISITS} visits in either cohort the point estimate is withheld
 * and the confidence is `low`: a small cohort's difference is noise with a number
 * on it, and a ranked list that promised one would be lying.
 */

import type { ReplayImpactDto } from '@builderforce/interaction-contract';
import { wilsonInterval } from '@seanhogg/builderforce-memory/stats';
import type { Finding, ImpactCohorts } from './types';

/** The Wilson score interval (95% by default; [0, 1] when n is 0): builderforce-memory's ONE (PRD 41 D13). */
export { wilsonInterval };

export const IMPACT_HORIZON_DAYS = 30;
/** Fewer visits than this in either cohort → no point estimate, low confidence. */
export const MIN_COHORT_VISITS = 100;
/** Both cohorts at least this large AND an interval clear of zero → high confidence. */
export const HIGH_CONFIDENCE_VISITS = 1_000;

const round1 = (n: number): number => Math.round(n * 10) / 10;

const rate = (c: { visits: number; conversions: number }): number => (c.visits > 0 ? c.conversions / c.visits : 0);

/** The impact range of a finding over a window of `windowDays`, projected to 30 days. */
export function estimateImpact(
  finding: Pick<Finding, 'affected'>,
  cohorts: ImpactCohorts | null,
  windowDays: number,
): ReplayImpactDto {
  const base = { unit: 'conversions', horizonDays: IMPACT_HORIZON_DAYS } as const;
  if (!cohorts) {
    return { ...base, estimate: null, low: null, high: null, confidence: 'low', estimated: false };
  }
  const scale = IMPACT_HORIZON_DAYS / Math.max(1, windowDays);
  const affected = Math.max(0, finding.affected) * scale;
  const withI = wilsonInterval(cohorts.with.conversions, cohorts.with.visits);
  const withoutI = wilsonInterval(cohorts.without.conversions, cohorts.without.visits);
  const low = round1(affected * (withoutI.low - withI.high));
  const high = round1(affected * (withoutI.high - withI.low));
  const small = cohorts.with.visits < MIN_COHORT_VISITS || cohorts.without.visits < MIN_COHORT_VISITS;
  if (small) {
    return { ...base, estimate: null, low, high, confidence: 'low', estimated: cohorts.estimated };
  }
  const estimate = round1(affected * (rate(cohorts.without) - rate(cohorts.with)));
  const big = cohorts.with.visits >= HIGH_CONFIDENCE_VISITS && cohorts.without.visits >= HIGH_CONFIDENCE_VISITS;
  return {
    ...base,
    estimate,
    low,
    high,
    confidence: big && low > 0 ? 'high' : 'medium',
    estimated: cohorts.estimated,
  };
}

/**
 * Visits per arm an A/B test needs to see the finding's effect (≈80% power, 5%
 * two-sided): 16·p(1−p)/δ², with p the conversion without the finding and δ the
 * difference the cohorts show. Clamped to [200, 50 000]; 1 000 when unknown.
 */
export function minimumSampleFor(cohorts: ImpactCohorts | null): number {
  if (!cohorts || cohorts.without.visits <= 0 || cohorts.with.visits <= 0) return 1_000;
  const p = rate(cohorts.without);
  const delta = Math.abs(p - rate(cohorts.with));
  if (p <= 0 || p >= 1 || delta <= 0) return 1_000;
  return Math.min(50_000, Math.max(200, Math.ceil((16 * p * (1 - p)) / (delta * delta))));
}
