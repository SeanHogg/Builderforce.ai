/**
 * `@builderforce/model-catalog` — the catalog vocabulary shared by every routing host
 * (the Worker gateway, the editor, the on-prem runtime, the browser).
 *
 * Owns the words, not the data: tier, price, residency and the CatalogView port. Each
 * host keeps its own registry and binds it to the port. Pure and I/O-free.
 */

export { MODEL_TIERS, UNKNOWN_TIER_RANK, isModelTier, tierRank, type ModelTier } from './tier.js';
export { ZERO_PRICE, estimateCostUsd, isFreePrice, type ModelPrice } from './price.js';
export { residencyOf, type CatalogView, type ModelResidency } from './view.js';
