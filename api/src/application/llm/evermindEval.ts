/**
 * Evermind eval scoring — the automatic pre/post regression check behind the
 * Knowledge Map's ▲/▼ version delta.
 *
 * Each merge produces a NEW version from the PREVIOUS one. To tell whether that merge
 * actually helped (or quietly regressed / forgot), the coordinator scores BOTH models
 * on a small held-out set of the project's previously-taught examples and compares the
 * mean next-token loss. A lower loss on the merged model = it fits the project's prior
 * tasks at least as well (no catastrophic forgetting); a higher loss = a regression the
 * chip surfaces. The set is "held out" because it is the examples accumulated BEFORE
 * this merge — this batch's own examples are added only afterwards, for the next merge.
 */
import type { EvermindLM } from '@seanhogg/builderforce-memory-engine';

/** One held-out eval example: the learned text, optionally with its task prompt. */
export interface EvalExample {
  prompt?: string;
  text: string;
}

/** Max tokens scored per example — bounds the forward/backward cost of eval. */
export const EVAL_MAX_TOKENS = 128;

/** Just the tokenizer surface eval needs (the engine's `BPETokenizer` satisfies it). */
interface EvalTokenizer {
  encode(text: string): number[];
}

/**
 * Mean next-token cross-entropy of `lm` on one example. Returns null when the example
 * is too short to score (needs ≥ 2 tokens). Uses `lossAndBackward` — the only loss the
 * LM exposes — whose gradient side effect is harmless here: we only read weights from
 * these models, never step an optimiser.
 */
function exampleLoss(lm: EvermindLM, tok: EvalTokenizer, ex: EvalExample, maxTokens: number): number | null {
  const text = (ex.prompt ? `${ex.prompt}\n` : '') + ex.text;
  const ids = tok.encode(text).slice(0, maxTokens);
  if (ids.length < 2) return null;
  const loss = lm.lossAndBackward(ids);
  return Number.isFinite(loss) && loss >= 0 ? loss : null;
}

/**
 * Mean loss of `lm` across `examples` (unscorable ones skipped). Returns null when
 * nothing was scorable, so the caller can decline to record a meaningless eval point.
 */
export function meanEvalLoss(
  lm: EvermindLM,
  tok: EvalTokenizer,
  examples: readonly EvalExample[],
  maxTokens: number = EVAL_MAX_TOKENS,
): number | null {
  let sum = 0;
  let n = 0;
  for (const ex of examples) {
    const l = exampleLoss(lm, tok, ex, maxTokens);
    if (l != null) {
      sum += l;
      n++;
    }
  }
  return n > 0 ? sum / n : null;
}
