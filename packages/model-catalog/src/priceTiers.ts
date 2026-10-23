/**
 * LONG-CONTEXT PRICE TIERS (cost PRD C9) — DATA, one row per model family.
 *
 * Some models bill a whole request at a higher rate once its input crosses a boundary.
 * A packer that fills "the window" walks straight over that boundary and doubles the
 * price of every later turn for a few thousand tokens of context, so the hand-off budget
 * caps at the lowest boundary instead (`@builderforce/run-policy` `handoffTokenBudget`).
 *
 * Each row cites its source. VERIFY AGAINST THE VENDOR PRICING PAGE before changing a
 * rate or adding a row — these are published list prices, not something this repo
 * measures. Only families whose tiers are publicly documented are listed; a model with
 * no row is flat-priced as far as routing knows (the safe default: no cap).
 *
 * Keyed by a NORMALISED family id so every route to the same weights matches: vendor
 * prefixes (`googleai/`, `openrouter/google/`, `anthropic.` on Bedrock), `:free`-style
 * suffixes and dated snapshots are stripped, and `.` reads as `-`.
 */

import { perMillionToPerToken, type ModelPrice, type PriceTier } from './price.js';

const tier = (aboveInputTokens: number, inputPerMillion: number, outputPerMillion: number): PriceTier => ({
  aboveInputTokens,
  input: perMillionToPerToken(inputPerMillion),
  output: perMillionToPerToken(outputPerMillion),
});

/** family id → its long-context tiers, ascending. */
export const PRICE_TIERS: Readonly<Record<string, readonly PriceTier[]>> = Object.freeze({
  // Google AI Studio / Vertex list price: $1.25 / $10 per M up to 200K prompt tokens,
  // $2.50 / $15 above (ai.google.dev/gemini-api/docs/pricing). Verify against vendor pricing page.
  'gemini-2-5-pro': [tier(200_000, 2.5, 15)],
  // Anthropic long-context pricing for the 1M-window Sonnet 4 / 4.5: $3 / $15 per M up
  // to 200K input, $6 / $22.50 above (docs.claude.com pricing, "long context").
  // Verify against vendor pricing page.
  'claude-sonnet-4': [tier(200_000, 6, 22.5)],
  'claude-sonnet-4-5': [tier(200_000, 6, 22.5)],
  // Claude Haiku 5.5: $0.10 / $0.50 per M for prompts up to 100K, $0.50 / $2.50 beyond
  // (Anthropic model pricing table, 2026-10). Verify against vendor pricing page.
  'claude-haiku-5-5': [tier(100_000, 0.5, 2.5)],
});

/** Normalise a routed model id to its family key. PURE. */
export function priceTierFamily(modelId: string | null | undefined): string {
  let id = (modelId ?? '').trim().toLowerCase();
  id = id.slice(id.lastIndexOf('/') + 1); // vendor / OpenRouter org prefixes
  id = id.replace(/^(?:[a-z]{2,3}\.)?anthropic\./, ''); // Bedrock (`us.anthropic.…`)
  id = id.replace(/:.*$/, ''); // `:free`, `:beta`, Bedrock `:0` version suffix
  id = id.replace(/\./g, '-');
  id = id.replace(/-\d{8}(?:-v\d+)?$/, ''); // dated snapshot (`-20250929`, Bedrock `-v1`)
  return id;
}

/** The model's long-context tiers, or `undefined` when it is flat-priced. PURE. */
export function priceTiersFor(modelId: string | null | undefined): readonly PriceTier[] | undefined {
  return PRICE_TIERS[priceTierFamily(modelId)];
}

/** The LOWEST input size at which the model's price steps up, or `undefined`. PURE. */
export function priceTierBoundary(modelId: string | null | undefined): number | undefined {
  const tiers = priceTiersFor(modelId);
  return tiers && tiers.length > 0 ? Math.min(...tiers.map((t) => t.aboveInputTokens)) : undefined;
}

/** A host's flat price with the model's tiers attached (unchanged when it has none),
 *  so `estimateCostUsd` prices a long request at its real rate. PURE. */
export function withPriceTiers(modelId: string, price: ModelPrice): ModelPrice {
  const tiers = price.priceTiers ?? priceTiersFor(modelId);
  return tiers ? { ...price, priceTiers: tiers } : price;
}
