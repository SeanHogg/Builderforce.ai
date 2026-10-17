/**
 * Model pool composition — WHICH models exist, in what order, for which plan.
 *
 * Carved out of `LlmProxyService`, which had grown to 3,240 lines and 77 exports:
 * the largest module in the application layer, and the one the most code depends
 * on. This half of it answers a question that has nothing to do with dispatching
 * a request — it is static catalog data plus the derivations over it (plan tiers,
 * coding pool, BYO flagships, attempt budgets, timeouts).
 *
 * Deliberately a LEAF: it imports the vendor catalogs and nothing else from this
 * package, so `poolRouting` can depend on it without a cycle back through the
 * service. (An earlier cut had `poolRouting` import these constants from
 * `LlmProxyService` directly, which deadlocked at module-eval time: the pool sets
 * are built eagerly at import, unlike drizzle's lazy table references.)
 *
 *
 * Itself split by concern so no half grows past a reviewable size; this file is the
 * PUBLIC BARREL every importer uses:
 *   - `modelPoolComposition` — plan pools, coding pool, supersession, coder set
 *   - `modelPoolSeeds`       — connected-account (BYO) seeding + preemption
 *   - `modelPoolRequestFlags`— strict pin / timeout override / cache TTL
 *   - `modelPoolFallbacks`   — fallback chains, backstops, budgets, timeouts
 *
 * `LlmProxyService` re-exports everything here, so no caller changed.
 */

export {
  PAID_LEAD_VENDOR,
  leadPoolWithVendor,
  FREE_MODEL_POOL,
  PRO_PAID_MODEL_POOL,
  PRO_MODEL_POOL,
  CODING_MODEL_POOL,
  SUPERSEDED_MODEL_IDS,
  canonicalModelId,
  CODING_DEFAULT_MODEL,
  BYO_FRONTIER_CODERS,
  RECOGNIZED_CODER_MODELS,
} from './modelPoolComposition';
export {
  byoAutoSeedModels,
  explicitModelPreemptsByo,
  isDispatchableSeed,
  isKnownModel,
  type ModelRefs,
} from './modelPoolSeeds';
export {
  resolveStrictPin,
  resolveVendorTimeoutOverride,
  resolveCacheTtl,
} from './modelPoolRequestFlags';
export {
  PREMIUM_PRIORITY_POOL,
  PREMIUM_VENDOR_CALL_TIMEOUT_MS,
  FREE_VENDOR_CALL_TIMEOUT_MS,
  GUARANTEED_BACKSTOP_MODEL,
  CHEAPEST_PAID_CODER,
  CODING_PREMIUM_FALLBACK_MODELS,
  CODING_BACKSTOP_MODELS,
  PREMIUM_FALLBACK_MODELS,
  PAID_OVERFLOW_MODELS,
  isPaidOverflowModel,
  FREE_ATTEMPT_BUDGET,
  PRO_FREE_ATTEMPT_BUDGET,
  freeAttemptBudgetForPlan,
  CODING_FREE_ATTEMPT_BUDGET,
  PREFERRED_POOL_SIZE,
  COOLDOWN_PREFETCH_LIMIT,
} from './modelPoolFallbacks';
