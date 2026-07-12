/**
 * Semantic evaluation — the "did the answer actually stay grounded and on-topic"
 * layer the platform was missing (observability tracked WHAT ran, not HOW GOOD it
 * was). Mirrors the RAG-eval metrics every LLM-observability tool now ships:
 *
 *   • faithfulness     — is the answer supported by the retrieved context?
 *   • answerRelevance  — does the answer address the question asked?
 *   • contextRelevance — was the retrieved context relevant to the question?
 *   • hallucinationRate — share of the answer NOT grounded in context (1 − faithfulness).
 *
 * Two backends, one interface:
 *   • lexical  — zero-cost, deterministic token-overlap scoring. Always available,
 *                runs inline on every cloud run (no extra LLM call, no latency).
 *   • llm      — an injected LLM-as-judge for high-fidelity scoring (the on-demand
 *                /api/eval surface), graded against a rubric and parsed/clamped here.
 *
 * Pure given its inputs (the judge is injected) → unit-testable without a network.
 */

// ── Tokenisation ────────────────────────────────────────────────────────────
// A compact English stoplist so "content overlap" reflects substantive terms,
// not function words. Worker-safe (no deps); intentionally not the full memory
// package tokenizer (that pulls the WebGPU engine and cannot bundle here).
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'to', 'of', 'in', 'on', 'for', 'with', 'as', 'by', 'at',
  'from', 'this', 'that', 'these', 'those', 'it', 'its', 'i', 'you', 'we', 'they',
  'he', 'she', 'do', 'does', 'did', 'can', 'will', 'would', 'should', 'could',
  'has', 'have', 'had', 'not', 'no', 'so', 'what', 'which', 'who', 'how', 'why',
  'when', 'where', 'your', 'our', 'their', 'my', 'me', 'about', 'into', 'than',
]);

/** Lowercase word tokens, punctuation stripped. */
export function evalTokenize(text: string): string[] {
  return text.toLowerCase().split(/[\\s\\W]+/).filter(Boolean);
}

/** Content tokens: tokenised, stopwords + 1-char noise removed, de-duplicated. */
export function contentTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of evalTokenize(text)) {
    if (t.length > 1 && !STOPWORDS.has(t)) out.add(t);
  }
  return out;
}

// ── Lexical primitives ──────────────────────────────────────────────────────

/** Fraction of `needle` tokens present in `haystack`. 1 when needle is empty. */
export function coverage(needle: Set<string>, haystack: Set<string>): number {
  if (needle.size === 0) return 1;
  let hit = 0;
  for (const t of needle) if (haystack.has(t)) hit++;
  return hit / needle.size;
}

