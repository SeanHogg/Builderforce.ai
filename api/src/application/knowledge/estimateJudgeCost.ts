/**
 * estimateJudgeCost — what ONE judged section ≈ costs (PRD 38 §3.1 "≈ model calls and
 * cost", §4.8 `GET …/knowledge/judge/estimate`). The server is the only party that knows
 * where a judgement call routes, so the confirm chip asks it.
 *
 * It resolves the route the real call takes — `judgeRequest` through the gateway's own
 * seed + chain composition (`LlmProxyService.previewRoute`), no model call — and prices the
 * head of that chain with the price book:
 *
 *   input  ≈ memory's `AVG_SECTION_BYTES` of section text + the extract prompt and payload
 *            envelope, MEASURED from the real template ({@link sampleExtractRequest}), at
 *            the shared chars-per-token heuristic
 *   output ≈ {@link JUDGE_TYPICAL_OUTPUT_TOKENS} — a typical claims-and-entities JSON reply
 *
 * A model that runs on the tenant's own machine is `local` and free; a free-priced cloud
 * model is $0 but not local; a model the price book does not know is `perCallUsd: null`
 * (the chip then says the cost is shown after routing). Ports in, no I/O here.
 */
import { AVG_SECTION_BYTES } from '@seanhogg/builderforce-memory/knowledge';
import { KNOWLEDGE_EXTRACT_SYSTEM } from '@builderforce/agent-tools';
import { estimateCostUsd, isFreePrice, withPriceTiers, type ModelPrice } from '@builderforce/model-catalog';
import { estimateTokensFromChars } from '@builderforce/workload';
import { bodyFor } from '../llm/completeJson';
import type { ChatCompletionRequest } from '../llm/proxyTypes';
import { judgeRequest } from './judgeKnowledge';

/** Output tokens of a typical reply: a section's claims (subject/predicate/object + a ≤3-line
 *  quote each) and entities as JSON — a handful of claims, ~1 KB. */
export const JUDGE_TYPICAL_OUTPUT_TOKENS = 300;

export interface JudgeCostEstimate {
  /** ≈ USD of one judged section; 0 when free or local; null when the price is unknown. */
  perCallUsd: number | null;
  /** The model the call would route to first; null when nothing is routable. */
  model: string | null;
  /** True when that model runs on the tenant's own machine — no cost, no egress. */
  local: boolean;
}

export interface JudgeCostPorts {
  /** The models the request would try, in order — the gateway's chain, no dispatch. */
  route(body: ChatCompletionRequest): Promise<readonly string[]>;
  /** The model's list price per token, when the price book knows it. */
  price(model: string): ModelPrice | undefined;
  /** Does the model run on the tenant's own machine? */
  isLocal(model: string): boolean;
}

/** A representative extract question: an average section, the real prompt, a real ref's shape. */
export function sampleExtractRequest(): ChatCompletionRequest {
  return bodyFor(judgeRequest(KNOWLEDGE_EXTRACT_SYSTEM, { ref: 'src:web:folder:1::docs/section.md', text: 'x'.repeat(AVG_SECTION_BYTES) }));
}

/** Input tokens of {@link sampleExtractRequest}: every message's text, at the shared heuristic. */
export function sampleInputTokens(body: ChatCompletionRequest): number {
  const chars = body.messages.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length), 0);
  return estimateTokensFromChars(chars);
}

export async function estimateJudgeCost(ports: JudgeCostPorts): Promise<JudgeCostEstimate> {
  const body = sampleExtractRequest();
  const model = (await ports.route(body))[0] ?? null;
  if (!model) return { perCallUsd: null, model: null, local: false };
  if (ports.isLocal(model)) return { perCallUsd: 0, model, local: true };
  const flat = ports.price(model);
  if (!flat) return { perCallUsd: null, model, local: false };
  const price = withPriceTiers(model, flat);
  if (isFreePrice(price)) return { perCallUsd: 0, model, local: false };
  return { perCallUsd: estimateCostUsd(price, sampleInputTokens(body), JUDGE_TYPICAL_OUTPUT_TOKENS), model, local: false };
}
