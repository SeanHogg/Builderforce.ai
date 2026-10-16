/**
 * `@builderforce/model-catalog` — the catalog vocabulary shared by every routing host
 * (the Worker gateway, the editor, the on-prem runtime, the browser).
 *
 * Owns the words, not the model data: tier, price, residency and the CatalogView port.
 * Each host keeps its own registry and binds it to the port. The one table it does own
 * is the BYO provider list (`providers.ts`) — a vocabulary every host must agree on
 * word for word. Pure and I/O-free.
 */

export { MODEL_TIERS, UNKNOWN_TIER_RANK, isModelTier, tierRank, type ModelTier } from './tier.js';
export { ZERO_PRICE, estimateCostUsd, isFreePrice, type ModelPrice } from './price.js';
export { residencyOf, type CatalogView, type ModelResidency } from './view.js';
export {
  LLM_PROVIDERS,
  LLM_PROVIDER_INFO,
  isLlmProvider,
  llmProviderInfo,
  supportsSubscription,
  type LlmLocalRuntimeHints,
  type LlmProvider,
  type LlmProviderCredential,
  type LlmProviderInfo,
  type LlmProviderSubscriptionGrant,
} from './providers.js';
