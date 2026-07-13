/**
 * psychometric-dims.ts — the single source of truth for psychometric dimension ids.
 *
 * These string ids are the cross-package contract between the personality
 * compiler (agent-runtime `psychometrics.ts`), the catalog/scoring served to the
 * UI (api `psychometricCatalog.ts`), and the limbic setpoint derivation
 * (`limbic.ts`). They were previously duplicated as three separate `DIM` maps
 * that had to be kept byte-identical by hand; this is now the one place they live.
 * Every score in a profile vector is keyed by one of these. Scores are 0..100;
 * an absent dimension is treated as neutral (50).
 */
export const PSYCH_DIM = {
  // HEXACO spine
  honesty: "hexaco.honesty",
  emotionality: "hexaco.emotionality",
  extraversion: "hexaco.extraversion",
  agreeableness: "hexaco.agreeableness",
  conscientiousness: "hexaco.conscientiousness",
  openness: "hexaco.openness",
  // Regulatory focus (0 = prevention, 100 = promotion)
  regulatoryFocus: "regfocus.orientation",
  // Cognition / dual-process (0 = intuitive/System-1, 100 = deliberate/System-2)
  needForCognition: "cognition.need_for_cognition",
  reflection: "cognition.reflection",
  // Decision style (GDMS) + maximizing
  decisionRational: "decision.rational",
  decisionIntuitive: "decision.intuitive",
  decisionDependent: "decision.dependent",
  decisionSpontaneous: "decision.spontaneous",
  maximizing: "decision.maximizing",
  // Moral Foundations
  moralCare: "moral.care",
  moralFairness: "moral.fairness",
  moralLoyalty: "moral.loyalty",
  moralAuthority: "moral.authority",
  moralSanctity: "moral.sanctity",
  moralLiberty: "moral.liberty",
  // Thomas-Kilmann conflict axes (mode is derived from the two)
  conflictAssertiveness: "conflict.assertiveness",
  conflictCooperativeness: "conflict.cooperativeness",
  // Schwartz basic values
  valSelfDirection: "values.self_direction",
  valStimulation: "values.stimulation",
  valHedonism: "values.hedonism",
  valAchievement: "values.achievement",
  valPower: "values.power",
  valSecurity: "values.security",
  valConformity: "values.conformity",
  valTradition: "values.tradition",
  valBenevolence: "values.benevolence",
  valUniversalism: "values.universalism",
  // Dispositional
  grit: "disp.grit",
  locusInternal: "disp.locus_internal",
  riskTolerance: "disp.risk_tolerance",
} as const;

export type PsychDimKey = keyof typeof PSYCH_DIM;
export type PsychDimId = (typeof PSYCH_DIM)[PsychDimKey];

// ── Trait-scoring primitives (shared by the psychometric compiler + limbic) ──────
// The 0..100 trait scale thresholds and the scorer live here — the one neutral
// module both `psychometrics.ts` and `limbic.ts` already import — so the two
// compilers read a trait vector identically and neither owns the other's constants.

/** Score at/above which a trait reads as "high". */
export const HI = 65;
/** Score at/below which a trait reads as "low". */
export const LO = 35;
/** The resting/absent score — a fully untouched trait. */
export const NEUTRAL = 50;

/**
 * Clamp a raw trait score to 0..100, mapping an absent/NaN value to {@link NEUTRAL}.
 * The single shared scorer for both the limbic setpoint derivation and the
 * psychometric compiler, so both read a trait vector identically.
 */
export function score(vector: Record<string, number> | undefined, id: string): number {
  const raw = vector?.[id];
  if (typeof raw !== "number" || Number.isNaN(raw)) return NEUTRAL;
  return Math.max(0, Math.min(100, raw));
}
