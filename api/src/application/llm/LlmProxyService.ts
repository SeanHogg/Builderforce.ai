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
}

// ---------------------------------------------------------------------------
// Cooldown tracker (per-isolate, in-memory)
// ---------------------------------------------------------------------------

const cooldowns = new Map<string, number>();
const COOLDOWN_MS = 60_000;

function cooldownKey(vendor: VendorId, model: string): string { return `${vendor}/${model}`; }
function markCooldown(vendor: VendorId, model: string): void {
  cooldowns.set(cooldownKey(vendor, model), Date.now() + COOLDOWN_MS);
}
function isOnCooldown(vendor: VendorId, model: string): boolean {
  const k = cooldownKey(vendor, model);
  const until = cooldowns.get(k);
  if (!until) return false;
  if (Date.now() >= until) { cooldowns.delete(k); return false; }
  return true;
}

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
   * Forward a chat-completion request.
   *
   * Two modes:
   *
   * 1. **Caller-pinned (`body.model` set)** — the gateway forwards verbatim.
   *    No substitution, no shape-based reorder, no chain fallback. On vendor
   *    error the upstream status + body propagate via the standard exhausted-
   *    chain envelope so the caller can decide whether to retry their own
   *    fallback chain. Vendor prefixes (`openrouter/<id>`, `cerebras/<id>`,
   *    `ollama/<id>`) route to the named vendor explicitly.
   *
   * 2. **Pool mode (`body.model` unset)** — the gateway picks from the tenant-
   *    plan model pool, with shape-based reordering (tools / response_format /
   *    vision content) and the standard cross-vendor failover chain.
   */
  async complete(
    body: ChatCompletionRequest,
    requestHeaders?: Record<string, string>,
  ): Promise<ProxyResult> {
    const callerModel = (body as { model?: unknown }).model;
    if (typeof callerModel === 'string' && callerModel.length > 0) {
      // Caller-pinned: chain of length 1, no failover, no cooldown bypass.
      return this.dispatch([callerModel], body, requestHeaders);
    }
    const reorderedPool = reorderPoolByShape(body, this.modelPool);
    const candidates = this.buildCandidateChain(reorderedPool);
    return this.dispatch(candidates, body, requestHeaders);
  }

  /** Per-model status with cooldown info — used by /v1/models. */
  status(): Array<{ model: string; preferred: boolean; available: boolean; cooldownUntil?: number; vendor: VendorId }> {
    return this.modelPool.map((model, i) => {
      const vendor = vendorForModel(model);
      const until = cooldowns.get(cooldownKey(vendor, model));
      const available = !until || Date.now() >= until;
      return {
        model,
        vendor,
        preferred: i < this.preferredPoolSize,
        available,
        ...(until && !available ? { cooldownUntil: until } : {}),
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
  private buildCandidateChain(seed: readonly string[]): string[] {
    const preferred = seed.slice(0, this.preferredPoolSize);
    const fallback  = seed.slice(this.preferredPoolSize);

    const preferredAvailable = preferred.filter((m) => !isOnCooldown(vendorForModel(m), m));
    const fallbackAvailable  = fallback.filter((m)  => !isOnCooldown(vendorForModel(m), m));

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
    const messages = body.messages as unknown as Array<Record<string, unknown>>;
    const extraBody = stripStandardFields(body);
    const callParams = {
      messages,
      ...(body.max_tokens  != null ? { maxTokens:   body.max_tokens  } : {}),
      ...(body.temperature != null ? { temperature: body.temperature } : {}),
      ...(body.top_p       != null ? { topP:        body.top_p       } : {}),
      ...(Object.keys(extraBody).length > 0 ? { extraBody } : {}),
      title: this.productName,
    };

    if (body.stream) {
      return this.dispatchStream(candidates, callParams, requestHeaders);
    }
    return this.dispatchJson(candidates, callParams, body);
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
    return {
      response: new Response(JSON.stringify(result.raw), {
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

  private applyCooldowns(attempts: DispatchAttempt[]): void {
    for (const a of attempts) markCooldown(a.vendor, a.model);
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
  const rf = (body as { response_format?: { type?: string; json_schema?: { strict?: boolean; schema?: { required?: unknown } } } }).response_format;
  if (!rf || (rf.type !== 'json_object' && rf.type !== 'json_schema')) return null;

  const content = extractAssistantContent(raw);
  if (content === null) return null; // Tool-call assistant turns legitimately have no content.

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return 'content is not valid JSON';
  }

  if (rf.type === 'json_schema' && rf.json_schema?.strict === true) {
    const required = rf.json_schema?.schema?.required;
    if (Array.isArray(required) && required.length > 0) {
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return 'content is JSON but not a top-level object';
      }
      const obj = parsed as Record<string, unknown>;
      for (const field of required as unknown[]) {
        if (typeof field === 'string' && !(field in obj)) {
          return `missing required field "${field}"`;
        }
      }
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
]);

interface ShapeFlags {
  hasTools: boolean;
  hasStructuredOutput: boolean;
  hasVision: boolean;
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

  return { hasTools, hasStructuredOutput, hasVision };
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
  if (!shape.hasTools && !shape.hasStructuredOutput && !shape.hasVision) {
    return pool;
  }

  const score = (model: string): number => {
    let s = 0;
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
  'useCase',   // opaque telemetry slug; persisted to llm_usage_log.use_case, echoed back
  'metadata',  // free-form trace-back kv; persisted to llm_usage_log.metadata, echoed back
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
