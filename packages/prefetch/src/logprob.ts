/**
 * Tier 3: a local SLM's logprob classifier, through the host's {@link LogprobPort}
 * (`@builderforce/local-inference` `createLogprobPort`: Synapse → WebLLM → Ollama last).
 *
 * This side builds the prompt (the request and what each candidate action is for) and
 * turns the port's per-label log-probabilities into probabilities over the label set.
 * How a label becomes a token the engine can score is the port's concern.
 */

import { NEEDS_LLM } from './registry.js';
import type { PrefetchAction } from './types.js';

/** The fewest milliseconds left in the gate budget for tier 3 to be worth a call. */
export const TIER3_MIN_MS = 40;
/** Candidates (by tier-2 p) tier 3 scores beside `needs-llm` — a short label list keeps the pass cheap. */
export const TIER3_CANDIDATES = 6;
/** Tier 2 below this is not ambiguous, it is a miss — tier 3 is not asked. */
export const AMBIGUOUS_FLOOR = 0.25;
/** Examples shown per action in the prompt. */
const EXAMPLES_SHOWN = 3;

/** The classification prompt: the request, then each label with what it is for. */
export function logprobPrompt(request: string, actions: readonly PrefetchAction[]): string {
  const rows = actions.map((a) => `- ${a.id}: ${a.examples.slice(0, EXAMPLES_SHOWN).map((e) => `"${e}"`).join(', ')}`);
  return [
    'Classify the developer request into exactly one label.',
    'Pick an action label only when that action alone settles the request; otherwise pick needs-llm.',
    'Labels:',
    ...rows,
    `- ${NEEDS_LLM}: anything else — the request needs a model to reason, write or decide`,
    '',
    `Request: ${request.trim()}`,
  ].join('\n');
}

/**
 * Probabilities over `labels` from the port's log-probabilities: a softmax restricted to
 * the label set. A label the engine did not score is 0. Empty when it scored none.
 */
export function labelProbabilities(logprobs: Readonly<Record<string, number>>, labels: readonly string[]): Record<string, number> {
  const scored = labels.filter((l) => typeof logprobs[l] === 'number' && Number.isFinite(logprobs[l]));
  if (scored.length === 0) return {};
  const max = Math.max(...scored.map((l) => logprobs[l]!));
  const exp = new Map(scored.map((l) => [l, Math.exp(logprobs[l]! - max)] as const));
  const total = [...exp.values()].reduce((s, v) => s + v, 0);
  const out: Record<string, number> = {};
  for (const l of labels) out[l] = (exp.get(l) ?? 0) / total;
  return out;
}
