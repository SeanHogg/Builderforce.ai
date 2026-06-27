/**
 * Psychometric persona catalog (Pro feature) — the source of truth the UI renders.
 *
 * This is the `api`-side half of the system. It owns the human-facing catalog
 * (framework names, dimension labels, the questionnaire bank) and server-side
 * scoring; agent-runtime owns the behavioural compiler. The dimension-id strings
 * both sides key on now come from ONE shared map (`@builderforce/agent-tools`
 * PSYCH_DIM), re-exported here as `DIM` so existing api consumers are unchanged.
 */
import { PSYCH_DIM } from '@builderforce/agent-tools';

// Dimension ids — the single shared map (was duplicated here + in agent-runtime).
export const DIM = PSYCH_DIM;

export type CatalogDimension = {
  id: string;
  name: string;
  /** label for a score near 0 */
  low: string;
  /** label for a score near 100 */
  high: string;
  description: string;
};

export type CatalogFramework = {
  id: string;
  name: string;
  summary: string;
  dimensions: CatalogDimension[];
};

const d = (
  id: string,
  name: string,
  low: string,
  high: string,
  description: string,
): CatalogDimension => ({ id, name, low, high, description });

/** The full framework suite. Each dimension is scored 0..100; 50 = neutral. */
export const PSYCHOMETRIC_CATALOG: CatalogFramework[] = [
  {
    id: 'hexaco',
    name: 'HEXACO personality',
    summary: 'The validated six-factor spine — Big Five plus Honesty-Humility.',
    dimensions: [
      d(DIM.honesty, 'Honesty-Humility', 'Pragmatic', 'Sincere & humble', 'Sincerity, fairness, and resistance to sycophancy. High = never overstates, admits uncertainty.'),
      d(DIM.emotionality, 'Emotionality', 'Unflappable', 'Sensitive to risk', 'Sensitivity to risk and uncertainty. High = surfaces and escalates concerns early.'),
      d(DIM.extraversion, 'Extraversion', 'Reserved', 'Outgoing', 'Social energy and proactivity. High = communicative, volunteers updates.'),
      d(DIM.agreeableness, 'Agreeableness', 'Challenging', 'Accommodating', 'Tendency to defer vs. challenge. High = seeks consensus; low = pushes back.'),
      d(DIM.conscientiousness, 'Conscientiousness', 'Spontaneous', 'Methodical', 'Thoroughness and planning. High = plans, tests, double-checks before done.'),
      d(DIM.openness, 'Openness', 'Conventional', 'Inventive', 'Appetite for novelty. High = explores new approaches; low = proven patterns.'),
    ],
  },
  {
    id: 'regfocus',
    name: 'Regulatory focus',
    summary: 'Promotion (opportunity-seeking) vs. prevention (error-avoiding).',
    dimensions: [
      d(DIM.regulatoryFocus, 'Orientation', 'Prevention', 'Promotion', 'High = optimise for speed and upside; low = optimise for safety and correctness.'),
    ],
  },
  {
    id: 'cognition',
    name: 'Cognition (dual-process)',
    summary: 'How much the agent deliberates vs. trusts intuition.',
    dimensions: [
      d(DIM.needForCognition, 'Need for cognition', 'Intuitive (System 1)', 'Deliberate (System 2)', 'High = reasons step-by-step and analyses deeply; low = acts on pattern-matching.'),
      d(DIM.reflection, 'Reflection', 'Acts on first answer', 'Verifies reasoning', 'High = distrusts the first intuitive answer and checks before acting.'),
    ],
  },
  {
    id: 'decision',
    name: 'Decision style',
    summary: 'How decisions get made (GDMS) and how thoroughly options are weighed.',
    dimensions: [
      d(DIM.decisionRational, 'Rational', 'Low', 'High', 'Decides analytically, making trade-offs explicit.'),
      d(DIM.decisionIntuitive, 'Intuitive', 'Low', 'High', 'Trusts well-earned intuition when evidence is thin.'),
      d(DIM.decisionDependent, 'Dependent', 'Low', 'High', 'Seeks input/confirmation from a human or peer before committing.'),
      d(DIM.decisionSpontaneous, 'Spontaneous', 'Low', 'High', 'Decides quickly and keeps momentum on reversible calls.'),
      d(DIM.maximizing, 'Maximizing vs. satisficing', 'Satisficer', 'Maximizer', 'High = optimises for the best option; low = stops at good-enough.'),
    ],
  },
  {
    id: 'moral',
    name: 'Moral foundations',
    summary: 'The values lens used to resolve trade-offs (feeds governance).',
    dimensions: [
      d(DIM.moralCare, 'Care', 'Low', 'High', 'Prioritise user wellbeing and avoiding harm.'),
      d(DIM.moralFairness, 'Fairness', 'Low', 'High', 'Treat stakeholders equitably and proportionately.'),
      d(DIM.moralLoyalty, 'Loyalty', 'Low', 'High', "Protect the team's and project's interests."),
      d(DIM.moralAuthority, 'Authority', 'Low', 'High', 'Respect established policy and ownership boundaries.'),
      d(DIM.moralSanctity, 'Sanctity', 'Low', 'High', 'Uphold code, data, and process integrity.'),
      d(DIM.moralLiberty, 'Liberty', 'Low', 'High', 'Preserve user autonomy; avoid over-constraining.'),
    ],
  },
  {
    id: 'conflict',
    name: 'Conflict style (Thomas-Kilmann)',
    summary: 'Two axes whose combination yields the conflict mode.',
    dimensions: [
      d(DIM.conflictAssertiveness, 'Assertiveness', 'Yielding', 'Assertive', 'Degree to which the agent pursues its own position in disagreement.'),
      d(DIM.conflictCooperativeness, 'Cooperativeness', 'Independent', 'Cooperative', "Degree to which the agent accommodates others' concerns."),
    ],
  },
  {
    id: 'values',
    name: 'Schwartz basic values',
    summary: 'Universal value priorities used when goals conflict.',
    dimensions: [
      d(DIM.valSelfDirection, 'Self-direction', 'Low', 'High', 'Independent thought and action.'),
      d(DIM.valStimulation, 'Stimulation', 'Low', 'High', 'Novelty and challenge.'),
      d(DIM.valHedonism, 'Hedonism', 'Low', 'High', 'Pleasure and enjoyment.'),
      d(DIM.valAchievement, 'Achievement', 'Low', 'High', 'Visible success and competence.'),
      d(DIM.valPower, 'Power', 'Low', 'High', 'Control, status, and ownership.'),
      d(DIM.valSecurity, 'Security', 'Low', 'High', 'Safety, stability, and order.'),
      d(DIM.valConformity, 'Conformity', 'Low', 'High', 'Adherence to norms and expectations.'),
      d(DIM.valTradition, 'Tradition', 'Low', 'High', 'Respect for established conventions.'),
      d(DIM.valBenevolence, 'Benevolence', 'Low', 'High', 'Care for close others and the team.'),
      d(DIM.valUniversalism, 'Universalism', 'Low', 'High', 'Concern for the wider good.'),
    ],
  },
  {
    id: 'disposition',
    name: 'Disposition',
    summary: 'Persistence, ownership, and risk appetite.',
    dimensions: [
      d(DIM.grit, 'Grit', 'Escalates early', 'Persists', 'High = retries intelligently and exhausts approaches before giving up.'),
      d(DIM.locusInternal, 'Locus of control', 'External', 'Internal', 'High = owns outcomes and drives failures to resolution.'),
      d(DIM.riskTolerance, 'Risk tolerance', 'Risk-averse', 'Risk-seeking', 'High = accepts calculated risk for speed; low = prefers safe, reversible steps.'),
    ],
  },
];

