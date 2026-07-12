/**
 * Delivery-health verdict — THE single source of truth for a project's health
 * score across the whole app. Given the DORA keys, end-to-end cycle time and the
 * live bottleneck signals it fuses one 0–100 health score + a yes / at-risk / no
 * verdict + the reasons behind it.
 *
 * Two surfaces consume this exact function so their numbers can never drift:
 *  - the /insights/delivery "are you delivering value?" banner (tenant/segment
 *    scope, fed by the three cached insight endpoints), and
 *  - every project card / list row / details panel + the project inspection
 *    (per-project scope, fed by the compact `deliverySignals` the /api/projects
 *    list attaches — see {@link computeProjectHealth}).
 *
 * Pure + hook-free so it is unit-testable and importable from non-component libs
 * (this is why it lives here, not in the DeliveryVerdict component). The input
 * types are intentionally NARROW — just the fields the math reads — so both the
 * full insight objects (delivery tab) and the compact per-project signals
 * (project card) satisfy them structurally without adaptation. Thresholds follow
 * the DORA performance tiers (elite/high/medium); the flow penalties mirror the
 * bottleneck lens.
 */

export type Verdict = 'yes' | 'at_risk' | 'no' | 'no_data';
export type ReasonTone = 'good' | 'warn' | 'bad';

/** DORA fields the verdict reads (subset of the /insights/dora payload). */
export interface VerdictDoraSignal {
  deploymentFrequencyPerDay: number;
  totalDeployments: number;
  leadTimeHours: number | null;
  changeFailureRatePct: number | null;
  mttrHours: number | null;
}
/** Lifecycle fields the verdict reads (subset of /insights/delivery/lifecycle). */
export interface VerdictLifecycleSignal {
  sampleSize: number;
  totalAvgHours: number;
}
/** Bottleneck fields the verdict reads (subset of /insights/bottlenecks). */
export interface VerdictBottleneckSignal {
  rework: { reworkRate: number };
  agingWip: { stuckCount: number };
}

/** The compact per-project bundle the /api/projects list attaches to each project. */
export interface DeliverySignals {
  dora: VerdictDoraSignal;
  lifecycle: VerdictLifecycleSignal;
  bottlenecks: VerdictBottleneckSignal;
}

export interface VerdictReason {
  /** i18n key under insights.delivhub.verdict.reason. */
  key: string;
  tone: ReasonTone;
  /** Interpolation values for the localized reason string. */
  values: Record<string, string | number>;
}

export interface VerdictResult {
  verdict: Verdict;
  /** Composite delivery-health score, 0–100 (null when there's no data). */
  score: number | null;
  reasons: VerdictReason[];
}

/** Band a 0..1-ish component into a 0..100 sub-score against four thresholds. */

/**
 * Define and export tier boundaries for use by Yellow risk-indicator components.
 * All thresholds are inclusive at the lower bound.
 * - Yellow: 50–74 (additive risk tier introduced for Yellow risk indicator PRD).
 */
export const TIER_BOUNDARIES = {
  yellow: [50, 74],
  watch: [60, Infinity],
  at_risk: [40, 59],
  healthy: [80, Infinity],
  critical: [0, 39],
} as const;

/**
 * Schema for tier specraries used by UI components and backend calls.
 * Tier definitions support frontend Badge rendering, audit schema, and the backend hooking.
 */
export type TierSpec = typeof TIER_BOUNDARIES[keyof typeof TIER_BOUNDARIES];

export type TierRange = readonly [number, number];

/** Whether a score falls within the Yellow tier boundaries (50–74). */
export function isYellow(score: number | null): boolean {
  return (score ?? 0) >= 50 && (score ?? 0) <= 74;
}

