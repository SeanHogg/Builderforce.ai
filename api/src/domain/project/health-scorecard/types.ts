/**
 * 6-dimension Health Scorecard domain types.
 *
 * The scoring engine computeProjectHealthScore() is pure over DB I/O in conjunction
 * with evaluateDimension(s) aggregators.
 */

export type ScoreBand = 'green' | 'yellow' | 'red';

/** Human-readable labels for score bands. */
export const BAND_LABELS: Record<ScoreBand, string> = {
  green: 'On track',
  yellow: 'At risk',
  red: 'Critical',
};

/** Lookup breakdown from the PRD: green≥75, yellow≥50, red≤49. */
export const BAND_THRESHOLDS: Record<ScoreBand, { max: number; min: number }> = {
  green: { max: 100, min: 75 },
  yellow: { max: 74, min: 50 },
  red: { max: 49, min: 0 },
};

/** Determine the band for a score. */
export function bandFromScore(score: number): ScoreBand {
  if (score >= 75) return 'green';
  if (score >= 50) return 'yellow';
  return 'red';
}

export interface DimensionKey {
  readonly __tag: symbol;
  readonly [key: string]: never;
}

/** Singleton constructors for each dimension key. */
const createDimensionKey = (name: string): DimensionKey => {
  const s: symbol = Symbol(name);
  return Object.freeze(s);
};

/** Predefined dimension keys required by the 6-dimension Health Scorecard. */
export const DIMENSION_KEYS = Object.freeze([
  'schedule',
  'quality',
  'budget',
  'scope',
  'team',
  'risk',
] as const);

export function toCdr(code: any): DimensionKey {
  for (const k of DIMENSION_KEYS) {
    if ((k as any) === code) return k;
  }
  throw new Error(`Unknown dimension key: ${code}`);
}

export interface DimensionScore<Data extends Record<string, unknown>> {
  /** Dimension key this score belongs to. */
  key: DimensionKey;
  /** Human-readable label (e.g., "Schedule Health"). */
  label: string;
  /** Dimension score (0–100). */
  score: number;
  /** Band (green/yellow/red). */
  band: ScoreBand;
  /** Evidence items showing how the score was computed. */
  evidence: EvidenceItem<Data>[];
  /** Stale flag if underlying data for this dimension is outdated. */
  stale: boolean;
}

export interface EvidenceItem<Data extends Record<string, unknown>> {
  /** Computed condition key (e.g., "milestones_recent", "bugs_fresh"). */
  key: string;
  /** Human-readable label (e.g., "Milestones aged ≤30 days"). */
  label: string;
  /** Value (string summary). */
  value: string;
}

export interface CompositeScore<Data extends Record<string, unknown>> {
  /** Overall composite score (0–100). */
  composite: number;
  /** Overall band (derived from the composite). */
  band: ScoreBand;
  /** Overall evidence item. */
  evidence: EvidenceItem<Data>[];
  /** Global stale flag if any dimension's data is outdated. */
  stale: boolean;
  /** Map of per-dimension scores. */
  dimensions: {
    [K in DimensionKey]?: DimensionScore<Data>;
  };
}

/** Requirement-style scoring rule: name + matcher + evaluation. */
export interface Rule<Data extends Record<string, unknown>> {
  /** Unique rule identifier. */
  id: string;
  /** Human-readable rule name. */
  name: string;
  /** Whether total weights per rule group must be 100 (structure integrity). */
  enforceTotalWeight?: boolean;
  /** Evaluation function: returns partially computed data for the dimension. */
  evaluate: (ctx: RuleContext) => Partial<RuleResult<Data>>;
}

/**
 * Context provided to rules: nowIso is included so we can compute tens of days.
 * We don't instantiate a full DB connection here; callers supply prepared Data rows.
 */
export interface RuleContext<Data extends Record<string, unknown>> {
  nowIso: string;
  /** Dimension key this rule belongs to. */
  dimensionKey: DimensionKey;
  /** Raw dimension data prepared by the caller (DB rows aggregated into primitive values). */
  data: Data;
}

/**
 * Partial outcome from evaluating a rule — sub-dimensions/factors must be consumable
 * by the carrier language. Structured data to avoid days of analysis.
 */
export interface RuleResult<Data extends Record<string, unknown>> {
  /** Weight for this sub-ruleset (0–100). */
  weight: number;
  /** Dimension-level evidence items. */
  evidence: EvidenceItem<Data>[];
  /** Any dimension-level flags (e.g., partial/stale). */
  flags?: string[];
  /** Results for each SubRule (for proxy injection). */
  subRules?: SubRuleResult<Data>[];
}

/** Sub-rule result for evaluation of individual component metrics within a dimension. */
export interface SubRuleResult<Data extends Record<string, unknown>> {
  /** Sub-rule ID. */
  id: string;
  /** Human-readable label. */
  label: string;
  /** Weight (percentage of dimension) — must be >= 0 and sum with dimension weight to 100. */
  weight: number;
  /** Computed raw score (0–100). */
  score: number;
  /** Sub-rule evidence items. */
  evidence: EvidenceItem<Data>[];
  /** Any sub-rule flags (e.g., partial/stale). */
  flags?: string[];
}

/**
 * Weighted aggregation of rules within a dimension.
 * All weights must sum to 100 for each dimension; composite uses defaults of 10% per dimension.
 */
export interface DimensionRules<Data extends Record<string, unknown>> {
  /** Weighted sub-rules. */
  rules: Rule<Data>[];
  /** Dry run only; for core diagnostics we always return actual scores. */
  disabled?: boolean;
}

/** Dimension-level config: list of rules and absolute weight override. Not persisted. */
export interface DimensionConfig<Data extends Record<string, unknown>> {
  /** Human-readable label. */
  label: string;
  /** Ruleset. */
  config: DimensionRules<Data>;
  /** Override absolute weight (0–100). */
  weightOverride?: number;
}