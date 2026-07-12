/**
 * Domain types for the 6-dimension Project Health Scorecard.
 *
 * Pure model types; no DB coupling. Each DimensionScore is produced by a
 * deterministic evaluate<Dimension> function over its data shape.
 *
 * See domain/project/health-scorecard/rules.ts for the scoring logic.
 */

export type HealthBand = 'green' | 'yellow' | 'red';

export type DimensionKey =
  | 'schedule'
  | 'quality'
  | 'budget'
  | 'scope'
  | 'team'
  | 'risk';

export const DIMENSION_LABELS: Record<DimensionKey, string> = {
  schedule: 'Schedule',
  quality: 'Quality',
  budget: 'Budget',
  scope: 'Scope',
  team: 'Team',
  risk: 'Risk',
};

export interface EvidenceItem {
  key: string;
  label: string;
  value: string | number;
}

export interface DimensionScore {
  score: number;           // 0–100
  band: HealthBand;
  evidence: EvidenceItem[];
  flags: string[];         // 'stale' | 'partial' | 'no-data' | custom
}

export interface HealthScorecard {
  projectId: number;
  composite: number;       // 0–100 weighted average
  band: HealthBand;
  dimensions: Record<DimensionKey, DimensionScore>;
  computedAt: string;      // ISO-8601
  snapshotHash: string;    // deterministic hash of input data (for AC-7)
}

/** Traffic-light thresholds from PRD: green ≥75, yellow 50–74, red <50. */
export const BAND_THRESHOLDS: Record<HealthBand, { min: number; max: number }> = {
  green: { min: 75, max: 100 },
  yellow: { min: 50, max: 74 },
  red: { min: 0, max: 49 },
};

/** Determine the health band for a 0–100 score. */
export function computeBand(score: number): HealthBand {
  if (score >= 75) return 'green';
  if (score >= 50) return 'yellow';
  return 'red';
}

/** Default symmetric weights (16.7% each, approx 100/6). */
export function defaultWeights(): Record<DimensionKey, number> {
  return {
    schedule: 167,
    quality: 167,
    budget: 166,
    scope: 166,
    team: 167,
    risk: 167,
  };
}

/**
 * Compute the weighted composite score from per-dimension scores.
 * Uses integer weights in tenths-of-percent to avoid floating drift.
 */
export function computeCompositeScore(
  scores: Record<DimensionKey, number>,
  weights: Record<DimensionKey, number>,
): number {
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) return 100;
  const weighted = Object.entries(weights).reduce(
    (sum, [key, w]) => sum + (scores[key as DimensionKey] ?? 0) * w,
    0,
  );
  return Math.round((weighted / totalWeight) * 10) / 10; // one decimal
}