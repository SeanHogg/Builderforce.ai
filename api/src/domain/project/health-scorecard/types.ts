/**
 * 6-dimension Health Scorecard domain types.
 *
 * Naming aligned with the underlying codebase conventions (snake_case, singular).
 * The scoring engine computeProjectHealthScore is pure over DB I/O in conjunction
 * with evaluateDimension(s) aggregators.
 */

export type ScoreBand = 'green' | 'yellow' | 'red';

export interface HealthEvidenceItem {
  dimension: string;
  key: string;
  label: string;
  value: string;
}

export type ScoreFlag = 'partial' | 'flags' | 'near_ready';

export interface DimensionScore {
  score: number;           // 0–100
  band: ScoreBand;
  evidence: HealthEvidenceItem[];
  flags: ScoreFlag[];
  stale: boolean;
}

export interface FactorEvidence {
  key: string;
  label: string;
  value: string;
}

export interface Factor {
  name: string;
  weight: number;  // sum across all Factors in a dimension must be 100%
  evaluate(data: DimensionData): FactorEvidence;
}

export type FactorGroup = { factors: Factor[]; vsum: number | null };

export interface DimensionData {
  [key: string]: unknown;   // filled by caller based on DB queries
}

export interface CompositeScore {
  composite: number;            // 0–100
  band: ScoreBand;
  evidence: HealthEvidenceItem[];
  flags: ScoreFlag[];
  stale: boolean;
  dimensions: {
    [key: DimensionKey]: DimensionScore;
  };
}

export type DimensionKey =
  | 'schedule'
  | 'quality'
  | 'budget'
  | 'scope'
  | 'team'
  | 'risk';

/** Human-readable names for compliance / exports. */
export const DIMENSION_LABELS: Record<DimensionKey, string> = {
  schedule: 'Schedule',
  quality: 'Quality',
  budget: 'Budget',
  scope: 'Scope',
  team: 'Team',
  risk: 'Risk',
};

/** Human-readable labels for score bands. */
export const BAND_LABELS: Record<ScoreBand, string> = {
  green: 'On track',
  yellow: 'At risk',
  red: 'Critical',
};

/**
 * Lookup breakdown for the green/yellow/red thresholds from the PRD:
 * - Green: 75–100 (on track)
 * - Yellow: 50–74 (at risk)
 * - Red: 0–49 (critical)
 */
export const BAND_THRESHOLDS: Record<ScoreBand, { max: number; min: number }> = {
  green: { max: 100, min: 75 },
  yellow: { max: 74, min: 50 },
  red: { max: 49, min: 0 },
};

/** Default symmetric weights across dimensions (10% each) pending tuning via rules. */
export function getDefaultDimensionWeights(): Record<DimensionKey, number> {
  return {
    schedule: 10,
    quality: 10,
    budget: 10,
    scope: 10,
    team: 10,
    risk: 10,
  };
}

/** Weighted sum of dimension scores; all weights >= 0 and should sum to 100% for production. */
export function computeComposite(
  scores: Record<DimensionKey, number>,
  weights: Record<DimensionKey, number>,
): number {
  const totalWeight = Object.values(weights).reduce((s, w) => s + w, 0);
  const weighted = Object.entries(scores).reduce((acc, [dim, score]) => {
    acc[dim] = score * (weights[dim] ?? 0);
    return acc;
  }, {} as Record<DimensionKey, number>);

  return totalWeight > 0
    ? Object.values(weighted).reduce((s, v) => s + v, 0) / totalWeight
    : 100;
}