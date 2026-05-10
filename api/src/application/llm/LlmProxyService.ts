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
  dispatchVendor,
  dispatchVendorStream,
  getCrossVendorFallbacks,
  openRouterModule,
  vendorForModel,
  type DispatchAttempt,
  type VendorEnv,
  type VendorId,
} from './vendors';
import { sanitizeRequestToolNames, restoreResponseToolNames } from './toolNameSanitizer';
import { loadCooldowns, recordFailure } from '../../infrastructure/auth/cooldownStore';
import { cerebrasModule, ollamaModule } from './vendors';
import { validateJsonSchema } from './jsonSchemaValidator';

// ---------------------------------------------------------------------------
// Pool composition (derived from vendor catalogs — single source of truth)
// ---------------------------------------------------------------------------

/** OpenRouter free-tier ids, in catalog order. Best/preferred first. */
export const FREE_MODEL_POOL: readonly string[] = openRouterModule.catalog
  .filter((m) => m.tier === 'FREE')
  .map((m) => m.id);

/** OpenRouter paid-tier ids (STANDARD / PREMIUM / ULTRA). */
export const PRO_PAID_MODEL_POOL: readonly string[] = openRouterModule.catalog
  .filter((m) => m.tier === 'PREMIUM' || m.tier === 'ULTRA' || m.tier === 'STANDARD')
  .map((m) => m.id);

/** Pro tries free first (cost-optimized), falls over to paid. */
export const PRO_MODEL_POOL: readonly string[] = [...FREE_MODEL_POOL, ...PRO_PAID_MODEL_POOL];

/** First N models of the active pool form the round-robin "preferred" group. */
export const PREFERRED_POOL_SIZE = 2;

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
}

/** One model attempt that failed before the resolved model succeeded. */
export interface FailoverEvent {
  model: string;
  /** HTTP status, or 0 for embedded errors / network failures. */
  code: number;
}

export interface ProxyResult {
  /** Final upstream Response (may be streamed). */
  response: Response;
  /** Which model actually served the request. */
  resolvedModel: string;
  /** How many failovers happened before success. */
  retries: number;
  failovers: FailoverEvent[];
  /** Token usage from non-streaming responses; undefined for streams (route intercepts). */
  usage?: LlmUsage;
  /** Number of times the gateway re-dispatched on non-conforming JSON output
   *  (only applies when `body.response_format.type` is `json_object`/`json_schema`). */
  schemaRetries?: number;
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

let requestCursor = 0;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface LlmProxyOptions {
  modelPool?: readonly string[];
  preferredPoolSize?: number;
  productName?: ProductName;
}

export class LlmProxyService {
  private readonly env: ProxyEnv;
  private readonly modelPool: readonly string[];
  private readonly preferredPoolSize: number;
  private readonly productName: ProductName;
  private readonly isPro: boolean;

