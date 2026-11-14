/**
 * Per-token PRICE — the input the router needs to compare models by what a call will
 * actually cost, BEFORE it is dispatched (the ledger prices it again, after, from the
 * provider's reported usage).
 *
 * Units are USD per token, the unit upstream catalogs publish, so a price book built
 * from them needs no conversion and the ledger and the router read the same number.
 */
/** Tokens in the million every rate card and marketplace price is quoted per. */
export const TOKENS_PER_MILLION = 1_000_000;
/** USD per million tokens (a rate card) → USD per token (this port). Pure. */
export function perMillionToPerToken(usdPerMillion) {
    return usdPerMillion / TOKENS_PER_MILLION;
}
/** USD per token (this port) → USD per million tokens (what a person reads). Pure. */
export function perTokenToPerMillion(usdPerToken) {
    return usdPerToken * TOKENS_PER_MILLION;
}
/** A price of zero both ways — local inference and free-tier models. */
export const ZERO_PRICE = Object.freeze({ input: 0, output: 0 });
/** Is this price free on both sides? Pure. */
export function isFreePrice(price) {
    return price.input === 0 && price.output === 0;
}
/**
 * Expected USD cost of one call. Non-finite or negative token counts count as 0 —
 * an estimate is never allowed to turn a price comparison into NaN. Pure.
 */
export function estimateCostUsd(price, inputTokens, outputTokens) {
    const tokens = (n) => (Number.isFinite(n) && n > 0 ? n : 0);
    const rate = rateForInput(price, tokens(inputTokens));
    return rate.input * tokens(inputTokens) + rate.output * tokens(outputTokens);
}
/** The per-token rates a request of `inputTokens` bills at: the highest tier whose
 *  boundary it exceeds, else the base price. Flat prices are returned unchanged. PURE. */
export function rateForInput(price, inputTokens) {
    let rate = price;
    let boundary = -1;
    for (const tier of price.priceTiers ?? []) {
        if (inputTokens > tier.aboveInputTokens && tier.aboveInputTokens > boundary) {
            rate = tier;
            boundary = tier.aboveInputTokens;
        }
    }
    return rate;
}
/** The lowest long-context boundary on a price, or `undefined` when it is flat. PURE. */
export function lowestTierBoundary(price) {
    const tiers = price?.priceTiers;
    if (!tiers || tiers.length === 0)
        return undefined;
    return Math.min(...tiers.map((t) => t.aboveInputTokens));
}
//# sourceMappingURL=price.js.map