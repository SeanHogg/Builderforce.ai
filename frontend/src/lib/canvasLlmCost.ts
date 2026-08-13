/**
 * What an LLM architecture COSTS, computed at the moment it is chosen.
 *
 * ── THE DEFECT THIS CLOSES ───────────────────────────────────────────────────────
 * LLM work is bought by the token, and the `llm` object had no tokens on it: `model`,
 * `instructions`, `parameters`, and a default status of `'Blueprint'`. No cost model,
 * no tokens per request, no latency, no throughput. Meanwhile the platform records
 * every one of those numbers — `agent_inference_logs`, `run_model_outcomes`,
 * `llm_usage_log` — and none of it reached the surface where the architecture is
 * actually DECIDED.
 *
 * So the board could not answer "what does this cost at a million requests a month",
 * which is the question that decides whether an LLM feature ships at all. A design
 * surface that cannot price its own design is a whiteboard.
 *
 * ── WHY THE PROJECTION IS DERIVED AND NOT AUTHORED ──────────────────────────────
 * `projectedMonthlyCost` is computed from the rate card and the volume rather than
 * typed, for the same reason `erd.ddl` is generated from `dataModel`: a card that can
 * hold a price disagreeing with its own inputs will eventually hold one, and it will be
 * the number somebody quotes in a meeting.
 */

export interface LlmCostInputs {
  costPerMillionInput?: number | null;
  costPerMillionOutput?: number | null;
  tokensPerRequestIn?: number | null;
  tokensPerRequestOut?: number | null;
  monthlyRequests?: number | null;
  /** Share of requests served from the prompt cache, 0–1. */
  cacheHitRate?: number | null;
}

export interface LlmCostProjection {
  /** Cost of one request, in the rate card's currency. */
  costPerRequest: number;
  monthlyCost: number;
  /** The split, because input and output tokens are priced very differently and
   *  which side dominates decides what is worth optimising. */
  inputShare: number;
  outputShare: number;
  /** Tokens per month, for the quota conversation that always follows. */
  monthlyTokens: number;
  /** True when a required input was missing, so the caller renders "—" and not 0. */
  incomplete: boolean;
}

function positive(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

const PER_MILLION = 1_000_000;

/**
 * Project monthly spend from a rate card and a volume.
 *
 * `incomplete` exists so a partially-filled card renders a dash rather than a
 * confident $0.00 — the same argument the aggregate formatter makes, in the place
 * where a spurious zero is most expensive: "this feature is free" is a much more
 * actionable-looking wrong answer than a blank.
 *
 * Cache hits are modelled as a discount on INPUT tokens only, which is how every
 * provider's prompt caching actually prices: the output is generated fresh every time,
 * so a design that assumes caching discounts the whole request will underestimate by
 * roughly the output share — the exact number this function also returns.
 */
export function projectLlmCost(inputs: LlmCostInputs): LlmCostProjection {
  const inputRate = positive(inputs.costPerMillionInput);
  const outputRate = positive(inputs.costPerMillionOutput);
  const tokensIn = positive(inputs.tokensPerRequestIn);
  const tokensOut = positive(inputs.tokensPerRequestOut);
  const requests = positive(inputs.monthlyRequests);
  const cacheHitRate = Math.min(1, Math.max(0, positive(inputs.cacheHitRate) ?? 0));

  const incomplete = inputRate == null || outputRate == null || tokensIn == null || tokensOut == null || requests == null;

  const effectiveInputTokens = (tokensIn ?? 0) * (1 - cacheHitRate);
  const inputCost = effectiveInputTokens * (inputRate ?? 0) / PER_MILLION;
  const outputCost = (tokensOut ?? 0) * (outputRate ?? 0) / PER_MILLION;
  const costPerRequest = inputCost + outputCost;
  const total = costPerRequest || 1;

  return {
    costPerRequest: Number(costPerRequest.toFixed(6)),
    monthlyCost: Number((costPerRequest * (requests ?? 0)).toFixed(2)),
    inputShare: Number((inputCost / total).toFixed(4)),
    outputShare: Number((outputCost / total).toFixed(4)),
    monthlyTokens: Math.round(((tokensIn ?? 0) + (tokensOut ?? 0)) * (requests ?? 0)),
    incomplete,
  };
}
