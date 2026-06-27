/**
 * Drift monitoring — detects when a model/route's quality is degrading over time.
 *
 * Traditional infra monitoring sees a 200 and moves on; an LLM that quietly gets
 * worse on a class of inputs ships wrong answers with a green dashboard. This
 * compares a recent window of scores against a baseline window and flags a
 * statistically meaningful shift, via two complementary signals:
 *
 *   • mean-shift z-score — has the average score moved beyond baseline noise?
 *   • Population Stability Index (PSI) — has the score DISTRIBUTION shifted?
 *
 * Pure and dependency-free → unit-testable in isolation.
 */

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function stdev(xs: number[], m = mean(xs)): number {
  if (xs.length < 2) return 0;
  const variance = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

export type DriftSeverity = 'none' | 'warn' | 'alert';

export interface DriftResult {
  baselineMean: number;
  recentMean: number;
  /** recentMean − baselineMean (negative = quality regression). */
  delta: number;
  /** Standardised mean shift (|delta| / baseline stdev), 0 when baseline is flat. */
  zScore: number;
  /** Population Stability Index between the two windows. */
  psi: number;
  drifted: boolean;
  severity: DriftSeverity;
  /** True only when there were enough samples on both sides to judge. */
  sufficient: boolean;
}

export interface DriftOptions {
  /** Minimum samples required on EACH side. Below this, no judgement is made. Default 8. */
  minSamples?: number;
  /** z-score above which a mean shift counts as drift. Default 2. */
  zThreshold?: number;
  /** PSI above which a distribution shift counts as drift. Default 0.2 (industry rule of thumb). */
  psiThreshold?: number;
  /** Number of equal-width bins over [0,1] for PSI. Default 10. */
  bins?: number;
}

/**
 * Population Stability Index over [0,1]. Bins both windows, then sums
 * (recentFrac − baseFrac) · ln(recentFrac / baseFrac) with Laplace smoothing so
 * an empty bin can't blow the term to ±Infinity. 0 = identical distributions.
 */
export function populationStabilityIndex(baseline: number[], recent: number[], bins = 10): number {
  if (baseline.length === 0 || recent.length === 0) return 0;
  const eps = 1e-6;
  const histogram = (xs: number[]): number[] => {
    const counts = new Array(bins).fill(0);
    for (const x of xs) {
      const clamped = Math.min(1, Math.max(0, x));
      const idx = Math.min(bins - 1, Math.floor(clamped * bins));
      counts[idx]++;
    }
    return counts.map((c) => (c + eps) / (xs.length + eps * bins));
  };
  const base = histogram(baseline);
  const rec = histogram(recent);
  let psi = 0;
  for (let i = 0; i < bins; i++) {
    const r = rec[i]!;
    const b = base[i]!;
    psi += (r - b) * Math.log(r / b);
  }
  return psi;
}

/**
 * Compares a baseline window to a recent window and decides whether the metric has
 * drifted. `alert` when both signals fire (mean regression AND distribution shift);
 * `warn` when one does. A positive delta (improvement) never alerts.
 */
export function computeDrift(baseline: number[], recent: number[], opts: DriftOptions = {}): DriftResult {
  const minSamples = opts.minSamples ?? 8;
  const zThreshold = opts.zThreshold ?? 2;
  const psiThreshold = opts.psiThreshold ?? 0.2;

  const baselineMean = mean(baseline);
  const recentMean = mean(recent);
  const delta = recentMean - baselineMean;
  const sd = stdev(baseline, baselineMean);
  const zScore = sd === 0 ? 0 : Math.abs(delta) / sd;
  const psi = populationStabilityIndex(baseline, recent, opts.bins ?? 10);

  const sufficient = baseline.length >= minSamples && recent.length >= minSamples;
  if (!sufficient) {
    return { baselineMean, recentMean, delta, zScore, psi, drifted: false, severity: 'none', sufficient: false };
  }

  // Only a REGRESSION (quality dropped) is actionable drift.
  const meanRegressed = delta < 0 && zScore >= zThreshold;
  const distShifted = psi >= psiThreshold;
  let severity: DriftSeverity = 'none';
  if (meanRegressed && distShifted) severity = 'alert';
  else if (meanRegressed || distShifted) severity = 'warn';

  return { baselineMean, recentMean, delta, zScore, psi, drifted: severity !== 'none', severity, sufficient: true };
}

// ── Group-wise drift over time-ordered samples ──────────────────────────────

export interface ScoredSample {
  /** Grouping key, e.g. `${actionType}:${model}`. */
  group: string;
  score: number;
  /** Sort key (ms epoch). Older = baseline, newer = recent. */
  ts: number;
}

export interface GroupDrift {
  group: string;
  samples: number;
  result: DriftResult;
}

/**
 * Splits each group's time-ordered samples into a baseline (older) and recent
 * (newer) window and runs {@link computeDrift} per group. `baselineFrac` controls
 * the split point. Groups are returned sorted worst-first (most negative delta).
 */
export function detectGroupDrift(
  samples: ScoredSample[],
  opts: DriftOptions & { baselineFrac?: number } = {},
): GroupDrift[] {
  const baselineFrac = opts.baselineFrac ?? 0.5;
  const byGroup = new Map<string, ScoredSample[]>();
  for (const s of samples) {
    const arr = byGroup.get(s.group);
    if (arr) arr.push(s);
    else byGroup.set(s.group, [s]);
  }

  const out: GroupDrift[] = [];
  for (const [group, rows] of byGroup) {
    rows.sort((a, b) => a.ts - b.ts);
    const split = Math.floor(rows.length * baselineFrac);
    const baseline = rows.slice(0, split).map((r) => r.score);
    const recent = rows.slice(split).map((r) => r.score);
    out.push({ group, samples: rows.length, result: computeDrift(baseline, recent, opts) });
  }

  out.sort((a, b) => a.result.delta - b.result.delta);
  return out;
}
