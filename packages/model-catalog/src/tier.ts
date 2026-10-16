/**
 * The model TIER ladder — what a model costs to serve, as a coarse band.
 *
 * FREE models are served at no marginal cost to the tenant (free upstream keys, the
 * platform's own floor); STANDARD → PREMIUM → ULTRA climb in price and, broadly, in
 * capability. A tier is catalog DATA attached to each model entry, never inferred
 * from a vendor name.
 */

export type ModelTier = 'FREE' | 'STANDARD' | 'PREMIUM' | 'ULTRA';

export const MODEL_TIERS: readonly ModelTier[] = ['FREE', 'STANDARD', 'PREMIUM', 'ULTRA'];

/** Rank for an UNKNOWN tier — sorts after every known one. */
export const UNKNOWN_TIER_RANK = 4;

const STRONGEST_FIRST: Readonly<Record<ModelTier, number>> = {
  ULTRA: 0,
  PREMIUM: 1,
  STANDARD: 2,
  FREE: 3,
};

/** Best-first rank (ULTRA 0 … FREE 3); unknown → {@link UNKNOWN_TIER_RANK}. Pure. */
export function tierRank(tier: string | undefined): number {
  return tier && tier in STRONGEST_FIRST ? STRONGEST_FIRST[tier as ModelTier] : UNKNOWN_TIER_RANK;
}

export function isModelTier(value: unknown): value is ModelTier {
  return typeof value === 'string' && value in STRONGEST_FIRST;
}
