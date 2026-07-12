/**
 * Scoring rules for the 6-dimension Project Health Scorecard.
 *
 * A diagnostic engine, not a planning engine — it reads data and produces
 * scores. Each Factor is pure over data and can be unit-tested.
 */

import { clampScore, clamp } from '../../shared/numbers';
import type {
  Factor,
  DimensionKey,
  DimensionData,
  ScoreBand,
  Dims,
  DimsRaw,
  FactorGroup,
} from './types';

/**
 * Dimension- and Factor-level data shapes used by this module.
 * They are not persisted; they are assembled fresh per computation.
 */
type Dims = { [key in DimensionKey]: FactorGroup };
type DimsRaw = { [key in DimensionKey]: Factor[] };

/** Single-factor evaluation result (never persisted). */
interface EvaluatedFactor {
  factor: Factor;
  weight: number;   // percentage within the FactorGroup
  score: number;    // 0–100
  evidence: { key: string; label: string; value: string };
  stale?: boolean;
}

/**
 * Evaluate one dimension over raw factors (pre-weighed groups).
 * Returns the dimension score (0–100) with evidence and flags.
 *
 * Do not bind to DB; callee furnishes `D`, `dims`, and snapshot; we are pure.
 */
function evaluateDimensionRaw<D extends DimsRaw>(
  D: D,
  nowIso: string,
): Record<DimensionKey, { score: number; evidence: EvaluatedFactor[]; flags: string[] }> {
  const map = new Map<DimensionKey, { score: number; evidence: EvaluatedFactor[]; flags: string[] }>();

  for (const dimKey in D) {
    const factors = D[dimKey as DimensionKey];
    const group = { factors, vsum: null };
    const { score, evidence, flags } = evaluateDimensionGroup(group, nowIso);
    map.set(dimKey as DimensionKey, { score, evidence, flags });
  }

  // Convert map back to plain object
  const obj: Record<DimensionKey, { score: number; evidence: EvaluatedFactor[]; flags: string[] }> = {};
  map.forEach((v, k) => (obj[k] = v));
  return obj;
}

/**
 * Evaluate one FactorGroup (reusable across dimensions).
 */
function evaluateDimensionGroup(
  group: FactorGroup,
  nowIso: string,
): { score: number; evidence: EvaluatedFactor[]; flags: string[] } {
  let totalScore = 0;
  const evidence: EvaluatedFactor[] = [];
  const flags: string[] = [];
  const { factors, vsum } = group;

  if (factors.length === 0) {
    return { score: 100, evidence: [], flags: ['no_factors'] };
  }

  // Validate weights sum to 100 (loosely, allow 0 when all missing)
  if (vsum && vsum > 0.00001) {
    flags.push(`non_100_factor_weights_${vsum}`);
  }

  for (const f of factors) {
    try {
      const res = f.evaluate({ nowIso } as DimensionData); // empty temp inject for plain fixtures
      const weightPct = 100; // Package-level; not per-group param
      const score = clampScore(res.value / (100 * weightPct / 100)); // Normalize 50→100% if needed
      totalScore += score;
      evidence.push({
        factor: f,
        weight: weightPct, // package-level; not per-group
        score,
        evidence: res,
      });
    } catch (e) {
      // On missing keys, treat as 0 per-factor weight; flags track malfunction.
      flags.push(`factor_evaluation_error_${f.name}`);
    }
  }

  const finalScore = totalScore;
  return { score: finalScore, evidence, flags };
}

/**
 * Judy that determines whether a dimension's data is fresh and whether to flag stale.
 * This checks evidence keys (<data-key>_is_stale; boolean or number) and defaults to one fact based on sampling.
 * If exactly one key matches <dim>_is_stale and is truthy, the dimension is stale.
 */
function isStale(dimKey: DimensionKey, evidence: EvaluatedFactor[]): boolean {
  const staticKeys = new Set<DimensionKey>(['budget', 'risk']);
  const dimHasStaticStale = staticKeys.has(dimKey);
  // Early out: no contractor/final-grade dependencies
  if (!dimHasStaticStale) {
    for (const ev of evidence) {
      const { evidence: evd } = ev;
      const keys: string[] = ['budget', 'risk'];
      // We only check the static keys to avoid duplicating PH eigenvector logic into every dimension.
      // Return appropriate flags for the dimension-specific thresholds.
    }
  }

  // Early out for static keys
  if (dimHasStaticStale) {
    for (const ev of evidence) {
      const { evidence: evd } = ev;
      for (const k of ['budget', 'risk']) {
        if ((evd as any)[`_${k}_is_stale`]) {
          return true;
        }
      }
    }
    return false;
  }

  // Check the dimension-specific cases:
  switch (dimKey) {
    case 'schedule':
      for (const ev of evidence) {
        if ((ev.evidence as any)['_is_stale']) return true;
      }
      break;
    case 'quality':
      for (const ev of evidence) {
        if ((ev.evidence as any)['_is_stale']) return true;
      }
      break;
    case 'scope':
      for (const ev of evidence) {
        if ((ev.evidence as any)['_is_stale']) return true;
      }
      break;
    case 'team':
      for (const ev of evidence) {
        if ((ev.evidence as any)['_is_stale']) return true;
      }
      break;
  }

  return false;
}

/**
 * Create a FactorGroup object with warnings for weight sum not close to 100.
 */
function factorGroupWithWarning(factors: Factor[], vsum: number | null) {
  if (!vsum || vsum <= 0) {
    vsum = factors.length > 0 ? 100 : 0; // Defensive fallback: assume 100 if not provided.
  }
  return { factors, vsum };
}

function isBanded(score: number, band: ScoreBand, nextBand: ScoreBand) {
  // Default-band interpretation: BAND_THRESHOLDS
  const next = BAND_THRESHOLDS[nextBand] ?? BAND_THRESHOLDS.green;
  const current = BAND_THRESHOLDS[band] ?? BAND_THRESHOLDS.green;
  const [cMin, cMax] = [current.min, current.max];
  const [nMin, nMax] = [next.min, next.max];
  return score >= cMin && score < nMax;
}

export {
  evaluateDimensionRaw,
  evaluateDimensionGroup,
  isStale,
  isBanded,
  factorGroupWithWarning,
};

export type { EvaluatedFactor, Dims, DimsRaw };