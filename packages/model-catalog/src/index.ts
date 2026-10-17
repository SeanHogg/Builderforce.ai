/**
 * `@builderforce/model-catalog` — the catalog vocabulary shared by every routing host
 * (the Worker gateway, the editor, the on-prem runtime, the browser).
 *
 * Owns the words, not the model data: tier (and THE tier rule), price, residency and the
 * CatalogView port. Each host keeps its own registry and binds it to the port. The two
 * tables it does own are ones every host must agree on word for word: the BYO provider
 * list (`providers.ts`) and Anthropic's release line (`anthropic.ts`). Pure and I/O-free.
 */

export {
  MODEL_TIERS,
  UNKNOWN_TIER_RANK,
  isModelTier,
  resolveModelTier,
  tierForPrice,
  tierRank,
  type ListingTier,
  type ModelTier,
} from './tier.js';
export {
  TOKENS_PER_MILLION,
  ZERO_PRICE,
  estimateCostUsd,
  isFreePrice,
  perMillionToPerToken,
  perTokenToPerMillion,
  type ModelPrice,
} from './price.js';
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
export {
  ANTHROPIC_FAMILIES,
  ANTHROPIC_RELEASES,
  anthropicFamilyAliases,
  anthropicModelId,
  anthropicModelIdsSince,
  currentAnthropicModelId,
  olderAnthropicTemplateIds,
  parseAnthropicModelId,
  resolveAnthropicShortAlias,
  supersededAnthropicModelIds,
  type AnthropicFamily,
  type ParsedAnthropicId,
} from './anthropic.js';
