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
  return text.toLowerCase().split(/[\s\W]+/).filter(Boolean);
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

// ── Public types ────────────────────────────────────────────────────────────

export interface EvalMaterials {
  question: string;
  answer: string;
  /** Retrieved/grounding context. Omit for a context-free relevance-only eval. */
  context?: string;
}

export interface EvalScores {
  faithfulness: number;
  answerRelevance: number;
  contextRelevance: number;
  hallucinationRate: number;
  /** Composite 0..1 quality score. */
  overall: number;
  method: 'llm' | 'lexical';
}

/** Weights for the composite. With context, faithfulness dominates; without it the
 *  score collapses onto answer relevance. Named so they are tunable in one place. */
export const EVAL_WEIGHTS = { faithfulness: 0.45, answerRelevance: 0.4, contextRelevance: 0.15 } as const;

function composite(s: Omit<EvalScores, 'overall' | 'method'>, hasContext: boolean): number {
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
  };
}

// ── LLM-as-judge backend ────────────────────────────────────────────────────

export type EvalJudge = (prompt: string) => Promise<string>;

/** Builds the rubric prompt. The judge must answer with a strict JSON object so
 *  {@link parseJudgeVerdict} can read it without prose-parsing. */
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
    `QUESTION:\n${m.question}`,
    '',
    `CONTEXT:\n${m.context ?? '(none provided)'}`,
    '',
    `ANSWER:\n${m.answer}`,
    '',
    'Respond with ONLY a JSON object, no prose:',
    '{"faithfulness":0.0,"answer_relevance":0.0,"context_relevance":0.0,"hallucination_rate":0.0}',
  ].join('\n');
}

/** Extracts and clamps the judge's JSON verdict. Returns null when no parseable
 *  object is present (caller falls back to the lexical backend). */
export function parseJudgeVerdict(text: string): Omit<EvalScores, 'overall' | 'method'> | null {
  const match = text.match(/\{[\s\S]*\}/);
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
        return {
          ...verdict,
          overall: composite(verdict, !!m.context && m.context.trim().length > 0),
          method: 'llm',
        };
      }
    } catch {
      // fall through to lexical
    }
  }
  return lexicalEval(m);
}