/** Enneagram is typological (a category, not a scale) — offered separately. */
export const ENNEAGRAM_TYPES: Array<{ type: number; name: string; motivation: string }> = [
  { type: 1, name: 'Reformer', motivation: 'be correct and principled' },
  { type: 2, name: 'Helper', motivation: 'be helpful and needed' },
  { type: 3, name: 'Achiever', motivation: 'achieve and be effective' },
  { type: 4, name: 'Individualist', motivation: 'be authentic and distinctive' },
  { type: 5, name: 'Investigator', motivation: 'understand deeply' },
  { type: 6, name: 'Loyalist', motivation: 'be secure and prepared' },
  { type: 7, name: 'Enthusiast', motivation: 'explore options and keep momentum' },
  { type: 8, name: 'Challenger', motivation: 'take charge and protect' },
  { type: 9, name: 'Peacemaker', motivation: 'keep things stable and harmonious' },
];

// ---------------------------------------------------------------------------
// Questionnaire intake + scoring
// ---------------------------------------------------------------------------

export type CatalogQuestion = {
  id: string;
  dimension: string;
  text: string;
  /** When true, a high agreement maps to a LOW score on the dimension. */
  reverse?: boolean;
};

const q = (id: string, dimension: string, text: string, reverse = false): CatalogQuestion => ({
  id,
  dimension,
  text,
  reverse,
});

