/**
 * builderforceLLM — multi-vendor LLM proxy.
 *
 * Routes chat completions through the vendor registry (`./vendors/`) so the
 * Free pool and Pro pool can cascade across OpenRouter / Cerebras / Ollama
 * without changes to callers.
 *
 * Responsibilities of this service (vs the vendor modules):
 *   - Plan-aware key selection: Pro plan prefers OPENROUTER_API_KEY_PRO,
 *     Free plan uses OPENROUTER_API_KEY. The vendor module itself is
 *     plan-agnostic.
 *   - Per-(vendor,model) cooldowns after any provider error (60s).
 *   - Round-robin within a small "preferred" sub-pool so repeated calls
 *     spread across the top-N quality models.
 *   - Streaming with first-chunk error peek (delegated to the streaming
 *     transport in vendors/types.ts).
 *
 * Single entry point:
 *   - `complete(body)` — chat completion. Routing is shape-driven: presence of
 *     `tools`, `response_format`, image content blocks, etc., influences the
 *     candidate chain inside the pool. Callers do not pass routing intents.
 */

import {
  CascadeExhaustedError,
  dispatchVendor,
  dispatchVendorStream,
  modelsByTier,
  tierForModel,
  vendorForModel,
  vendorKeyBound,
  WorkerSubrequestExhaustedError,
  RequestAbortedError,
  type DispatchAttempt,
  type VendorEnv,
  type VendorId,
} from './vendors';
import { composeFreeCappedCascade, buildCooldownPredicate } from './cascadeComposer';
import { sanitizeRequestToolNames, restoreResponseToolNames } from './toolNameSanitizer';
import {
  loadCooldownExpiries,
  loadCooldowns,
  loadCooledVendors,
  loadCooledVendorExpiries,
  recordFailure,
} from '../../infrastructure/auth/cooldownStore';
import { validateJsonSchema } from './jsonSchemaValidator';

// ---------------------------------------------------------------------------
// Pool composition (derived from vendor catalogs — single source of truth)
//
// Multi-vendor by construction. `modelsByTier` walks every registered vendor
// in registry MODULES order (cerebras → ollama → nvidia → openrouter), so the
// free pool naturally starts with sub-200ms TTFT Cerebras entries and ends
// with the highest-variance OpenRouter free tier. When a vendor's key isn't
// bound, its models stay in the pool but are filtered out at dispatch by
// `dispatchVendor`'s no-key skip — and surfaced as `available: false` in
// `status()` so the admin UI doesn't claim availability for unbound vendors.
// ---------------------------------------------------------------------------

/** Free-tier model ids across every registered vendor. */
export const FREE_MODEL_POOL: readonly string[] = modelsByTier('FREE');

/** Paid-tier model ids (STANDARD / PREMIUM / ULTRA) across every registered vendor. */
export const PRO_PAID_MODEL_POOL: readonly string[] = modelsByTier('STANDARD', 'PREMIUM', 'ULTRA');

/** Pro tries free first (cost-optimized), falls over to paid. */
export const PRO_MODEL_POOL: readonly string[] = [...FREE_MODEL_POOL, ...PRO_PAID_MODEL_POOL];

/**
 * Premium routing pool — top PREMIUM-tier models only, used when a tenant has
 * `premium_override` set. Skips FREE and STANDARD entirely so a single attempt
 * lands on a high-quality model. Three candidates so the cascade has fallback
 * room within the extended outer budget (180s SDK / 60s per-vendor).
 *
 * Derived from `modelsByTier('PREMIUM')` so adding a new PREMIUM model to any
 * vendor catalog automatically extends the candidate list — and the first three
 * in registry order become the active premium cascade.
 */
const PREMIUM_PRIORITY_COUNT = 3;
export const PREMIUM_PRIORITY_POOL: readonly string[] =
  modelsByTier('PREMIUM').slice(0, PREMIUM_PRIORITY_COUNT);

/**
 * Per-vendor-call timeout for premium routing. PREMIUM-tier models on long-
 * context inputs (resume tailoring, structured job extraction) routinely take
 * 30-50s end-to-end; the default 25s budget kills these prematurely. Paired
 * with the extended SDK outer budget so all three premium candidates can be
 * tried within one request.
 */
export const PREMIUM_VENDOR_CALL_TIMEOUT_MS = 60_000;

/**
 * Per-vendor-call timeout for the FREE plan. Free-tier upstreams that haven't
 * started streaming within ~15s are, empirically, going to burn the full 25s
 * default and time out anyway (see the all-`408` free attempts in trace
 * `llm-71b468dd-...`, 2026-06-07). Shrinking the per-attempt budget lets a
 * saturated free pool fail fast so the request reaches the guaranteed paid
 * backstop within the caller's deadline instead of spending 2×25s up front.
 * Paid/premium routing keeps the longer budget — those calls are worth waiting
 * for. The backstop itself overrides this with `PREMIUM_VENDOR_CALL_TIMEOUT_MS`.
 */
export const FREE_VENDOR_CALL_TIMEOUT_MS = 15_000;

/**
 * Guaranteed paid backstop — a single low-cost, low-variance paid model
 * dispatched on the *credited* (Pro) OpenRouter key after the primary cascade
 * fails (or every candidate is on cooldown), regardless of the request's plan.
 *
 * Why this exists separately from `PREMIUM_FALLBACK_MODELS`: that chain runs on
 * whatever key the plan resolves to. On the FREE plan that's the free
 * OpenRouter key, which may lack the credit to actually pay for the paid Gemini
 * entry — so the only "safety net" 402s and the request hard-fails (the
 * `AI_UNAVAILABLE` symptom on hired.video's tailor endpoint). The backstop
 * closes that hole: Builderforce funds this one cheap call (~$0.0001) as the
 * reliability floor so a saturated free pool never surfaces a hard failure.
 */
export const GUARANTEED_BACKSTOP_MODEL = 'google/gemini-2.5-flash-lite';

/**
 * Premium fallback chain — appended to *every* non-strict candidate chain so a
 * fully-saturated free pool never surfaces an `LLM_UNAVAILABLE` / cascade-
 * exhausted 429 to the caller. Direct Google AI (`googleai/*`) is tried first
 * because it has the lowest variance and isn't subject to OpenRouter's shared
 * rate limits; the OpenRouter Gemini entry is the vendor-diverse backup so a
 * Google AI outage still resolves through a different upstream.
 *
 * Each entry is skipped at chain-build time when its vendor key is unbound or
 * the model is on cooldown.
 */
export const PREMIUM_FALLBACK_MODELS: readonly string[] = [
  'googleai/gemini-2.5-flash',
  'googleai/gemini-2.5-flash-lite',
  'google/gemini-2.5-flash-lite', // via OpenRouter — vendor-diverse backup
];

