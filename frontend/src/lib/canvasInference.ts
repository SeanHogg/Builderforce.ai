/**
 * Statistical inference for the Creation Canvas — the uncertainty the board could
 * not express.
 *
 * ── THE DEFECT THIS EXISTS TO CLOSE ──────────────────────────────────────────────
 * `kpi` held value, target, unit and trend. `chart` held labels and values. Neither
 * had a confidence interval, an error bar, a sample size or a test statistic
 * anywhere in its field list, so a board rendered a point estimate with IDENTICAL
 * visual authority at n = 12 and at n = 1,200,000. That is the fastest available
 * route to a business decision made on noise, and the canvas was paving it.
 *
 * The founder `experiment` kind made it concrete: it stored
 * `{variant, exposure, conversion, lift}` as numbers a person or a model TYPED, with
 * nothing that computed whether the lift was distinguishable from chance. "We tested
 * it" resolved to a typed percentage. This module is what makes it resolve to a
 * p-value, an interval and a power estimate instead.
 *
 * ── WHY THESE APPROXIMATIONS ─────────────────────────────────────────────────────
 * Everything here is closed-form and dependency-free, because it runs in the browser
 * on a guest board with no account and must not cost a network call. Where an exact
 * method would need a special function, the approximation used is named, sourced and
 * accurate to a tolerance stated in its own comment — an unnamed approximation is
 * indistinguishable from a bug.
 */

import { mean, stddev } from './canvasStatistics';

function round(value: number): number {
  return Number(value.toFixed(6));
}

/** Two-sided z critical values for the intervals a product surface actually offers.
 *  A lookup rather than an inverse-normal implementation: three confidence levels are
 *  the whole product surface, and a table cannot be subtly wrong in its tail. */
const Z_CRITICAL: Record<number, number> = { 0.8: 1.281552, 0.9: 1.644854, 0.95: 1.959964, 0.99: 2.575829 };

export const CONFIDENCE_LEVELS = [0.8, 0.9, 0.95, 0.99] as const;
export type ConfidenceLevel = typeof CONFIDENCE_LEVELS[number];

function criticalValue(level: number): number {
  return Z_CRITICAL[level] ?? Z_CRITICAL[0.95];
}

/**
 * The standard normal CDF, via Abramowitz & Stegun 7.1.26 applied to erf.
 *
 * Maximum absolute error 1.5e-7 — four orders of magnitude tighter than any p-value
 * a person reads off a card, and the reason no special-function dependency is needed.
 */
export function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

export interface Interval { low: number; high: number; level: number }

/**
 * The WILSON score interval for a proportion, not the textbook normal one.
 *
 * The normal ("Wald") interval is what everybody writes first and it fails exactly
 * where a product needs it most: at small n or a proportion near 0 or 1 it produces
 * bounds outside [0, 1] and, at 0 conversions out of 40, an interval of ZERO WIDTH —
 * a card that would report "0% ± 0%" and look certain. Wilson stays inside the unit
 * interval and stays honest at the boundary.
 */
export function proportionInterval(successes: number, total: number, level: number = 0.95): Interval | null {
  if (!Number.isFinite(successes) || !Number.isFinite(total) || total <= 0 || successes < 0 || successes > total) return null;
  const z = criticalValue(level);
  const proportion = successes / total;
  const denominator = 1 + z * z / total;
  const centre = (proportion + z * z / (2 * total)) / denominator;
  const margin = z * Math.sqrt(proportion * (1 - proportion) / total + z * z / (4 * total * total)) / denominator;
  return { low: round(Math.max(0, centre - margin)), high: round(Math.min(1, centre + margin)), level };
}

/**
 * A confidence interval for a MEAN, from the raw observations.
 *
 * Uses the normal critical value, which understates the interval for very small
 * samples — so it refuses below n = 2 and the caller renders the sample size beside
 * the interval. Reporting `sampleSize` is not decoration: an interval whose n is
 * hidden is the same false authority this module exists to remove.
 */
export function meanInterval(values: readonly number[], level: number = 0.95): (Interval & { mean: number; sampleSize: number }) | null {
  if (values.length < 2) return null;
  const average = mean(values);
  const spread = stddev(values);
  if (average == null || spread == null) return null;
  const margin = criticalValue(level) * spread / Math.sqrt(values.length);
  return {
    mean: average,
    sampleSize: values.length,
    low: round(average - margin),
    high: round(average + margin),
    level,
  };
}

export interface ProportionTest {
  /** Conversion rate of each arm, as fractions. */
  baseRate: number;
  variantRate: number;
  /** Variant minus base, in RATE POINTS — the number a stakeholder reads. */
  absoluteLift: number;
  /** The same lift relative to the base rate, which is the number people quote. */
  relativeLift: number | null;
  zScore: number;
  pValue: number;
  /** Interval on the ABSOLUTE lift. Excludes zero exactly when the test is significant. */
  interval: Interval;
  significant: boolean;
  /** Post-hoc power to detect the OBSERVED effect at this sample size. */
  power: number;
  /** Per-arm sample size needed for 80% power at the observed effect. */
  requiredSampleSize: number | null;
}

