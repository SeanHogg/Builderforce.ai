/**
 * Finetune output evaluation — the REAL AI-judge scoring for the IDE-native LoRA
 * pipeline (`POST /ide/training/:id/evaluate`).
 *
 * Historically that route generated model outputs (paid gateway calls) and then
 * threw them away, hard-coding `score = 0.85`. This module replaces that with a
 * genuine judge: it asks the gateway to score the fine-tuned outputs against the
 * dataset's expected outputs and parses a structured `{ score, code_correctness,
 * reasoning_quality, hallucination_rate, details }` back out. It mirrors the worker
 * pipeline's `worker/src/services/training.ts` judge (the two Workers can't share
 * runtime code), so both finetune paths score the same way.
 */
import { completeJson, type JsonProxy } from '../llm/completeJson';

/** One dataset row: an instruction (+ optional context) and its ideal output. */
export interface FinetuneExample {
  instruction: string;
  input?: string;
  output: string;
}

/** Structured judge verdict. Rates 0..1 except `hallucination_rate` (0 = none). */
export interface FinetuneEvalResult {
  score: number;
  code_correctness: number;
  reasoning_quality: number;
  hallucination_rate: number;
  details: string;
}

/** Anything with a `.complete()` that returns a gateway `ProxyResult` (ideProxy / tenantProxy). */
export type FinetuneJudgeService = JsonProxy;

const EVAL_SYSTEM_PROMPT = `You are an expert evaluator of fine-tuned language-model outputs.
Given instructions with their expected outputs and the model's actual outputs, judge quality.
Respond with ONLY a JSON object of the form:
{
  "score": 0.0-1.0,
  "code_correctness": 0.0-1.0,
  "reasoning_quality": 0.0-1.0,
  "hallucination_rate": 0.0-1.0,
  "details": "brief explanation"
}
Return ONLY the JSON object, no other text.`;

/** How many (example, output) pairs to send the judge — bounds cost + prompt size. */
const JUDGE_SAMPLE = 5;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, Number.isNaN(v) ? 0.5 : v));

/** Neutral fallback used when the judge is unreachable or returns unparseable text. */
function defaultResult(): FinetuneEvalResult {
  return {
    score: 0.5,
    code_correctness: 0.5,
    reasoning_quality: 0.5,
    hallucination_rate: 0.1,
    details: 'Evaluation completed with default scores (judge unavailable).',
  };
}

/**
 * Shape the judge's parsed reply into a clamped, structured result. Refuses a
 * non-object reply (so the caller falls back to neutral scores); a missing field
 * takes its neutral default rather than failing the whole verdict.
 */
export function readFinetuneEvaluation(value: unknown): FinetuneEvalResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const parsed = value as Partial<FinetuneEvalResult>;
  return {
    score: clamp01(Number(parsed.score ?? 0.5)),
    code_correctness: clamp01(Number(parsed.code_correctness ?? 0.5)),
    reasoning_quality: clamp01(Number(parsed.reasoning_quality ?? 0.5)),
    hallucination_rate: clamp01(Number(parsed.hallucination_rate ?? 0.1)),
    details: String(parsed.details ?? 'No details provided.'),
  };
}

/**
 * Run the AI judge over a sample of (expected, actual) pairs and return the
 * structured verdict. Never throws — a gateway failure yields neutral scores.
 */
export async function evaluateFinetuneOutputs(
  service: FinetuneJudgeService,
  examples: FinetuneExample[],
  modelOutputs: string[],
  maxTokens = 1024,
): Promise<FinetuneEvalResult> {
  if (examples.length === 0 || modelOutputs.length === 0) return defaultResult();
  const n = Math.min(examples.length, modelOutputs.length, JUDGE_SAMPLE);
  const sample = examples.slice(0, n);
  const outs = modelOutputs.slice(0, n);

  const evaluationPrompt = `Evaluate these model outputs against expected outputs:

${sample.map((ex, i) => `Example ${i + 1}:
Instruction: ${ex.instruction}${ex.input ? `\nContext: ${ex.input}` : ''}
Expected: ${ex.output}
Actual: ${outs[i] ?? '(no output)'}`).join('\n\n')}

Provide scores for: overall quality (score), code correctness, reasoning quality, and hallucination rate.`;

  const out = await completeJson(
    { kind: 'proxy', proxy: service },
    {
      system: EVAL_SYSTEM_PROMPT,
      user: evaluationPrompt,
      temperature: 0,
      maxTokens,
      useCase: 'finetune_evaluation',
    },
    readFinetuneEvaluation,
  );
  return out.ok ? out.value : defaultResult();
}