/**
 * Maximum number of FREE-tier attempts the cascade walks before falling through
 * to the premium fallback chain. Caps "we cycled 20 free models and still
 * 429'd" failure modes: every request now ends with at most 2 free attempts +
 * the premium fallback list, so callers reliably get a successful response
 * even when the free pool is saturated.
 *
 * Non-FREE models in the seed (Pro/Teams paid models, premium-priority routing)
 * are not affected by this cap — they're kept verbatim in the chain so paying
 * tenants still get the models their plan unlocks.
 */
export const FREE_ATTEMPT_BUDGET = 2;

/** First N models of the active pool form the round-robin "preferred" group.
 *  Aligned with FREE_ATTEMPT_BUDGET so the round-robin window matches the cap. */
export const PREFERRED_POOL_SIZE = 2;

/**
 * Hard cap on how many seed models get a cooldown KV read up-front.
 *
 * The model pool can contain 40+ FREE entries across all vendors. Without this
 * cap, every `complete()` call issued one KV `get` per pool entry just to
 * prefetch cooldown state — ~50 subrequests *before* the first vendor fetch.
 * Cloudflare's per-invocation subrequest cap (50 free / 1000 paid) was being
 * exhausted by the bookkeeping path alone (production trace
 * `llm-2cc6ba1b-...`, 2026-05-26: cooldown reads + 6 vendor attempts =
 * cascade collapse with `Too many subrequests by single Worker invocation`).
 *
 * Why 12: `FREE_ATTEMPT_BUDGET` (=2) + `PREMIUM_FALLBACK_MODELS.length` (3) +
 * caller-pinned hint (1) is the minimum the chain composer can use; 12 leaves
 * headroom for ~6 cooled-and-skipped FREE entries before the composer's
 * walking-the-pool-looking-for-non-cooled loop runs dry — which is far more
 * skips than we've ever observed simultaneously, since cooldowns expire on
 * 5–30 minute windows. The shape-reorder + caller-hint prefix ensures the
 * 12 entries actually queried are the most likely to be tried.
 *
 * Trade-off: a model past index 12 that *is* cooled won't be filtered out of
 * the chain composer's view, so it could be attempted at dispatch time and
 * fail. The dispatcher records the failure and re-cools the model — the next
 * request sees the cooldown if the same model lands in the leading 12. Net
 * effect: a one-request lag on a stale cooldown, in exchange for a hard
 * upper bound on KV subrequests per gateway call.
 */
export const COOLDOWN_PREFETCH_LIMIT = 12;

// ---------------------------------------------------------------------------
// Public types — kept stable for callers (llmRoutes, ideAiRoutes)
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
}

export interface ChatCompletionRequest {
  /** Ignored for pool-based dispatch; we pick from the pool. */
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
  /** Any extra passthrough params for the vendor. */
  [key: string]: unknown;
}

export interface LlmUsage {
  promptTokens:     number;
  completionTokens: number;
  totalTokens:      number;
  /** Prompt-cache breakdown (subset of promptTokens). Present only for caching
   *  upstreams. Persisted so cost accounting can discount cache reads (~0.1x). */
  cacheReadTokens?:     number;
  cacheCreationTokens?: number;
}

/** One model attempt that failed before the resolved model succeeded. */
export interface FailoverEvent {
  model: string;
  /** Vendor that owns this model — lets callers see if failures concentrate
   *  on one upstream (e.g. all OpenRouter free-tier saturated) vs are
   *  distributed across vendors. */
  vendor: VendorId;
  /** HTTP status, or 0 for embedded errors / network failures. */
  code: number;
  /** Wall-clock time spent on this attempt, ms (diagnostic tracing). */
  durationMs?: number;
  /** Coarse failure class — rate_limit | timeout | auth | server_error |
   *  network | skipped (diagnostic tracing). */
  kind?: string;
}

export interface ProxyResult {
  /** Final upstream Response (may be streamed). */
  response: Response;
  /** Which model actually served the request. */
  resolvedModel: string;
  /** Vendor that owns `resolvedModel` — sourced from the catalog. Always set
   *  (every successful or failed response has *some* model the cascade landed
   *  on); routes echo it back to consumers as `_builderforce.resolvedVendor`
   *  and on errors as the top-level `vendor` field. */
  resolvedVendor: VendorId;
  /** How many failovers happened before success. */
  retries: number;
  failovers: FailoverEvent[];
  /** Token usage from non-streaming responses; undefined for streams (route intercepts). */
  usage?: LlmUsage;
  /** Number of times the gateway re-dispatched on non-conforming JSON output
   *  (only applies when `body.response_format.type` is `json_object`/`json_schema`). */
  schemaRetries?: number;
  // --- Diagnostic tracing (stamped by complete() via finalize) -------------
  /** Authoritative gateway trace id (`llm-<uuid>`) echoed to the consumer and
   *  used by the superadmin trace lookup. */
  traceId?: string;
  /** Total gateway wall-clock time for this call, ms. */
  durationMs?: number;
  /** Final HTTP status returned to the caller (mirrors `response.status`). */
  status?: number;
  /** The model chain the gateway actually walked for this request. */
  candidateChain?: string[];
  /** success | cascade_exhausted | all_cooldown | subrequest_exhausted |
   *  strict_unavailable | schema_nonconforming. */
  outcome?: string;
  /** Rolled-up failure class across attempts — rate_limit | timeout | auth |
   *  server_error | mixed | none. */
  classification?: string;
  /** Raw per-attempt diagnostics (model, vendor, status, error text, durationMs,
   *  kind). Server-side ONLY — written to the superadmin trace, NEVER serialized
   *  back to the caller (the per-attempt error text can contain raw upstream
   *  provider payloads). */
  attempts?: DispatchAttempt[];
}

export type ProductName = 'builderforceLLM' | 'builderforceLLMPro' | 'builderforceLLMTeams';

export interface ProxyEnv extends VendorEnv {
  /** Pro-tier OpenRouter key. Used in place of OPENROUTER_API_KEY when the
   *  proxy was constructed with a Pro/Teams productName. */
  OPENROUTER_API_KEY_PRO?: string | null;
  /** Optional KV namespace for persistent cooldown + key-resolution caching.
   *  When unset, both fall back to in-memory per-isolate state. */
  AUTH_CACHE_KV?: KVNamespace;
}

// ---------------------------------------------------------------------------
// Cooldown tracking lives in `infrastructure/auth/cooldownStore.ts` — KV-backed
// when the namespace is bound, in-memory fallback otherwise. See that module
// for the classification → TTL table.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Round-robin cursor (per-isolate)
// ---------------------------------------------------------------------------

/** Round-robin cursor (per-isolate). Boxed in an object so it can be shared
 *  by reference with `composeFreeCappedCascade` — the helper increments it
 *  in place, so chat and image cascades both contribute to the same rotation
 *  on a single Worker isolate (no contention, just a counter). */
const chatRequestCursor: { value: number } = { value: 0 };

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface LlmProxyOptions {
  modelPool?: readonly string[];
  preferredPoolSize?: number;
  productName?: ProductName;
  /** Per-vendor-call deadline. Defaults to `DEFAULT_VENDOR_CALL_TIMEOUT_MS`
   *  in the vendor transport. The premium routing path sets this to
   *  `PREMIUM_VENDOR_CALL_TIMEOUT_MS` so PREMIUM-tier long-context calls
   *  aren't killed by the free-tier 25s budget. */
  vendorCallTimeoutMs?: number;
}