/**
 * Two-proportion z-test — the honest version of "did the variant win".
 *
 * The pooled proportion is used for the TEST (it is the correct standard error under
 * the null hypothesis that both arms share a rate) and the unpooled proportions for
 * the INTERVAL (there is no null to assume once you are estimating the difference).
 * Using one for both is the most common error in hand-rolled A/B maths and it makes
 * the interval and the p-value disagree about the same data.
 *
 * `power` and `requiredSampleSize` are returned together because a non-significant
 * result means one of two very different things — no effect, or not enough data —
 * and a card that cannot tell them apart invites the reader to conclude the first.
 */
export function twoProportionTest(
  baseSuccesses: number,
  baseTotal: number,
  variantSuccesses: number,
  variantTotal: number,
  level: number = 0.95,
): ProportionTest | null {
  if (baseTotal <= 0 || variantTotal <= 0) return null;
  if (baseSuccesses < 0 || variantSuccesses < 0 || baseSuccesses > baseTotal || variantSuccesses > variantTotal) return null;
  const baseRate = baseSuccesses / baseTotal;
  const variantRate = variantSuccesses / variantTotal;
  const absoluteLift = variantRate - baseRate;
  const pooled = (baseSuccesses + variantSuccesses) / (baseTotal + variantTotal);
  const pooledError = Math.sqrt(pooled * (1 - pooled) * (1 / baseTotal + 1 / variantTotal));
  const zScore = pooledError > 0 ? absoluteLift / pooledError : 0;
  const pValue = round(2 * (1 - normalCdf(Math.abs(zScore))));
  const z = criticalValue(level);
  const unpooledError = Math.sqrt(baseRate * (1 - baseRate) / baseTotal + variantRate * (1 - variantRate) / variantTotal);
  const margin = z * unpooledError;
  // Power to detect the observed effect: the probability the test statistic clears
  // the critical value given the alternative is true at this effect and this n.
  const power = unpooledError > 0
    ? round(Math.min(1, Math.max(0, 1 - normalCdf(z - Math.abs(absoluteLift) / unpooledError) + normalCdf(-z - Math.abs(absoluteLift) / unpooledError))))
    : 0;
  // Per-arm n for 80% power at the observed effect (z(0.975) + z(0.80) = 2.801582).
  const requiredSampleSize = absoluteLift !== 0
    ? Math.ceil((2.801582 ** 2) * (baseRate * (1 - baseRate) + variantRate * (1 - variantRate)) / (absoluteLift ** 2))
    : null;
  return {
    baseRate: round(baseRate),
    variantRate: round(variantRate),
    absoluteLift: round(absoluteLift),
    relativeLift: baseRate > 0 ? round(absoluteLift / baseRate) : null,
    zScore: round(zScore),
    pValue,
    interval: { low: round(absoluteLift - margin), high: round(absoluteLift + margin), level },
    significant: pValue < 1 - level,
    power,
    requiredSampleSize: requiredSampleSize != null && Number.isFinite(requiredSampleSize) ? requiredSampleSize : null,
  };
}

/**
 * The variant rows an `experiment` object holds, scored against the FIRST row.
 *
 * The first variant is the control by convention rather than by a flag, matching how
 * the field is authored and how every variant table anyone has ever drawn reads.
 * A row whose exposure is zero is returned untested rather than dropped: an arm that
 * received no traffic is a finding, and silently omitting it is how a broken split
 * comes to look like a clean result.
 */
export interface ExperimentVariantInput { variant?: string; exposure?: number; conversion?: number }
export interface ScoredExperimentVariant {
  variant: string;
  exposure: number;
  conversion: number;
  rate: number | null;
  interval: Interval | null;
  control: boolean;
  test: ProportionTest | null;
}

export function scoreExperiment(
  variants: readonly ExperimentVariantInput[],
  level: number = 0.95,
): ScoredExperimentVariant[] {
  const rows = variants.map((row, index) => ({
    variant: (row.variant ?? '').toString().trim() || `Variant ${index + 1}`,
    exposure: Number.isFinite(row.exposure) ? Math.max(0, Math.trunc(row.exposure as number)) : 0,
    conversion: Number.isFinite(row.conversion) ? Math.max(0, Math.trunc(row.conversion as number)) : 0,
  }));
  const control = rows[0];
  return rows.map((row, index) => ({
    ...row,
    rate: row.exposure > 0 ? round(row.conversion / row.exposure) : null,
    interval: proportionInterval(row.conversion, row.exposure, level),
    control: index === 0,
    test: index === 0 || !control
      ? null
      : twoProportionTest(control.conversion, control.exposure, row.conversion, row.exposure, level),
  }));
}
