/**
 * `@builderforce/model-catalog` — the catalog vocabulary shared by every routing host
 * (the Worker gateway, the editor, the on-prem runtime, the browser).
 *
 * Owns the words, not the model data: tier (and THE tier rule), price (with its
 * long-context tiers, `priceTiers.ts`), residency and the CatalogView port. Each host keeps its own registry and binds it to the port. The two
 * tables it does own are ones every host must agree on word for word: the BYO provider
 * list (`providers.ts`) and Anthropic's release line (`anthropic.ts`) — plus the account's
 * cloud funding order (`cloudOrder.ts`), the free tier vs connected providers. It also
 * owns the PriceBook port (`priceBook.ts`) and the release's bundled price snapshot
 * (`snapshotPriceBook.ts`) a device prices its own calls with. Pure and I/O-free.
 */

export {
  AGENTIC_TIERS,
  MODEL_TIERS,
  UNKNOWN_TIER_RANK,
  isAgenticTier,
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
  lowestTierBoundary,
  perMillionToPerToken,
  perTokenToPerMillion,
  rateForInput,
  type ModelPrice,
  type PriceTier,
} from './price.js';
export { PRICE_TIERS, priceTierBoundary, priceTierFamily, priceTiersFor, withPriceTiers } from './priceTiers.js';
export {
  EMPTY_PRICE_BOOK,
  catalogPriceId,
  directCatalogId,
  listPriceOf,
  priceBookFromPrices,
  type PriceBook,
} from './priceBook.js';
export { snapshotPriceBook } from './snapshotPriceBook.js';
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
export { CLOUD_ORDERS, isCloudOrder, type CloudOrder } from './cloudOrder.js';