export class LlmProxyService {
  private readonly env: ProxyEnv;
  private readonly modelPool: readonly string[];
  private readonly preferredPoolSize: number;
  private readonly productName: ProductName;
  private readonly isPro: boolean;
  private readonly vendorCallTimeoutMs: number | undefined;

  constructor(env: ProxyEnv, options?: LlmProxyOptions) {
    this.env = env;
    this.modelPool = options?.modelPool ?? FREE_MODEL_POOL;
    this.preferredPoolSize = Math.min(options?.preferredPoolSize ?? PREFERRED_POOL_SIZE, this.modelPool.length);
    this.productName = options?.productName ?? 'builderforceLLM';
    this.isPro = this.productName === 'builderforceLLMPro' || this.productName === 'builderforceLLMTeams';
    this.vendorCallTimeoutMs = options?.vendorCallTimeoutMs;
  }

  // --- Public entry points --------------------------------------------------

  /**
   * Forward a chat-completion request through the configured pool.
   *
   * Routing is gateway-owned. The caller's `body.model` (if any) is treated
   * as a *hint* — the gateway puts it at the head of the candidate chain so
   * it's tried first, but the gateway retains the right to advance through
   * its own failover chain when that model is unavailable, on cooldown, or
   * fails. The actual model used is reported via `_builderforce.resolvedModel`
   * so callers can detect substitution and decide whether to retry on their
   * own.
   *
   * Vendor prefixes (`openrouter/<id>`, `cerebras/<id>`, `ollama/<id>`) route
   * to the named vendor explicitly. Bare ids fall back to catalog lookup.
   *
   * When `body.model` is unset, shape-based reordering (tools / response_format
   * / vision content) ranks the most-capable models in the pool first.
   */
  async complete(
    body: ChatCompletionRequest,
    requestHeaders?: Record<string, string>,
    traceId?: string,
    signal?: AbortSignal,
  ): Promise<ProxyResult> {
    const startedAt = Date.now();
    const tid = traceId ?? newTraceId();
    const callerModel = (body as { model?: unknown }).model;
    const wantsStrict = (body as { modelStrict?: unknown }).modelStrict === true
                     && typeof callerModel === 'string'
                     && callerModel.length > 0;

    // Strict-pin path: single-model dispatch, no chain, no failover. Cooldown
    // and missing-vendor-key are the only pre-flight gates; if either fails
    // the request returns 503 `model_unavailable` instead of falling through.
    if (wantsStrict) {
      return this.finalize(
        await this.dispatchStrict(callerModel as string, body, requestHeaders),
        tid, startedAt, [callerModel as string],
      );
    }

    // 1) Pool composition is already TTFT-ordered (Cerebras → Ollama → NVIDIA
    //    → OpenRouter) because `modelsByTier` walks the registry's MODULES
    //    array in priority order. Shape-based reorder then floats capable
    //    models (tools / structured / vision) to the head within that order.
    const reorderedPool = reorderPoolByShape(body, this.modelPool);

    // 2) Caller hint goes at the head; rest of the pool follows.
    //    `callerModel` was extracted at the top of this function for the
    //    strict-pin branch; reuse it here for the chained path.
    const seed: readonly string[] = (typeof callerModel === 'string' && callerModel.length > 0)
      ? [callerModel, ...reorderedPool.filter((m) => m !== callerModel)]
      : reorderedPool;

    // 3) Pre-fetch cooldown state for the leading seed slice + premium fallback
    //    (KV-backed when bound, in-memory fallback otherwise). The seed is
    //    truncated to `COOLDOWN_PREFETCH_LIMIT` entries to bound subrequest
    //    cost — see that constant for the trade-off rationale. Vendor
    //    cooldown short-circuits the per-model walk when one upstream's key
    //    is globally throttled; the fallback models are included so the
    //    chain composer skips any individually cooled entry instead of
    //    firing a doomed retry against a saturated endpoint.
    const seedPrefix = seed.slice(0, COOLDOWN_PREFETCH_LIMIT);
    const fallbackPairs = PREMIUM_FALLBACK_MODELS.map((m) => ({ vendor: vendorForModel(m), model: m }));
    const seedVendors = Array.from(new Set([
      ...seedPrefix.map((m) => vendorForModel(m)),
      ...fallbackPairs.map((p) => p.vendor),
    ]));
    const [cooledSet, cooledVendors] = await Promise.all([
      loadCooldowns(this.env, [
        ...seedPrefix.map((m) => ({ vendor: vendorForModel(m), model: m })),
        ...fallbackPairs,
      ]),
      loadCooledVendors(this.env, seedVendors),
    ]);
    // Pinned hint bypasses vendor-level cooldown so a caller-explicit paid model
    // (`anthropic/claude-3-haiku`) gets tried even when the same vendor's free
    // key has 429'd its way into vendor cooldown. Per-model cooldown still
    // applies — we won't retry a model that *itself* just failed.
    const pinnedHint = typeof callerModel === 'string' && callerModel.length > 0
      ? callerModel
      : undefined;
    const candidates = this.buildCandidateChain(seed, cooledSet, cooledVendors, pinnedHint);
    if (candidates.length === 0) {
      // Every model in the seed + premium fallback list is on cooldown. The
      // guaranteed paid backstop (credited key) is the last chance before we
      // surface a hard failure.
      const backstop = await this.dispatchBackstop(body, requestHeaders);
      if (backstop) return this.finalize(backstop, tid, startedAt, [GUARANTEED_BACKSTOP_MODEL], 'success');
      return this.finalize(
        this.exhaustedResponse(
          seed.slice(),
          0,
          new Error('All candidate models are on cooldown. Retry in a minute or two.'),
        ),
        tid, startedAt, seed.slice(), 'all_cooldown',
      );
    }

    const primary = await this.dispatch(candidates, body, requestHeaders, { signal });
    if (primary.response.status < 400) {
      return this.finalize(primary, tid, startedAt, candidates);
    }

    // Primary cascade failed (saturated free pool, cascade-exhausted 429, etc.).
    // Fire the guaranteed paid backstop on the credited key before giving up so
    // the caller gets a real answer instead of `AI_UNAVAILABLE`. On success,
    // splice the primary cascade's diagnostics in front of the backstop's so the
    // trace still records everything that was tried.
    const backstop = await this.dispatchBackstop(body, requestHeaders);
    if (backstop) {
      backstop.failovers = [...primary.failovers, ...backstop.failovers];
      backstop.retries   = primary.retries + backstop.retries;
      backstop.attempts  = [...(primary.attempts ?? []), ...(backstop.attempts ?? [])];
      return this.finalize(backstop, tid, startedAt, [...candidates, GUARANTEED_BACKSTOP_MODEL], 'success');
    }
    return this.finalize(primary, tid, startedAt, candidates);
  }