  constructor(env: ProxyEnv, options?: LlmProxyOptions) {
    this.env = env;
    this.modelPool = options?.modelPool ?? FREE_MODEL_POOL;
    this.preferredPoolSize = Math.min(options?.preferredPoolSize ?? PREFERRED_POOL_SIZE, this.modelPool.length);
    this.productName = options?.productName ?? 'builderforceLLM';
    this.isPro = this.productName === 'builderforceLLMPro' || this.productName === 'builderforceLLMTeams';
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
  ): Promise<ProxyResult> {
    const callerModel = (body as { model?: unknown }).model;
    const wantsStrict = (body as { modelStrict?: unknown }).modelStrict === true
                     && typeof callerModel === 'string'
                     && callerModel.length > 0;

    // Strict-pin path: single-model dispatch, no chain, no failover. Cooldown
    // and missing-vendor-key are the only pre-flight gates; if either fails
    // the request returns 503 `model_unavailable` instead of falling through.
    if (wantsStrict) {
      return this.dispatchStrict(callerModel as string, body, requestHeaders);
    }

    // 1) Pool composition: prepend fast cross-vendor models (Cerebras, Ollama)
    //    when their keys are bound — sub-200ms TTFT for Cerebras beats
    //    OpenRouter free-tier under load. The OpenRouter pool stays in place
    //    behind them so we keep the existing breadth.
    const fastVendorHead = this.fastVendorHead();
    const basePool: readonly string[] = [
      ...fastVendorHead,
      ...this.modelPool.filter((m) => !fastVendorHead.includes(m)),
    ];
    const reorderedPool = reorderPoolByShape(body, basePool);

    // 2) Caller hint goes at the head; rest of the pool follows.
    //    `callerModel` was extracted at the top of this function for the
    //    strict-pin branch; reuse it here for the chained path.
    const seed: readonly string[] = (typeof callerModel === 'string' && callerModel.length > 0)
      ? [callerModel, ...reorderedPool.filter((m) => m !== callerModel)]
      : reorderedPool;

    // 3) Pre-fetch cooldown state for the seed (KV-backed when bound, in-memory
    //    fallback otherwise). One bulk read; the chain composer filters
    //    synchronously against the resulting set.
    const cooledSet = await loadCooldowns(
      this.env,
      seed.map((m) => ({ vendor: vendorForModel(m), model: m })),
    );
    const candidates = this.buildCandidateChain(seed, cooledSet);
    return this.dispatch(candidates, body, requestHeaders);
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
    const env = this.vendorEnv();

    const vendorKeyBound =
      (vendor === 'openrouter' && !!env.OPENROUTER_API_KEY) ||
      (vendor === 'cerebras'   && !!env.CEREBRAS_API_KEY)   ||
      (vendor === 'ollama'     && !!env.OLLAMA_API_KEY);
    if (!vendorKeyBound) {
      return strictUnavailableResult(model, 'vendor_key_unconfigured');
    }

    const cooledSet = await loadCooldowns(this.env, [{ vendor, model }]);
    if (cooledSet.has(`${vendor}/${model}`)) {
      return strictUnavailableResult(model, 'cooldown');
    }

    return this.dispatch([model], body, requestHeaders);
  }

  /** Cross-vendor fast-tier models worth trying before the main pool. */
  private fastVendorHead(): string[] {
    const env = this.vendorEnv();
    const head: string[] = [];
    if (env.CEREBRAS_API_KEY) {
      // Cerebras free models — sub-200ms TTFT.
      for (const m of cerebrasModule.catalog) if (m.tier === 'FREE') head.push(m.id);
    }
    if (env.OLLAMA_API_KEY) {
      // Ollama Cloud free entries.
      for (const m of ollamaModule.catalog) if (m.tier === 'FREE') head.push(m.id);
    }
    return head;
  }

  /** Per-model status with cooldown info — used by /v1/models. */
  async status(): Promise<Array<{ model: string; preferred: boolean; available: boolean; cooldownUntil?: number; vendor: VendorId }>> {
    const cooledSet = await loadCooldowns(
      this.env,
      this.modelPool.map((m) => ({ vendor: vendorForModel(m), model: m })),
    );
    return this.modelPool.map((model, i) => {
      const vendor = vendorForModel(model);
      const cooled = cooledSet.has(`${vendor}/${model}`);
      return {
        model,
        vendor,
        preferred: i < this.preferredPoolSize,
        available: !cooled,
      };
    });
  }

  // --- Internals ------------------------------------------------------------

  /**
   * Compose the candidate chain for one request:
   *   1. Round-robin within preferred sub-pool (filtered by cooldown)
   *   2. Append remaining pool (filtered by cooldown)
   *   3. Append cross-vendor fallbacks (each configured vendor's fallbackModel)
   *   4. Deduplicate, preserving first occurrence
   *   5. If everything is on cooldown, fall back to the un-filtered pool
   */
  private buildCandidateChain(seed: readonly string[], cooledSet: Set<string>): string[] {
    const preferred = seed.slice(0, this.preferredPoolSize);
    const fallback  = seed.slice(this.preferredPoolSize);

    const isCooled = (m: string) => cooledSet.has(`${vendorForModel(m)}/${m}`);
    const preferredAvailable = preferred.filter((m) => !isCooled(m));
    const fallbackAvailable  = fallback.filter((m)  => !isCooled(m));

    let chain: string[];
    if (preferredAvailable.length > 0) {
      const start = requestCursor % preferredAvailable.length;
      chain = [
        ...preferredAvailable.slice(start),
        ...preferredAvailable.slice(0, start),
        ...fallbackAvailable,
      ];
    } else if (fallbackAvailable.length > 0) {
      chain = [...fallbackAvailable];
    } else {
      // Everything cooled — try seed in original order (last resort).
      chain = [...seed];
    }
    requestCursor++;

    // Append cross-vendor fallbacks, then dedupe.
    const composed = [...chain, ...getCrossVendorFallbacks(this.vendorEnv())];
    const seen = new Set<string>();
    return composed.filter((m) => (seen.has(m) ? false : (seen.add(m), true)));
  }