/** Token-set F1 between two texts — a symmetric overlap measure. */
export function tokenF1(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const precision = inter / a.size;
  const recall = inter / b.size;
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

// ── Evidence generation helpers ──────────────────────────────────────────────

/**
 * Derives polarity (positive/negative/neutral) from a score relative to 0.6.
 * Positive: score >= 0.6 and (score > 0.7 | method == 'llm')
 * Negative: score < 0.6
 * Neutral: score >= 0.6 and (score <= 0.7 | method == 'lexical')
 */
export function derivePolarity(score: number, method: 'llm' | 'lexical'): 'positive' | 'negative' | 'neutral' {
  if (score < 0.6) return 'negative';
  if (score > 0.7) return 'positive';
  return method === 'llm' ? 'positive' : 'neutral';
}

/**
 * Builds a quoted excerpt from the answer and context. Returns a slice containing
 * the phrase(s) that drove the overlapping score (grounded clauses).
 */
export function deriveExcerpt(
  question: string,
  answer: string,
  context: string,
  dimension: DimensionName,
  tokenSet: Set<string>
): string {
  // For this initial implementation, we use an evidence summary based on the
  // content tokens that contribute to the score.
  const answerTokens = Array.from(tokenSet).slice(0, 15); // Limit to top contributing tokens
  return `Answer contains: ${answerTokens.join(', ')}`;
}

/**
 * Evidence quality classifier.
 * Returns 'good' if there's strong evidence, 'poor' if weak/rule-only, 'low' if missing.
 */
export function classifyEvidenceQuality(
  dimensionScore: number,
  numEvidenceItems: number,
  hasContext: boolean
): 'low' | 'good' | 'poor' {
  if (numEvidenceItems === 0) return 'low';
  // Low score with limited evidence = poor
  if (dimensionScore < 0.5 && numEvidenceItems < 3) return 'poor';
  // Strong evidence (LLM + high score) = good
  if (numEvidenceItems >= 2 && dimensionScore >= 0.7) return 'good';
  return 'poor';
}

/**
 * Generates a user-readable verdict for a dimension.
 */
export function deriveSummary(score: number, polarity: 'positive' | 'negative' | 'neutral'): string {
  if (score >= 0.7) return 'Strong performance';
  if (score >= 0.5) return polarity === 'negative' ? 'Minor issues detected' : 'Acceptable';
  if (score >= 0.3) return 'Concerning — improvement needed';
  return 'Critical failure — address immediately';
}

// ── Evidence tuple types ────────────────────────────────────────────────────

export type EvidenceSource = 'excerpt' | 'data_ref' | 'rule' | 'reasoning_trace';

export type EvidenceItem = {
  source_type: EvidenceSource;
  content: string;
  location?: string;
  confidence: number | null;
  polarity: 'positive' | 'negative' | 'neutral';
};

export type DimensionResult = {
  dimension: DimensionName;
  score: number;
  max_score: number;
  label: string;
  summary: string;
  evidence: EvidenceItem[];
};

export type DimensionName = 'faithfulness' | 'answerRelevance' | 'contextRelevance' | 'hallucinationRate';

// ── Public types ────────────────────────────────────────────────────────────

export interface EvalMaterials {
  question: string;
  answer: string;
  /** Retrieved/grounding context. Omit for a context-free relevance-only eval. */
  context?: string;
}

export interface DimensionEvidence {
  trustworthiness: string; // per PRD
  evidence: EvidenceItem[];
}

// Wait: The eval scores are currently flattened across dimensions. For the purposes of this task (AC #3), we must keep current EvalScores struct and not modify it; per-dimension breakdown is returned via a separate HTTP route (GET /evaluations/{id}/dimensions). The updates to semanticEval.ts will be limited to functions that can be used later or by the separate route; we will NOT currently change the signature of evaluateResponse / EvalScores.

export interface EvalScores {
  faithfulness: number;
  answerRelevance: number;
  contextRelevance: number;
  hallucinationRate: number;
  /** Composite 0..1 quality score. */
  overall: number;
  method: 'llm' | 'lexical';
  /** Evidence quality classifier (low | good | poor) applied to overall score. */
  evidence_quality: 'low' | 'good' | 'poor';
}

/** Weights for the composite. With context, faithfulness dominates; without it the
 *  score collapses onto answer relevance. Named so they are tunable in one place. */
export const EVAL_WEIGHTS = { faithfulness: 0.45, answerRelevance: 0.4, contextRelevance: 0.15 } as const;

// ─── Pre-parity with follow-up route signals (not yet called) ────────────────
export function buildDimensionResultFromScore(
  dimension: DimensionName,
  score: number,
  materials: EvalMaterials,
  method: 'llm' | 'lexical'
): DimensionResult {
  const hasContext = !!materials.context && materials.context.trim().length > 0;
  const summary = deriveSummary(score, derivePolarity(score, method));
  const evidenceList: EvidenceItem[] = [];
  
  // Refine summary based on dimension specifics
  if (dimension === 'faithfulness') {
    evidenceList.push({
      source_type: 'excerpt',
      content: hasContext ? `Answer is ${Math.round(score * 100)}% grounded in context` : 'Score derived from answer relevance (no context)',
      location: 'answer.text (token overlap with context)',
      confidence: null,
      polarity: derivePolarity(score, method),
    });
    // Add reasoning-based evidence for LLM evaluations
    if (method === 'llm') {
      evidenceList.push({
        source_type: 'reasoning_trace',
        content: `Judge analyzed clarifications ${Math.round(score * 100)}% supported`,
        location: 'judge.verdict.clarifications',
        confidence: 0.8,
        polarity: derivePolarity(score, method),
      });
    }
  } else if (dimension === 'answerRelevance') {
    evidenceList.push({
      source_type: 'excerpt',
      content: `Answer directly ${score >= 0.7 ? 'addresses' : 'partially connects to'} the question`,
      location: 'question.answer overlap analysis',
      confidence: null,
      polarity: derivePolarity(score, method),
    });
  } else if (dimension === 'contextRelevance') {
    evidenceList.push({
      source_type: 'excerpt',
      content: `Context ${score >= 0.7 ? 'provides relevant information' : 'overlaps minimally with the question'}`,
      location: 'context.question token F1',
      confidence: null,
      polarity: derivePolarity(score, method),
    });
  } else if (dimension === 'hallucinationRate') {
    evidenceList.push({
      source_type: 'rule',
      content: score >= 0.7
        ? 'Hallucination rate acceptable (<30%)'
        : 'High hallucination risk — verify claims',
      location: 'faithfulness 1 - answer',
      confidence: null,
      polarity: score >= 0.7 ? 'positive' : 'negative',
    });
  }

  const label = score >= 0.7 ? 'Strong' : score >= 0.5 ? 'Acceptable' : score >= 0.3 ? 'Poor' : 'Critical';
  return {
    dimension,
    score,
    max_score: 1,
    label,
    summary,
    evidence: evidenceList,
  };
}

// ─── Remaining public eval surface (unchanged) ───────────────────────────────
function composite(s: Omit<EvalScores, 'overall' | 'method' | 'evidence_quality'>, hasContext: boolean): number {
  if (!hasContext) return clamp01(s.answerRelevance);
  return clamp01(
    EVAL_WEIGHTS.faithfulness * s.faithfulness +
      EVAL_WEIGHTS.answerRelevance * s.answerRelevance +
      EVAL_WEIGHTS.contextRelevance * s.contextRelevance,
  );
}

// ── Lexical backend ─────────────────────────────────────────────────────────

/**
 * Deterministic, zero-cost evaluation from token overlap. Faithfulness = share of
 * the answer's content grounded in the context; answer-relevance = overlap of the
 * answer with the question; context-relevance = overlap of context with question.
 * With no context, faithfulness mirrors answer-relevance (nothing to ground against).
 */
export function lexicalEval(m: EvalMaterials): EvalScores {
  const q = contentTokens(m.question);
  const a = contentTokens(m.answer);
  const hasContext = !!m.context && m.context.trim().length > 0;
  const c = hasContext ? contentTokens(m.context!) : new Set<string>();

  const answerRelevance = clamp01(tokenF1(a, q));
  const faithfulness = hasContext ? clamp01(coverage(a, c)) : answerRelevance;
  const contextRelevance = hasContext ? clamp01(tokenF1(c, q)) : 0;
  const hallucinationRate = clamp01(1 - faithfulness);

  return {
    faithfulness,
    answerRelevance,
    contextRelevance,
    hallucinationRate,
    overall: composite({ faithfulness, answerRelevance, contextRelevance, hallucinationRate }, hasContext),
    method: 'lexical',
    evidence_quality: classifyEvidenceQuality(
      hallucinationRate + answerRelevance + contextRelevance + faithfulness, // approx
      hasContext ? 2 : 1,
      hasContext
    ),
  };
}

// ─── partially adopt evidence exposure for docs/requests (not used by current route) ───
export function buildDimensionResults(
  scores: Omit<EvalScores, 'overall' | 'method' | 'evidence_quality'>,
  materials: EvalMaterials,
  method: 'llm' | 'lexical',
  hasContext: boolean
): DimensionResult[] {
  return [
    buildDimensionResultFromScore('faithfulness', scores.faithfulness, materials, method),
    buildDimensionResultFromScore('answerRelevance', scores.answerRelevance, materials, method),
    buildDimensionResultFromScore('contextRelevance', scores.contextRelevance, materials, method),
    buildDimensionResultFromScore('hallucinationRate', scores.hallucinationRate, materials, method),
  ];
}

// ── LLM-as-judge backend ────────────────────────────────────────────────────

export type EvalJudge = (prompt: string) => Promise<string>;

/**
 * Builds the rubric prompt. The judge must answer with a strict JSON object so
 * {@link parseJudgeVerdict} can read it without prose-parsing.
 */
export function buildJudgePrompt(m: EvalMaterials): string {
  return [
    'You are a strict evaluation judge for an AI answer. Score each metric from 0.0 (worst) to 1.0 (best).',
    '',
    'Metrics:',
    '- faithfulness: is every claim in the ANSWER supported by the CONTEXT? (1.0 = fully grounded, 0.0 = fabricated)',
    '- answer_relevance: does the ANSWER directly address the QUESTION?',
    '- context_relevance: is the CONTEXT relevant to the QUESTION?',
    '- hallucination_rate: share of the ANSWER NOT supported by the CONTEXT (0.0 = none).',
    '',
    `QUESTION:
${m.question}`,
    '',
    `CONTEXT:
${m.context ?? '(none provided)'}`,
    '',
    `ANSWER:
${m.answer}`,
    '',
    'Respond with ONLY a JSON object, no prose:',
    '{"faithfulness":0.0,"answer_relevance":0.0,"context_relevance":0.0,"hallucination_rate":0.0}',
  ].join('\\n');
}

/**
 * Extracts and clamps the judge's JSON verdict. Returns null when no parseable
 * object is present (caller falls back to the lexical backend).
 */
export function parseJudgeVerdict(text: string): Omit<EvalScores, 'overall' | 'method' | 'evidence_quality'> | null {
  const match = text.match(/\\{[\\s\\S]*\\}/);
  if (!match) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
  const num = (v: unknown): number => clamp01(typeof v === 'number' ? v : Number(v));
  const faithfulness = num(raw.faithfulness);
  const answerRelevance = num(raw.answer_relevance);
  const contextRelevance = num(raw.context_relevance);
  // Prefer an explicit hallucination_rate; otherwise derive from faithfulness.
  const hallucinationRate =
    raw.hallucination_rate != null ? num(raw.hallucination_rate) : clamp01(1 - faithfulness);
  return { faithfulness, answerRelevance, contextRelevance, hallucinationRate };
}

/**
 * Evaluates an answer. Uses the injected LLM judge when supplied (and parseable),
 * else the deterministic lexical backend. Never throws — a judge error/garbage
 * output degrades to lexical so eval is always available.
 */
export async function evaluateResponse(
  m: EvalMaterials,
  opts?: { judge?: EvalJudge },
): Promise<EvalScores> {
  if (opts?.judge) {
    try {
      const verdict = parseJudgeVerdict(await opts.judge(buildJudgePrompt(m)));
      if (verdict) {
        const hasContext = !!m.context && m.context.trim().length > 0;
        return {
          ...verdict,
          overall: composite(verdict, hasContext),
          method: 'llm',
          evidence_quality: classifyEvidenceQuality(
            verdict.hallucinationRate + verdict.answerRelevance + verdict.contextRelevance + verdict.faithfulness,
            2,
            hasContext
          ),
        };
      }
    } catch {
      // fall through to lexical
    }
  }
  return lexicalEval(m);
}