/**
 * A compact validated-style intake. Each item is a 1..5 Likert (Strongly disagree
 * → Strongly agree). Two items per high-leverage dimension, one for the rest.
 */
export const PSYCHOMETRIC_QUESTIONS: CatalogQuestion[] = [
  q('c1', DIM.conscientiousness, 'I plan my work carefully and check it before calling it done.'),
  q('c2', DIM.conscientiousness, 'I often dive in and figure things out as I go.', true),
  q('o1', DIM.openness, 'I enjoy trying unconventional approaches to a problem.'),
  q('o2', DIM.openness, 'I prefer sticking to proven, familiar methods.', true),
  q('e1', DIM.emotionality, 'I tend to worry about what could go wrong.'),
  q('x1', DIM.extraversion, 'I proactively share updates and options without being asked.'),
  q('a1', DIM.agreeableness, 'I would rather find consensus than argue my point.'),
  q('a2', DIM.agreeableness, 'I push back directly when I think someone is wrong.', true),
  q('h1', DIM.honesty, "I will admit uncertainty even when it's not what people want to hear."),
  q('r1', DIM.regulatoryFocus, 'I focus more on seizing opportunities than on avoiding mistakes.'),
  q('n1', DIM.needForCognition, 'I enjoy working through complex problems step by step.'),
  q('n2', DIM.needForCognition, 'I prefer quick answers over lengthy analysis.', true),
  q('rf1', DIM.reflection, 'I double-check my first instinct before acting on it.'),
  q('dr1', DIM.decisionRational, 'I weigh the trade-offs explicitly before deciding.'),
  q('di1', DIM.decisionIntuitive, 'I often trust my gut when the data is thin.'),
  q('dd1', DIM.decisionDependent, 'I like to confirm consequential decisions with someone first.'),
  q('ds1', DIM.decisionSpontaneous, 'I make reversible decisions quickly to keep momentum.'),
  q('mx1', DIM.maximizing, 'I keep looking for a better option even after I find a workable one.'),
  q('mc1', DIM.moralCare, 'Avoiding harm to users matters more to me than almost anything.'),
  q('mf1', DIM.moralFairness, 'Treating everyone fairly is a core principle for me.'),
  q('ml1', DIM.moralLoyalty, 'I feel a strong duty to protect my team.'),
  q('ma1', DIM.moralAuthority, 'Respecting established rules and ownership is important to me.'),
  q('msa1', DIM.moralSanctity, 'Keeping things clean and well-ordered matters to me.'),
  q('mli1', DIM.moralLiberty, 'I dislike imposing unnecessary constraints on people.'),
  q('ca1', DIM.conflictAssertiveness, 'In a disagreement I push hard for the outcome I believe in.'),
  q('cc1', DIM.conflictCooperativeness, "In a disagreement I work to satisfy everyone's concerns."),
  q('g1', DIM.grit, 'I keep going on hard problems long after others would quit.'),
  q('lc1', DIM.locusInternal, 'When something fails, I focus on what I can do to fix it.'),
  q('rt1', DIM.riskTolerance, 'I am comfortable taking calculated risks to move faster.'),
];

/**
 * Score a set of Likert answers (questionId -> 1..5) into a 0..100 trait vector.
 * Only dimensions with at least one answer appear in the result. Pure function.
 */
export function scoreQuestionnaire(answers: Record<string, number>): Record<string, number> {
  const byDimension = new Map<string, number[]>();
  const questionById = new Map(PSYCHOMETRIC_QUESTIONS.map((item) => [item.id, item]));

  for (const [id, raw] of Object.entries(answers)) {
    const item = questionById.get(id);
    if (!item) continue;
    const likert = Math.max(1, Math.min(5, Number(raw)));
    if (Number.isNaN(likert)) continue;
    let pct = ((likert - 1) / 4) * 100;
    if (item.reverse) pct = 100 - pct;
    const list = byDimension.get(item.dimension) ?? [];
    list.push(pct);
    byDimension.set(item.dimension, list);
  }

  const vector: Record<string, number> = {};
  for (const [dimension, values] of byDimension) {
    vector[dimension] = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  }
  return vector;
}

/** Every valid dimension id (for validating imported vectors). */
export const VALID_DIMENSION_IDS = new Set<string>(Object.values(DIM));

/**
 * Sanitise an externally-supplied vector (e.g. a human's imported test results):
 * keep only known dimension ids and clamp values to 0..100.
 */
export function sanitizeVector(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!VALID_DIMENSION_IDS.has(key)) continue;
    const n = Number(value);
    if (Number.isNaN(n)) continue;
    out[key] = Math.max(0, Math.min(100, Math.round(n)));
  }
  return out;
}