  /** Stamp request-level diagnostics onto a ProxyResult before it leaves
   *  complete(). Single place that owns the trace id, total duration, candidate
   *  chain, final status, rolled-up classification, and outcome — so every
   *  return path (strict / cooldown / dispatched) is uniform. */
  private finalize(
    result: ProxyResult,
    traceId: string,
    startedAt: number,
    candidateChain: readonly string[],
    outcomeOverride?: string,
  ): ProxyResult {
    result.traceId = traceId;
    result.durationMs = Date.now() - startedAt;
    result.status = result.response.status;
    if (!result.candidateChain) result.candidateChain = [...candidateChain];
    if (!result.classification) result.classification = classificationFromFailovers(result.failovers);
    if (outcomeOverride) result.outcome = outcomeOverride;
    else if (!result.outcome) result.outcome = result.response.status < 400 ? 'success' : 'cascade_exhausted';
    return result;
  }

  /**
   * Strict-pin dispatch — single model, no chain, no failover. Used when
   * `body.modelStrict === true`. Pre-flight gates:
   *   - vendor key bound? otherwise 503 `model_unavailable` (reason: `vendor_key_unconfigured`)
   *   - model on cooldown?  otherwise 503 `model_unavailable` (reason: `cooldown`)
   * If both pass, dispatches a chain of length 1. Vendor errors propagate
   * verbatim instead of being absorbed into a chain-exhausted envelope.
   */
  private async dispatchStrict(
    model: string,
    body: ChatCompletionRequest,
    requestHeaders?: Record<string, string>,
  ): Promise<ProxyResult> {
    const vendor = vendorForModel(model);
    if (!vendorKeyBound(this.vendorEnv(), vendor)) {
      return strictUnavailableResult(model, 'vendor_key_unconfigured');
    }

    const [cooledSet, cooledVendors] = await Promise.all([
      loadCooldowns(this.env, [{ vendor, model }]),
      loadCooledVendors(this.env, [vendor]),
    ]);
    if (cooledVendors.has(vendor) || cooledSet.has(`${vendor}/${model}`)) {
      return strictUnavailableResult(model, 'cooldown');
    }

    return this.dispatch([model], body, requestHeaders);
  }

  /** Per-model status with cooldown + key-bound info — used by /v1/models. */
  async status(): Promise<Array<{ model: string; preferred: boolean; available: boolean; cooldownUntil?: number; vendor: VendorId; vendorCooledUntil?: number; keyBound: boolean }>> {
    const env = this.vendorEnv();
    const poolVendors = Array.from(new Set(this.modelPool.map((m) => vendorForModel(m))));
    const [cooledMap, vendorCooledMap] = await Promise.all([
      loadCooldownExpiries(this.env, this.modelPool.map((m) => ({ vendor: vendorForModel(m), model: m }))),
      loadCooledVendorExpiries(this.env, poolVendors),
    ]);
    return this.modelPool.map((model, i) => {
      const vendor      = vendorForModel(model);
      const until       = cooledMap.get(`${vendor}/${model}`);
      const vendorUntil = vendorCooledMap.get(vendor);
      const keyBound    = vendorKeyBound(env, vendor);
      return {
        model,
        vendor,
        preferred: i < this.preferredPoolSize,
        keyBound,
        available: keyBound && vendorUntil === undefined && until === undefined,
        ...(until       !== undefined && until       > 0 ? { cooldownUntil:       until       } : {}),
        ...(vendorUntil !== undefined && vendorUntil > 0 ? { vendorCooledUntil:   vendorUntil } : {}),
      };
    });
  }

  // --- Internals ------------------------------------------------------------

  /**
   * Compose the candidate chain for one request via the shared
   * `composeFreeCappedCascade` helper.
   *
   * Per-model cooldown excludes specific models that recently failed. Per-vendor
   * cooldown is the wider net: when one upstream key is globally throttled
   * (e.g. all OpenRouter free-tier 429s), the vendor itself is cooled and we
   * skip every model owned by that vendor in one pass — instead of walking
   * many models on the saturated key one 429 at a time. See
   * `maybeTripVendorCooldown` in cooldownStore.ts for the trip conditions.
   *
   * The FREE cap is the headline guarantee: regardless of how saturated the
   * upstream free pool is, every cascade tries at most 2 free models before
   * falling through to the premium fallback — so callers always see a
   * successful response instead of `cascade-exhausted` 429s.
   */
  private buildCandidateChain(
    seed: readonly string[],
    cooledSet: Set<string>,
    cooledVendors: Set<VendorId>,
    pinnedModel?: string,
  ): string[] {
    return composeFreeCappedCascade({
      seed,
      premiumFallback: PREMIUM_FALLBACK_MODELS,
      freeBudget: FREE_ATTEMPT_BUDGET,
      tierOf: tierForModel,
      isUnavailable: buildCooldownPredicate({
        cooledModels:  cooledSet,
        cooledVendors,
        vendorOf:      vendorForModel,
        ...(pinnedModel !== undefined ? { pinnedModel } : {}),
      }),
      cursor: chatRequestCursor,
    });
  }

  /** Synthesize the env passed to vendors — picks the Pro OpenRouter key when applicable. */
  private vendorEnv(): VendorEnv {
    return {
      OPENROUTER_API_KEY: this.isPro
        ? (this.env.OPENROUTER_API_KEY_PRO ?? this.env.OPENROUTER_API_KEY ?? null)
        : (this.env.OPENROUTER_API_KEY ?? null),
      CEREBRAS_API_KEY:         this.env.CEREBRAS_API_KEY         ?? null,
      NVIDIA_API_KEY:           this.env.NVIDIA_API_KEY           ?? null,
      OLLAMA_API_KEY:           this.env.OLLAMA_API_KEY           ?? null,
      GOOGLE_API_KEY:           this.env.GOOGLE_API_KEY           ?? null,
      CLOUDFLARE_AI_API_TOKEN:  this.env.CLOUDFLARE_AI_API_TOKEN  ?? null,
      CLOUDFLARE_ACCOUNT_ID:    this.env.CLOUDFLARE_ACCOUNT_ID    ?? null,
    };
  }

  /**
   * Vendor env that forces the *credited* (Pro) OpenRouter key regardless of the
   * proxy's plan, so the guaranteed backstop can reach paid models even when the
   * request itself came in on the free key. Falls back to the standard key when
   * no Pro key is bound (single-key deployments still get a backstop attempt).
   */
  private creditedVendorEnv(): VendorEnv {
    return {
      ...this.vendorEnv(),
      OPENROUTER_API_KEY: this.env.OPENROUTER_API_KEY_PRO ?? this.env.OPENROUTER_API_KEY ?? null,
    };
  }

