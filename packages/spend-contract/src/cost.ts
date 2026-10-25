/**
 * THE price of one call's tokens — the rule the api's usage ledger stamps a row's cost
 * with, and the one a device prices its own calls with when nothing else can (PRD 36:
 * a VS Code chat's spend, offline). Declared once, here, so the figure a chat shows on
 * the device and the figure the ledger records for the same call are the same arithmetic.
 *
 * Money is in MILLICENTS (1/100000 USD) — the unit every spend column is stored in, so a
 * sub-cent call never rounds to zero.
 */

/** 1 US dollar = 100,000 millicents. */
export const MILLICENTS_PER_USD = 100_000;

/** Convert a millicents amount to USD. Nullish → 0. */
export function millicentsToUsd(millicents: number | null | undefined): number {
  return Number(millicents ?? 0) / MILLICENTS_PER_USD;
}

/** Cache-tier multipliers relative to the base input (prompt) price. cache_read is billed
 *  ~0.1× input, cache_creation ~1.25× — both are subsets of `promptTokens`. */
export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_CREATION_MULTIPLIER = 1.25;

/** The token counts one call reports. Cache tiers are subsets of `promptTokens`. */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

/**
 * What a call cost at `pricing` (USD per token), in millicents, with the cache tiers
 * discounted. Zero when there is no price. Pure.
 */
export function computeCostMillicents(
  pricing: { prompt: number; completion: number } | undefined,
  usage: TokenUsage,
): number {
  if (!pricing) return 0;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheCreation = usage.cacheCreationTokens ?? 0;
  const fullPrompt = Math.max(0, usage.promptTokens - cacheRead - cacheCreation);
  const usd =
    fullPrompt * pricing.prompt +
    cacheRead * pricing.prompt * CACHE_READ_MULTIPLIER +
    cacheCreation * pricing.prompt * CACHE_CREATION_MULTIPLIER +
    usage.completionTokens * pricing.completion;
  return Math.round(usd * 100_000);
}