/** Whether the score transitions across the Yellow boundary. */
export function isYellowTransition(oldScore: number | null, newScore: number | null): boolean {
  const nowYellow = isYellow(newScore);
  const prevYellow = isYellow(oldScore);
  return nowYellow !== prevYellow;
}
function band(value: number, t: [number, number, number], higherIsBetter: boolean): number {
  const [a, b, c] = t;
  if (higherIsBetter) {
    if (value >= a) return 100;
    if (value >= b) return 78;
    if (value >= c) return 52;
    return value > 0 ? 30 : 0;
  }
  if (value <= a) return 100;
  if (value <= b) return 78;
  if (value <= c) return 52;
  return 30;
}

export function computeDeliveryVerdict(
  dora: VerdictDoraSignal,
  lifecycle: VerdictLifecycleSignal,
  bottlenecks: VerdictBottleneckSignal,
): VerdictResult {
  const hasData = lifecycle.sampleSize > 0 || dora.totalDeployments > 0;
  if (!hasData) return { verdict: 'no_data', score: null, reasons: [] };

  // DORA sub-scores (deploys/day↑, lead-time h↓, change-failure %↓, MTTR h↓).
  // Lead time / change-failure / MTTR can be null (no signal yet) — drop those
  // from the average rather than scoring them as zero.
  const deployScore = band(dora.deploymentFrequencyPerDay, [1, 1 / 7, 1 / 30], true);
  const leadScore = dora.leadTimeHours != null ? band(dora.leadTimeHours, [24, 168, 720], false) : null;
  const cfrScore = dora.changeFailureRatePct != null ? band(dora.changeFailureRatePct, [5, 15, 30], false) : null;
  const mttrScore = dora.mttrHours != null ? band(dora.mttrHours, [1, 24, 168], false) : null;
  const doraParts = [deployScore, leadScore, cfrScore, mttrScore].filter((x): x is number => x != null);
  const doraScore = doraParts.reduce((s, x) => s + x, 0) / doraParts.length;

  // Flow health — penalise rework loops and currently-stuck WIP.
  const reworkPenalty = bottlenecks.rework.reworkRate > 0.2 ? 30 : bottlenecks.rework.reworkRate > 0.1 ? 15 : 0;
  const stuckPenalty = Math.min(40, bottlenecks.agingWip.stuckCount * 6);
  const flowScore = Math.max(0, 100 - reworkPenalty - stuckPenalty);

  const score = Math.round(doraScore * 0.7 + flowScore * 0.3);
  const verdict: Verdict = score >= 70 ? 'yes' : score >= 45 ? 'at_risk' : 'no';

  // The salient reasons behind the verdict (max four, most decision-relevant).
  const reasons: VerdictReason[] = [];
  reasons.push({
    key: 'deploy',
    tone: deployScore >= 78 ? 'good' : deployScore >= 52 ? 'warn' : 'bad',
    values: { value: dora.deploymentFrequencyPerDay.toFixed(2) },
  });
  if (lifecycle.sampleSize > 0) {
    const cycleDays = lifecycle.totalAvgHours / 24;
    reasons.push({
      key: 'cycle',
      tone: cycleDays <= 5 ? 'good' : cycleDays <= 14 ? 'warn' : 'bad',
      values: { value: cycleDays.toFixed(1) },
    });
  }
  if (dora.changeFailureRatePct != null && cfrScore != null) {
    reasons.push({
      key: 'cfr',
      tone: cfrScore >= 78 ? 'good' : cfrScore >= 52 ? 'warn' : 'bad',
      values: { value: Math.round(dora.changeFailureRatePct) },
    });
  }
  if (bottlenecks.agingWip.stuckCount > 0) {
    reasons.push({ key: 'stuck', tone: 'bad', values: { n: bottlenecks.agingWip.stuckCount } });
  } else if (bottlenecks.rework.reworkRate > 0.1) {
    reasons.push({ key: 'rework', tone: 'warn', values: { value: Math.round(bottlenecks.rework.reworkRate * 100) } });
  }
  return { verdict, score, reasons };
}