  /**
   * Guaranteed paid backstop — see `GUARANTEED_BACKSTOP_MODEL`. Dispatched only
   * after the primary cascade has failed (or every candidate was cooled). Forces
   * the credited key + the extended premium timeout so one low-variance paid
   * model can answer even on the free plan with a saturated free pool.
   *
   * Returns the successful `ProxyResult`, or `null` when no credited key is bound
   * or the backstop itself fails — the caller then surfaces the original failure.
   */
  private async dispatchBackstop(
    body: ChatCompletionRequest,
    requestHeaders?: Record<string, string>,
  ): Promise<ProxyResult | null> {
    const creditedEnv = this.creditedVendorEnv();
    if (!creditedEnv.OPENROUTER_API_KEY) return null; // no paid key to fall back to
    const result = await this.dispatch([GUARANTEED_BACKSTOP_MODEL], body, requestHeaders, {
      vendorEnv: creditedEnv,
      timeoutMs: PREMIUM_VENDOR_CALL_TIMEOUT_MS,
    });
    return result.response.status < 400 ? result : null;
  }

  private async dispatch(
    candidates: string[],
    body: ChatCompletionRequest,
    requestHeaders?: Record<string, string>,
    overrides?: { vendorEnv?: VendorEnv; timeoutMs?: number; signal?: AbortSignal },
  ): Promise<ProxyResult> {
    // Sanitize tool names (`governance.snapshot` → `governance__DOT__snapshot`)
    // before the body reaches a vendor — Anthropic / some Cerebras configs
    // reject dots. Walks `tools`, `tool_choice`, message `tool_calls`, and
    // tool-message `name`. Restored in dispatchJson before returning to caller.
    const sanitizedBody = sanitizeRequestToolNames(body as unknown as Record<string, unknown>) as unknown as ChatCompletionRequest;
    const messages = sanitizedBody.messages as unknown as Array<Record<string, unknown>>;
    const extraBody = stripStandardFields(sanitizedBody);
    const effectiveTimeoutMs = overrides?.timeoutMs ?? this.vendorCallTimeoutMs;
    const vendorEnv = overrides?.vendorEnv ?? this.vendorEnv();
    const callParams = {
      messages,
      ...(sanitizedBody.max_tokens  != null ? { maxTokens:   sanitizedBody.max_tokens  } : {}),
      ...(sanitizedBody.temperature != null ? { temperature: sanitizedBody.temperature } : {}),
      ...(sanitizedBody.top_p       != null ? { topP:        sanitizedBody.top_p       } : {}),
      ...(Object.keys(extraBody).length > 0 ? { extraBody } : {}),
      title: this.productName,
      ...(effectiveTimeoutMs ? { timeoutMs: effectiveTimeoutMs } : {}),
      ...(overrides?.signal ? { signal: overrides.signal } : {}),
    };

    if (sanitizedBody.stream) {
      return this.dispatchStream(candidates, callParams, vendorEnv, requestHeaders);
    }
    return this.dispatchJson(candidates, callParams, vendorEnv, sanitizedBody);
  }

  /**
   * Non-streaming dispatch with optional `response_format` conformance retry.
   *
   * When the request asks for `json_object` or `json_schema` output, the
   * gateway parses the assistant message after each successful vendor call.
   * If parsing fails (or, for strict `json_schema`, the document is missing
   * a required field) the gateway advances past the model that just answered
   * and re-dispatches on the remaining suffix. The total non-conforming
   * round-trips are surfaced via `_builderforce.schemaRetries`.
   */
  private async dispatchJson(
    candidates: string[],
    callParams: Omit<Parameters<typeof dispatchVendor>[0], 'env' | 'modelChain'>,
    vendorEnv: VendorEnv,
    body: ChatCompletionRequest,
  ): Promise<ProxyResult> {
    let chain = candidates;
    let totalAttempts = 0;
    const totalFailovers: FailoverEvent[] = [];
    let schemaRetries = 0;
    let lastResult: Awaited<ReturnType<typeof dispatchVendor>> | null = null;

    while (chain.length > 0) {
      let result: Awaited<ReturnType<typeof dispatchVendor>>;
      try {
        result = await dispatchVendor({
          env: vendorEnv,
          modelChain: chain,
          ...callParams,
        });
      } catch (err) {
        // Worker subrequest cap exhausted — every later fetch from this isolate
        // throws the same thing. Surface a distinct 503 envelope and SKIP
        // cooldown writes (each is another subrequest that would compound the
        // problem and may itself throw the same error). The 503 lets the
        // caller distinguish "infrastructure ceiling" from "vendor rate limit"
        // and back off rather than retrying a doomed loop.
        if (err instanceof WorkerSubrequestExhaustedError) {
          return this.subrequestExhaustedResponse(candidates, schemaRetries, err);
        }
        // Caller cancelled — propagate so complete() stops immediately instead of
        // firing the paid backstop and spending more tokens on a cancelled run.
        if (err instanceof RequestAbortedError) throw err;
        const errAttempts = err instanceof CascadeExhaustedError ? err.attempts : [];
        await this.applyCooldowns(errAttempts);
        return this.exhaustedResponse(candidates, schemaRetries, err, errAttempts);
      }

      await this.applyCooldowns(result.attempts);
      totalAttempts += result.attempts.length;
      totalFailovers.push(...attemptsToFailovers(result.attempts));
      lastResult = result;

      const conformanceErr = checkResponseFormatConformance(body, result.raw);
      if (!conformanceErr) {
        return this.successJsonResult(result, totalAttempts, totalFailovers, schemaRetries);
      }

      // Non-conforming: advance past the model that just answered.
      schemaRetries++;
      const idx = chain.indexOf(result.modelUsed);
      chain = idx >= 0 ? chain.slice(idx + 1) : [];
    }

    // Chain exhausted with all candidates non-conforming. Return the last
    // body so callers see whatever the most-capable model produced, but
    // surface the retry count so they can detect the conformance failure.
    if (lastResult) {
      return this.successJsonResult(lastResult, totalAttempts, totalFailovers, schemaRetries);
    }
    return this.exhaustedResponse(candidates, schemaRetries);
  }