  /** Synthesize the env passed to vendors — picks the Pro OpenRouter key when applicable. */
  private vendorEnv(): VendorEnv {
    return {
      OPENROUTER_API_KEY: this.isPro
        ? (this.env.OPENROUTER_API_KEY_PRO ?? this.env.OPENROUTER_API_KEY ?? null)
        : (this.env.OPENROUTER_API_KEY ?? null),
      CEREBRAS_API_KEY: this.env.CEREBRAS_API_KEY ?? null,
      OLLAMA_API_KEY:   this.env.OLLAMA_API_KEY   ?? null,
    };
  }

  private async dispatch(
    candidates: string[],
    body: ChatCompletionRequest,
    requestHeaders?: Record<string, string>,
  ): Promise<ProxyResult> {
    // Sanitize tool names (`governance.snapshot` → `governance__DOT__snapshot`)
    // before the body reaches a vendor — Anthropic / some Cerebras configs
    // reject dots. Walks `tools`, `tool_choice`, message `tool_calls`, and
    // tool-message `name`. Restored in dispatchJson before returning to caller.
    const sanitizedBody = sanitizeRequestToolNames(body as unknown as Record<string, unknown>) as unknown as ChatCompletionRequest;
    const messages = sanitizedBody.messages as unknown as Array<Record<string, unknown>>;
    const extraBody = stripStandardFields(sanitizedBody);
    const callParams = {
      messages,
      ...(sanitizedBody.max_tokens  != null ? { maxTokens:   sanitizedBody.max_tokens  } : {}),
      ...(sanitizedBody.temperature != null ? { temperature: sanitizedBody.temperature } : {}),
      ...(sanitizedBody.top_p       != null ? { topP:        sanitizedBody.top_p       } : {}),
      ...(Object.keys(extraBody).length > 0 ? { extraBody } : {}),
      title: this.productName,
    };

    if (sanitizedBody.stream) {
      return this.dispatchStream(candidates, callParams, requestHeaders);
    }
    return this.dispatchJson(candidates, callParams, sanitizedBody);
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
          env: this.vendorEnv(),
          modelChain: chain,
          ...callParams,
        });
      } catch (err) {
        return this.exhaustedResponse(candidates, schemaRetries, err);
      }

      this.applyCooldowns(result.attempts);
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
      retries: totalAttempts,
      failovers: totalFailovers,
      ...(result.usage ? {
        usage: {
          promptTokens:     result.usage.prompt_tokens     ?? 0,
          completionTokens: result.usage.completion_tokens ?? 0,
          totalTokens:      result.usage.total_tokens      ?? 0,
        },
      } : {}),
      ...(schemaRetries > 0 ? { schemaRetries } : {}),
    };
  }

  private exhaustedResponse(candidates: string[], schemaRetries: number, err?: unknown): ProxyResult {
    const message = err instanceof Error ? err.message : (err ? String(err) : 'All candidates produced non-conforming output');
    const exhaustedBody = JSON.stringify({
      error: { message, code: 429, type: 'rate_limit_error' },
    });
    return {
      response: new Response(exhaustedBody, {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
      resolvedModel: candidates[candidates.length - 1] ?? this.modelPool[0] ?? FREE_MODEL_POOL[0] ?? '',
      retries: candidates.length,
      failovers: candidates.map((model) => ({ model, code: 0 })),
      ...(schemaRetries > 0 ? { schemaRetries } : {}),
    };
  }

  private async dispatchStream(
    candidates: string[],
    callParams: Omit<Parameters<typeof dispatchVendorStream>[0], 'env' | 'modelChain'>,
    _requestHeaders?: Record<string, string>,
  ): Promise<ProxyResult> {
    try {
      const result = await dispatchVendorStream({
        env: this.vendorEnv(),
        modelChain: candidates,
        ...callParams,
      });
      this.applyCooldowns(result.attempts);
      return {
        response: result.response,
        resolvedModel: result.modelUsed,
        retries: result.attempts.length,
        failovers: attemptsToFailovers(result.attempts),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const exhaustedBody = JSON.stringify({
        error: { message, code: 429, type: 'rate_limit_error' },
      });
      return {
        response: new Response(exhaustedBody, {
          status: 429,
          headers: { 'content-type': 'application/json' },
        }),
        resolvedModel: candidates[candidates.length - 1] ?? this.modelPool[0] ?? FREE_MODEL_POOL[0] ?? '',
        retries: candidates.length,
        failovers: candidates.map((model) => ({ model, code: 0 })),
      };
    }
  }

  /**
   * Record cooldowns for every failed attempt. Classification (5 min for
   * transient, 30 min for auth) lives in `cooldownStore.classifyFailure`.
   * Fire-and-forget — the dispatch result must not wait for KV writes.
   */
  private applyCooldowns(attempts: DispatchAttempt[]): void {
    for (const a of attempts) {
      void recordFailure(this.env, a.vendor, a.model, a.status, a.error);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function attemptsToFailovers(attempts: DispatchAttempt[]): FailoverEvent[] {
  return attempts.map((a) => ({ model: a.model, code: a.status }));
}

// ---------------------------------------------------------------------------
// Plan → proxy factory  (eliminates duplicated isPro/pool/productName wiring)
// ---------------------------------------------------------------------------

export type EffectivePlan = 'free' | 'pro' | 'teams';

/** Map an effective plan to its productName + model pool, then construct the proxy.
 *  Single source of truth so /v1/chat/completions and /v1/models stay aligned. */
export function llmProxyForPlan(env: ProxyEnv, effectivePlan: EffectivePlan): LlmProxyService {
  const productName: ProductName =
    effectivePlan === 'teams' ? 'builderforceLLMTeams'
    : effectivePlan === 'pro' ? 'builderforceLLMPro'
    :                            'builderforceLLM';
  const modelPool = effectivePlan === 'free' ? FREE_MODEL_POOL : PRO_MODEL_POOL;
  return new LlmProxyService(env, { modelPool, preferredPoolSize: PREFERRED_POOL_SIZE, productName });
}

export function productNameForPlan(effectivePlan: EffectivePlan): ProductName {
  return effectivePlan === 'teams' ? 'builderforceLLMTeams'
    : effectivePlan === 'pro'      ? 'builderforceLLMPro'
    :                                 'builderforceLLM';
}

export function modelPoolForPlan(effectivePlan: EffectivePlan): readonly string[] {
  return effectivePlan === 'free' ? FREE_MODEL_POOL : PRO_MODEL_POOL;
}

/** Free-tier proxy for IDE-internal callers (chat, dataset gen, agent inference, brain).
 *  Always uses FREE_MODEL_POOL and productName='builderforceLLM'. */
export function ideProxy(env: ProxyEnv): LlmProxyService {
  return new LlmProxyService(env, {
    modelPool: FREE_MODEL_POOL,
    preferredPoolSize: PREFERRED_POOL_SIZE,
    productName: 'builderforceLLM',
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
  const body = JSON.stringify({
    error: `Strict-pin: model '${model}' is unavailable (${reason}).`,
    code: 'model_unavailable',
    details: { requestedModel: model, reason },
  });
  return {
    response: new Response(body, {
      status: 503,
      headers: { 'content-type': 'application/json' },
    }),
    resolvedModel: model,
    retries: 0,
    failovers: [],
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
