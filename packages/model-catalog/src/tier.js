/**
 * The model TIER ladder — what a model costs to serve, as a coarse band.
 *
 * FREE models are served at no marginal cost to the tenant (free upstream keys, the
 * platform's own floor); STANDARD → PREMIUM → ULTRA climb in price and, broadly, in
 * capability. A tier is catalog DATA attached to each model entry, never inferred
 * from a vendor name.
 */
import { perTokenToPerMillion } from './price.js';
export const MODEL_TIERS = ['FREE', 'STANDARD', 'PREMIUM', 'ULTRA'];
/** Rank for an UNKNOWN tier — sorts after every known one. */
export const UNKNOWN_TIER_RANK = 4;
const STRONGEST_FIRST = {
    ULTRA: 0,
    PREMIUM: 1,
    STANDARD: 2,
    FREE: 3,
};
/** Best-first rank (ULTRA 0 … FREE 3); unknown → {@link UNKNOWN_TIER_RANK}. Pure. */
export function tierRank(tier) {
    return tier && tier in STRONGEST_FIRST ? STRONGEST_FIRST[tier] : UNKNOWN_TIER_RANK;
}
export function isModelTier(value) {
    return typeof value === 'string' && value in STRONGEST_FIRST;
}
/**
 * Output-price bands (USD per MILLION output tokens) the ladder is cut at, for a model
 * whose catalog carries no tier. Output dominates an agent turn, so it decides the band:
 *   FREE      0 both ways — free pools, free upstream keys, local inference
 *   STANDARD  (0, 8)      — small / open-weight hosted models
 *   PREMIUM   [8, 20)     — the frontier workhorses (Sonnet-class)
 *   ULTRA     >= 20       — the flagships (Opus / Fable-class)
 */
const STANDARD_MAX_OUTPUT_PER_MILLION = 8;
const PREMIUM_MAX_OUTPUT_PER_MILLION = 20;
/** The FALLBACK tier: the band a per-token price falls in. Pure. */
export function tierForPrice(price) {
    if (price.input === 0 && price.output === 0)
        return 'FREE';
    const outputPerMillion = perTokenToPerMillion(price.output);
    if (outputPerMillion < STANDARD_MAX_OUTPUT_PER_MILLION)
        return 'STANDARD';
    return outputPerMillion < PREMIUM_MAX_OUTPUT_PER_MILLION ? 'PREMIUM' : 'ULTRA';
}
/**
 * THE tier rule every host applies: the catalog's own tier when it has one (tier is
 * catalog DATA), else the price band ({@link tierForPrice}), else unknown — never a
 * guess. A host with no curated tier column passes only its price. Pure.
 */
export function resolveModelTier(known) {
    if (known.catalogTier)
        return known.catalogTier;
    return known.price ? tierForPrice(known.price) : undefined;
}
/**
 * Tiers a run's PLANNING can lean on for long multi-step tool use — the Sonnet-class
 * workhorses and up. FREE and STANDARD are the Flash-class band (small / open-weight /
 * free pools): fine for a turn, weak for planning a change across a codebase. Pure.
 */
export const AGENTIC_TIERS = new Set(['PREMIUM', 'ULTRA']);
/** True for an agentic tier, false for a Flash-class one, undefined when the tier is unknown. Pure. */
export function isAgenticTier(tier) {
    return tier ? AGENTIC_TIERS.has(tier) : undefined;
}
//# sourceMappingURL=tier.js.map