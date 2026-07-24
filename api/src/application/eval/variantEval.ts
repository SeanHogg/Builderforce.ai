/**
 * variantEval.ts — fine-tune-vs-base A/B evaluation over the run-outcome ledger.
 *
 * The cookbook's implicit gate: never ship a fine-tune you haven't shown beats
 * its base on held-out work. Our held-out set is real production runs — every one
 * already scored 0..1 in `run_model_outcomes` and tagged with the model that ran
 * it (`resolved_model`). So "did the adapter/fine-tune beat base?" is a two-sample
 * comparison of outcome scores between two model variants for the same action type.
 *
 * This is exactly the gate the (blocked) "Evermind auto-routing eval gate" needs:
 * only promote `evermind/<ft>` into auto-routing once {@link passesPromotionGate}
 * says it beats `evermind/base` by a real margin at a real sample size.
 *
 * Pure statistics (Welch's t-test, unequal variance) so it is fully unit-testable;
 * the DB reader is a thin cached wrapper.
 */

import { and, eq, gte, isNotNull } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { runModelOutcomes } from '../../infrastructure/database/schema';
import { getOrSetCached, getCacheVersion, outcomesVersionKey } from '../../infrastructure/cache/readThroughCache';
import { mean, stdev } from './driftMonitor';
import type { Env } from '../../env';

export interface VariantSummary {
  model: string;
  n: number;
  meanScore: number;
  stdev: number;
}

export type VariantVerdict = 'better' | 'worse' | 'inconclusive';

export interface VariantComparison {
  base: VariantSummary;
  candidate: VariantSummary;
  /** candidate.mean − base.mean. */
  delta: number;
  /** delta / |base.mean| (0 when base mean is 0). */
  relImprovement: number;
  /** Welch's t statistic (unequal-variance two-sample). */
  tStat: number;
  /** Approximate two-sided p-value (normal approximation). */
  pValue: number;
  /** |t| ≥ 1.96 AND both samples ≥ minSamples. */
  significant: boolean;
  verdict: VariantVerdict;
}

export interface CompareOptions {
  /** Minimum n in EACH arm for `significant` to be true. Default 30. */
  minSamples?: number;
}