  private successJsonResult(
    result: Awaited<ReturnType<typeof dispatchVendor>>,
    totalAttempts: number,
    totalFailovers: FailoverEvent[],
    schemaRetries: number,
  ): ProxyResult {
    // Restore dotted tool names that the request-side sanitizer escaped, so
    // `tool_calls[*].function.name` round-trips to the caller's namespace.
    const restoredRaw = restoreResponseToolNames(result.raw);
    return {
      response: new Response(JSON.stringify(restoredRaw), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      resolvedModel: result.modelUsed,
      resolvedVendor: result.vendorUsed,
      retries: totalAttempts,
      failovers: totalFailovers,
      outcome: 'success',
      attempts: result.attempts,
      ...(result.usage ? {
        usage: {
          promptTokens:     result.usage.prompt_tokens     ?? 0,
          completionTokens: result.usage.completion_tokens ?? 0,
          totalTokens:      result.usage.total_tokens      ?? 0,
          ...(result.usage.cache_read_tokens     != null ? { cacheReadTokens:     result.usage.cache_read_tokens     } : {}),
          ...(result.usage.cache_creation_tokens != null ? { cacheCreationTokens: result.usage.cache_creation_tokens } : {}),
        },
      } : {}),
      ...(schemaRetries > 0 ? { schemaRetries } : {}),
    };
  }

  /**
   * Build the cascade-exhausted 429 envelope. When real `attempts[]` are
   * available (from `CascadeExhaustedError`), use them for `failovers` so the
   * downstream `llm_failover_log` row carries the actual upstream status —
   * not a synthetic `code: 0`. Without this, the per-model rate-limit panel
   * cannot distinguish "model 429'd 50 times" from "model wasn't tried."
   */
  private exhaustedResponse(
    candidates: string[],
    schemaRetries: number,
    err?: unknown,
    attempts?: ReadonlyArray<DispatchAttempt>,
  ): ProxyResult {
    const message = err instanceof Error ? err.message : (err ? String(err) : 'All candidates produced non-conforming output');
    const failovers: FailoverEvent[] = attempts && attempts.length > 0
      ? attempts.map((a) => ({
          model: a.model, vendor: a.vendor, code: a.status,
          ...(a.durationMs != null ? { durationMs: a.durationMs } : {}),
          ...(a.kind ? { kind: a.kind } : {}),
        }))
      : candidates.map((model) => ({ model, vendor: vendorForModel(model), code: 0, durationMs: 0, kind: 'skipped' }));
    // Pick the *last* dispatched attempt as the "model the gateway was on when
    // it gave up" — that's the most informative attribution for consumers
    // doing per-vendor saturation rollups. Falls back to the last candidate
    // when no attempts ran (every model on cooldown / no key bound).
    const resolvedModel = attempts && attempts.length > 0
      ? attempts[attempts.length - 1]!.model
      : (candidates[candidates.length - 1] ?? this.modelPool[0] ?? FREE_MODEL_POOL[0] ?? '');
    const resolvedVendor: VendorId = attempts && attempts.length > 0
      ? attempts[attempts.length - 1]!.vendor
      : vendorForModel(resolvedModel);
    // Failover breakdown lives under `error.details.failovers` — OpenAI-style
    // envelope so the SDK's existing `details` accessor on BuilderforceApiError
    // picks it up without a parser change. Top-level `vendor` + `model` give
    // consumers a single field to group by without parsing the model-id prefix
    // (which fails silently for OpenRouter-routed families like `qwen/*`,
    // `google/*`, `anthropic/*` that share the prefix with the model family,
    // not the upstream vendor).
    const exhaustedBody = JSON.stringify({
      error: {
        message,
        code: 429,
        type: 'rate_limit_error',
        vendor: resolvedVendor,
        model: resolvedModel,
        details: { failovers },
      },
    });
    return {
      response: new Response(exhaustedBody, {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
      resolvedModel,
      resolvedVendor,
      retries: attempts?.length ?? candidates.length,
      failovers,
      outcome: 'cascade_exhausted',
      attempts: attempts ? [...attempts] : [],
      ...(schemaRetries > 0 ? { schemaRetries } : {}),
    };
  }

  /**
   * Build the 503 `worker_subrequest_exhausted` envelope. Distinct from
   * `exhaustedResponse` because the failure mode is infrastructure
   * (Cloudflare's per-invocation subrequest cap), not vendor saturation —
   * callers should back off and retry rather than walk their own failover
   * chain across more models. Skips cooldown writes deliberately: each KV
   * `put` is another subrequest that would compound the problem and may
   * itself throw the same error.
   */
  private subrequestExhaustedResponse(
    candidates: string[],
    schemaRetries: number,
    err: WorkerSubrequestExhaustedError,
  ): ProxyResult {
    const resolvedModel  = err.model || (candidates[candidates.length - 1] ?? this.modelPool[0] ?? FREE_MODEL_POOL[0] ?? '');
    const resolvedVendor = vendorForModel(resolvedModel);
    const body = JSON.stringify({
      error: {
        message: `Gateway hit Cloudflare's per-invocation subrequest cap; retry the request to land on a fresh Worker isolate. (${err.message})`,
        code: 503,
        type: 'service_unavailable',
        reason: 'worker_subrequest_exhausted',
        vendor: resolvedVendor,
        model:  resolvedModel,
        details: { failovers: [{ model: resolvedModel, vendor: resolvedVendor, code: 0, durationMs: 0, kind: 'network' }] },
      },
    });
    return {
      response: new Response(body, {
        status: 503,
        headers: { 'content-type': 'application/json', 'retry-after': '1' },
      }),
      resolvedModel,
      resolvedVendor,
      retries: 1,
      failovers: [{ model: resolvedModel, vendor: resolvedVendor, code: 0, durationMs: 0, kind: 'network' }],
      outcome: 'subrequest_exhausted',
      attempts: [{ model: resolvedModel, vendor: resolvedVendor, status: 0, error: err.message, durationMs: 0, kind: 'network' }],
      ...(schemaRetries > 0 ? { schemaRetries } : {}),
    };
  }

  private async dispatchStream(
    candidates: string[],
    callParams: Omit<Parameters<typeof dispatchVendorStream>[0], 'env' | 'modelChain'>,
    vendorEnv: VendorEnv,
    _requestHeaders?: Record<string, string>,
  ): Promise<ProxyResult> {
    try {
      const result = await dispatchVendorStream({
        env: vendorEnv,
        modelChain: candidates,
        ...callParams,
      });
      this.applyCooldowns(result.attempts);
      return {
        response: result.response,
        resolvedModel: result.modelUsed,
        resolvedVendor: result.vendorUsed,
        retries: result.attempts.length,
        failovers: attemptsToFailovers(result.attempts),
        outcome: 'success',
        attempts: result.attempts,
      };
    } catch (err) {
      if (err instanceof WorkerSubrequestExhaustedError) {
        return this.subrequestExhaustedResponse(candidates, 0, err);
      }
      if (err instanceof RequestAbortedError) throw err;
      const errAttempts = err instanceof CascadeExhaustedError ? err.attempts : [];
      await this.applyCooldowns(errAttempts);
      return this.exhaustedResponse(candidates, 0, err, errAttempts);
    }
  }

  /**
   * Record cooldowns for every failed attempt. Classification (5 min for
   * transient, 30 min for auth) lives in `cooldownStore.classifyFailure`.
   *
   * Awaited (not fire-and-forget): on Cloudflare Workers a `void` promise can
   * be aborted when the request lifecycle ends, leaving the cooldown unwritten.
   * KV writes are ~50–200ms in parallel — only on the failure path — so the
   * extra latency is acceptable in exchange for cooldowns that actually stick.
   */
  private async applyCooldowns(attempts: ReadonlyArray<DispatchAttempt>): Promise<void> {
    if (attempts.length === 0) return;
    await Promise.all(
      attempts.map((a) => recordFailure(this.env, a.vendor, a.model, a.status, a.error)),
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function attemptsToFailovers(attempts: DispatchAttempt[]): FailoverEvent[] {
  return attempts.map((a) => ({
    model: a.model,
    vendor: a.vendor,
    code: a.status,
    ...(a.durationMs != null ? { durationMs: a.durationMs } : {}),
    ...(a.kind ? { kind: a.kind } : {}),
  }));
}

/** Authoritative gateway trace id. Prefix `llm-` mirrors what consumers already
 *  surface as `correlationId`, so a customer can quote it straight back to a
 *  superadmin for lookup. */
export function newTraceId(): string {
  return `llm-${crypto.randomUUID()}`;
}

/** Roll a set of per-attempt `kind`s up into one classification for the trace.
 *  `skipped` attempts (cooldown / no key) don't count toward the class. */
function classificationFromFailovers(failovers: ReadonlyArray<FailoverEvent>): string {
  const kinds = new Set(
    failovers.map((f) => f.kind).filter((k): k is string => !!k && k !== 'skipped'),
  );
  if (kinds.size === 0) return 'none';
  if (kinds.size === 1) return [...kinds][0]!;
  return 'mixed';
}

// ---------------------------------------------------------------------------
// Plan → proxy factory  (eliminates duplicated isPro/pool/productName wiring)
// ---------------------------------------------------------------------------

export type EffectivePlan = 'free' | 'pro' | 'teams';

/**
 * Resolve the (productName, modelPool, vendorCallTimeoutMs) triple for a
 * given (plan, premiumOverride) pair. Single source of truth so the proxy
 * factory, the model-listing endpoint, and the response header logic stay
 * aligned. Per the DRY rule: callers consume this rather than recomputing
 * any of the three branches independently.
 *
 *   premiumOverride=true → top PREMIUM-tier models + extended 60s vendor
 *     timeout + Pro OpenRouter key. Plan/billing irrelevant — superadmin
 *     grant overrides them so comped / beta access works without flipping
 *     the billing plan.
 *
 *   premiumOverride=false → plan-driven routing as before.
 */
export function resolveRouting(
  effectivePlan: EffectivePlan,
  premiumOverride: boolean,
): { productName: ProductName; modelPool: readonly string[]; vendorCallTimeoutMs?: number } {
  if (premiumOverride) {
    return {
      productName: 'builderforceLLMPro',
      modelPool: PREMIUM_PRIORITY_POOL,
      vendorCallTimeoutMs: PREMIUM_VENDOR_CALL_TIMEOUT_MS,
    };
  }
  const productName: ProductName =
    effectivePlan === 'teams' ? 'builderforceLLMTeams'
    : effectivePlan === 'pro' ? 'builderforceLLMPro'
    :                            'builderforceLLM';
  if (effectivePlan === 'free') {
    // Free pool fails fast (15s/attempt) so it reaches the guaranteed paid
    // backstop within the caller's deadline. Paid plans keep the default budget.
    return { productName, modelPool: FREE_MODEL_POOL, vendorCallTimeoutMs: FREE_VENDOR_CALL_TIMEOUT_MS };
  }
  return { productName, modelPool: PRO_MODEL_POOL };
}

/** Map an effective plan to its productName + model pool, then construct the proxy.
 *  When `premiumOverride` is true the routing is forced to the premium pool
 *  + extended vendor timeout regardless of plan. Single entry point so
 *  /v1/chat/completions and /v1/models stay aligned. */
export function llmProxyForPlan(
  env: ProxyEnv,
  effectivePlan: EffectivePlan,
  premiumOverride = false,
): LlmProxyService {
  const { productName, modelPool, vendorCallTimeoutMs } = resolveRouting(effectivePlan, premiumOverride);
  return new LlmProxyService(env, {
    modelPool,
    preferredPoolSize: PREFERRED_POOL_SIZE,
    productName,
    ...(vendorCallTimeoutMs ? { vendorCallTimeoutMs } : {}),
  });
}

export function productNameForPlan(effectivePlan: EffectivePlan, premiumOverride = false): ProductName {
  return resolveRouting(effectivePlan, premiumOverride).productName;
}

export function modelPoolForPlan(effectivePlan: EffectivePlan, premiumOverride = false): readonly string[] {
  return resolveRouting(effectivePlan, premiumOverride).modelPool;
}

/** Free-tier proxy for IDE-internal callers (chat, dataset gen, agent inference, brain).
 *  Always uses FREE_MODEL_POOL and productName='builderforceLLM'. */
export function ideProxy(env: ProxyEnv): LlmProxyService {
  return new LlmProxyService(env, {
    modelPool: FREE_MODEL_POOL,
    preferredPoolSize: PREFERRED_POOL_SIZE,
    productName: 'builderforceLLM',
    vendorCallTimeoutMs: FREE_VENDOR_CALL_TIMEOUT_MS,
  });
}

/** Build a proxy over a specific pool (admin /status etc. — for displaying cooldowns).
 *  Use llmProxyForPlan when you have an effectivePlan. */
export function adminPoolProxy(
  env: ProxyEnv,
  modelPool: readonly string[],
  productName: ProductName,
): LlmProxyService {
  return new LlmProxyService(env, {
    modelPool,
    preferredPoolSize: Math.min(PREFERRED_POOL_SIZE, modelPool.length),
    productName,
  });
}

/**
 * Build the 503 `model_unavailable` envelope used by strict-pin dispatch
 * when the requested model can't be honoured. The reason string is exposed
 * to the caller so they can decide whether to retry on a different model or
 * surface the error directly.
 */
function strictUnavailableResult(
  model: string,
  reason: 'cooldown' | 'vendor_key_unconfigured' | 'plan_tier' | 'vendor_outage',
): ProxyResult {
  const vendor = vendorForModel(model);
  const body = JSON.stringify({
    error: `Strict-pin: model '${model}' is unavailable (${reason}).`,
    code: 'model_unavailable',
    // Top-level `vendor` + `model` so SDK consumers' per-vendor rollups pick
    // up strict-pin 503s without parsing the model id prefix. `details`
    // retains `requestedModel` for backward compat.
    vendor,
    model,
    details: { requestedModel: model, reason },
  });
  return {
    response: new Response(body, {
      status: 503,
      headers: { 'content-type': 'application/json' },
    }),
    resolvedModel: model,
    resolvedVendor: vendor,
    retries: 0,
    failovers: [],
    outcome: 'strict_unavailable',
    attempts: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Response-format conformance — used by dispatchJson to detect non-conforming
// model output (broken JSON, missing required fields) and retry across the
// failover chain. Returns null when the response conforms (or no constraint
// was requested), or a short reason string when retry is warranted.
//
// This is a deliberately *minimal* validator. Full JSON-Schema validation
// is out of scope here — we don't want a runtime dependency. The two checks
// catch the most common failure modes:
//   1. `response_format: { type: 'json_object' }` — content doesn't parse.
//   2. `response_format: { type: 'json_schema', json_schema: { strict: true,
//      schema: { required: [...] } } }` — content parses but is missing a
//      top-level required field.
// ─────────────────────────────────────────────────────────────────────────────

function extractAssistantContent(raw: unknown): string | null {
  const choices = (raw as { choices?: Array<{ message?: { content?: unknown } }> } | null)?.choices;
  const content = choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : null;
}

function checkResponseFormatConformance(body: ChatCompletionRequest, raw: unknown): string | null {
  const rf = (body as { response_format?: { type?: string; json_schema?: { strict?: boolean; schema?: unknown } } }).response_format;
  if (!rf || (rf.type !== 'json_object' && rf.type !== 'json_schema')) return null;

  const content = extractAssistantContent(raw);
  if (content === null) return null; // Tool-call assistant turns legitimately have no content.

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return 'content is not valid JSON';
  }

  // Full draft-07-subset validation when strict json_schema is requested.
  // Catches nested type / enum / required / additionalProperties violations
  // that the consumer's downstream Zod (or equivalent) would otherwise
  // bounce back as a 4xx — letting the gateway retry the chain instead.
  if (rf.type === 'json_schema' && rf.json_schema?.strict === true && rf.json_schema.schema) {
    const errs = validateJsonSchema(parsed, rf.json_schema.schema, { maxErrors: 5 });
    if (errs.length > 0) {
      const summary = errs.map((e) => `${e.path || '<root>'}: ${e.message}`).join('; ');
      return `schema mismatch (${errs.length}${errs.length >= 5 ? '+' : ''} errors): ${summary}`;
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shape-driven routing — single source of truth for "which capability does
// the request need?" answers. Each capability lists models known to handle
// that capability well; reorderPoolByShape stable-sorts the configured pool
// so capable models float to the front, then everything else follows.
// ─────────────────────────────────────────────────────────────────────────────

/** Models that reliably honour `tools` / `tool_choice` round-trips. */
const TOOL_CAPABLE_MODELS: ReadonlySet<string> = new Set([
  'anthropic/claude-3.7-sonnet',
  'openai/gpt-4.1',
  'google/gemini-2.5-pro',
  'x-ai/grok-3-mini',
  'qwen/qwen3-next-80b-a3b-instruct:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'qwen/qwen3-coder:free',
]);

/** Models that reliably emit valid JSON / honour json_schema. */
const STRUCTURED_OUTPUT_MODELS: ReadonlySet<string> = new Set([
  'openai/gpt-4.1',
  'anthropic/claude-3.7-sonnet',
  'google/gemini-2.5-pro',
  'qwen/qwen3-coder:free',
  'qwen/qwen3-next-80b-a3b-instruct:free',
  'meta-llama/llama-3.3-70b-instruct:free',
]);

/** Models with image-input (vision) capability. */
const VISION_MODELS: ReadonlySet<string> = new Set([
  'anthropic/claude-3.7-sonnet',
  'openai/gpt-4.1',
  'google/gemini-2.5-pro',
  'nvidia/nemotron-nano-12b-v2-vl:free',
  'microsoft/phi-4-multimodal-instruct',
]);

/**
 * OCR-specialized models. Deliberately disjoint from VISION_MODELS — these
 * are tuned for text extraction, not general visual reasoning, so they should
 * only float up when the request explicitly signals OCR (via a `useCase`
 * slug containing "ocr"). On a generic vision request they stay in the pool
 * at base rank.
 */
const OCR_MODELS: ReadonlySet<string> = new Set([
  'baidu/qianfan-ocr-fast:free',
]);

interface ShapeFlags {
  hasTools: boolean;
  hasStructuredOutput: boolean;
  hasVision: boolean;
  hasOcr: boolean;
}

function inferShape(body: ChatCompletionRequest): ShapeFlags {
  const b = body as unknown as Record<string, unknown>;
  const hasTools = Array.isArray(b.tools) && (b.tools as unknown[]).length > 0;

  const rf = b.response_format as { type?: string } | undefined;
  const hasStructuredOutput = rf?.type === 'json_object' || rf?.type === 'json_schema';

  const hasVision = Array.isArray(body.messages) && body.messages.some((m) => {
    const content = (m as unknown as { content?: unknown }).content;
    return Array.isArray(content) && content.some(
      (part) => (part as { type?: string } | null)?.type === 'image_url',
    );
  });

  // OCR is signalled via `useCase` slug — the SDK's free-form telemetry tag.
  // Substring match on /ocr/i so tenant slugs like `invoice_ocr` or
  // `receipt_ocr_extract` light up the route without needing an enum.
  const useCase = typeof b.useCase === 'string' ? b.useCase : '';
  const hasOcr = /ocr/i.test(useCase);

  return { hasTools, hasStructuredOutput, hasVision, hasOcr };
}

/**
 * Stable-sort the pool so models that match the request's required capabilities
 * come first. A model that matches every required capability ranks above one
 * that matches some, which ranks above one that matches none.
 *
 * Vision is treated as a *hard* requirement — non-vision models are filtered
 * out of the front rank and only kept as last-resort fallbacks (vendor will
 * usually error rather than silently drop the image, which is the right
 * failure mode for the cross-vendor fallback to recover from).
 */
export function reorderPoolByShape(
  body: ChatCompletionRequest,
  pool: readonly string[],
): readonly string[] {
  const shape = inferShape(body);
  if (!shape.hasTools && !shape.hasStructuredOutput && !shape.hasVision && !shape.hasOcr) {
    return pool;
  }

  const score = (model: string): number => {
    let s = 0;
    if (shape.hasOcr              && OCR_MODELS.has(model))               s += 8;
    if (shape.hasVision           && VISION_MODELS.has(model))            s += 4;
    if (shape.hasTools            && TOOL_CAPABLE_MODELS.has(model))      s += 2;
    if (shape.hasStructuredOutput && STRUCTURED_OUTPUT_MODELS.has(model)) s += 1;
    return s;
  };

  // Stable sort by descending score; preserves original pool order within ties.
  return [...pool]
    .map((m, i) => ({ m, i, s: score(m) }))
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .map((x) => x.m);
}

const STANDARD_BODY_FIELDS: ReadonlySet<string> = new Set([
  'model', 'messages', 'temperature', 'max_tokens', 'top_p', 'stream',
  // Gateway-side only — stripped before vendor dispatch:
  'useCase',     // opaque telemetry slug; persisted to llm_usage_log.use_case, echoed back
  'metadata',    // free-form trace-back kv; persisted to llm_usage_log.metadata, echoed back
  'modelStrict', // strict-pin flag — gateway-only; controls failover behaviour
  // OpenAI-compatible pass-throughs (`tools`, `tool_choice`, `response_format`)
  // travel via the `extraBody` catch-all and reach the vendor verbatim.
]);

/** Pick out non-standard fields from the request body so they can be passed
 *  through as `extraBody` to the vendor. */
function stripStandardFields(body: ChatCompletionRequest): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (STANDARD_BODY_FIELDS.has(key)) continue;
    out[key] = (body as Record<string, unknown>)[key];
  }
  return out;
}
