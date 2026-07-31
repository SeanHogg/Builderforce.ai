/**
 * Money units — the ONE definition of the millicents↔USD conversion.
 *
 * Agent LLM spend is stored in **millicents** (1/100000 USD) across the schema
 * (see migration 0097) so sub-cent per-call costs don't round to zero. Every USD
 * projection divides by {@link MILLICENTS_PER_USD} (or uses {@link millicentsToUsd}),
 * so the factor lives here once instead of being re-declared per module.
 */

/** 1 US dollar = 100,000 millicents. */
export const MILLICENTS_PER_USD = 100_000;

/** Convert a millicents amount to USD. Nullish → 0 (mirrors `Number(x ?? 0) / …`). */
export function millicentsToUsd(millicents: number | null | undefined): number {
  return Number(millicents ?? 0) / MILLICENTS_PER_USD;
}