/** Standard-normal CDF via the Abramowitz–Stegun erf approximation. */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-(z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/**
 * Compare two variants' outcome-score samples. `base` = the incumbent model's
 * scores, `candidate` = the fine-tune's scores. Both are 0..1 outcome scores.
 */
export function compareVariants(
  baseModel: string,
  base: number[],
  candidateModel: string,
  candidate: number[],
  opts: CompareOptions = {},
): VariantComparison {
  const minSamples = opts.minSamples ?? 30;
  const nB = base.length;
  const nC = candidate.length;
  const meanB = nB > 0 ? mean(base) : 0;
  const meanC = nC > 0 ? mean(candidate) : 0;
  const sB = nB > 1 ? stdev(base, meanB) : 0;
  const sC = nC > 1 ? stdev(candidate, meanC) : 0;
  const delta = meanC - meanB;
  const relImprovement = meanB !== 0 ? delta / Math.abs(meanB) : 0;

  const se = Math.sqrt((sB * sB) / Math.max(1, nB) + (sC * sC) / Math.max(1, nC));
  const tStat = se > 0 ? delta / se : 0;
  const pValue = se > 0 ? 2 * (1 - normalCdf(Math.abs(tStat))) : 1;
  const significant = Math.abs(tStat) >= 1.96 && nB >= minSamples && nC >= minSamples;

  let verdict: VariantVerdict = 'inconclusive';
  if (significant) verdict = delta > 0 ? 'better' : 'worse';

  return {
    base: { model: baseModel, n: nB, meanScore: meanB, stdev: sB },
    candidate: { model: candidateModel, n: nC, meanScore: meanC, stdev: sC },
    delta,
    relImprovement,
    tStat,
    pValue,
    significant,
    verdict,
  };
}

export interface PromotionGateOptions {
  /** Candidate must beat base by at least this absolute score margin. Default 0.02. */
  minDelta?: number;
  /** Minimum n in each arm. Default 30. */
  minSamples?: number;
}

export interface PromotionDecision {
  promote: boolean;
  reason: string;
}

/**
 * The go/no-go gate for promoting a fine-tune into auto-routing. Promote only if
 * the comparison is statistically significant, the candidate wins, and the win
 * clears a minimum practical margin at a minimum sample size.
 */
export function passesPromotionGate(cmp: VariantComparison, opts: PromotionGateOptions = {}): PromotionDecision {
  const minDelta = opts.minDelta ?? 0.02;
  const minSamples = opts.minSamples ?? 30;
  if (cmp.base.n < minSamples || cmp.candidate.n < minSamples) {
    return { promote: false, reason: `insufficient samples (base=${cmp.base.n}, candidate=${cmp.candidate.n}, need ≥${minSamples})` };
  }
  if (!cmp.significant) {
    return { promote: false, reason: `not statistically significant (t=${cmp.tStat.toFixed(2)}, p=${cmp.pValue.toFixed(3)})` };
  }
  if (cmp.verdict !== 'better') {
    return { promote: false, reason: `candidate does not beat base (Δ=${cmp.delta.toFixed(3)})` };
  }
  if (cmp.delta < minDelta) {
    return { promote: false, reason: `win below margin (Δ=${cmp.delta.toFixed(3)} < ${minDelta})` };
  }
  return { promote: true, reason: `candidate wins by Δ=${cmp.delta.toFixed(3)} (p=${cmp.pValue.toFixed(3)}, n=${cmp.candidate.n})` };
}

// ── Cached DB service ────────────────────────────────────────────────────────

async function scoresForModel(
  db: Db,
  tenantId: number,
  model: string,
  actionType: string | undefined,
  since: Date,
): Promise<number[]> {
  const conds = [
    eq(runModelOutcomes.tenantId, tenantId),
    eq(runModelOutcomes.resolvedModel, model),
    gte(runModelOutcomes.createdAt, since),
    isNotNull(runModelOutcomes.score),
  ];
  if (actionType) conds.push(eq(runModelOutcomes.actionType, actionType));
  const rows = await db.select({ score: runModelOutcomes.score }).from(runModelOutcomes).where(and(...conds));
  return rows.map((r) => r.score as number);
}

export interface EvaluateVariantParams {
  tenantId: number;
  baseModel: string;
  candidateModel: string;
  actionType?: string;
  windowDays?: number;
  minSamples?: number;
}

/**
 * Read both variants' outcome scores over a window and return the comparison +
 * promotion decision. Cached, folded on the tenant's outcomes version token.
 */
export async function evaluateVariant(
  env: Env,
  db: Db,
  params: EvaluateVariantParams,
  now: Date = new Date(),
): Promise<{ comparison: VariantComparison; decision: PromotionDecision }> {
  const windowDays = params.windowDays ?? 60;
  const ver = await getCacheVersion(env, outcomesVersionKey(params.tenantId));
  const key = `variant-eval:${params.tenantId}:${params.baseModel}:${params.candidateModel}:${params.actionType ?? '*'}:${windowDays}:${ver}`;
  return getOrSetCached(env, key, async () => {
    const since = new Date(now.getTime() - windowDays * 86_400_000);
    const [base, candidate] = await Promise.all([
      scoresForModel(db, params.tenantId, params.baseModel, params.actionType, since),
      scoresForModel(db, params.tenantId, params.candidateModel, params.actionType, since),
    ]);
    const comparison = compareVariants(params.baseModel, base, params.candidateModel, candidate, { minSamples: params.minSamples });
    const decision = passesPromotionGate(comparison, { minSamples: params.minSamples });
    return { comparison, decision };
  });
}
