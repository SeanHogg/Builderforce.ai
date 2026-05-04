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
 * The service exposes two entry points:
 *   - `complete(body)`            — legacy "give me a chat completion from this pool" mode
 *   - `completeForUseCase(useCase, body)` — declare intent; the chain composer picks the chain
 */

import { isAIUseCase, getUseCaseSpec, type AIUseCase } from './aiUseCases';
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
   * Forward a chat-completion request through the configured pool.
   * The model field on `body` is ignored — the chain composer picks it.
   */
  async complete(
    body: ChatCompletionRequest,
    requestHeaders?: Record<string, string>,
  ): Promise<ProxyResult> {
    const candidates = this.buildCandidateChain(this.modelPool);
    return this.dispatch(candidates, body, requestHeaders);
  }

  /**
   * Use-case-driven completion. The use-case's preferredChain is the seed of the
   * dispatch chain; the proxy still adds its own cross-vendor fallbacks so
   * exhaustion of the use-case chain falls into the broader pool.
   */
  async completeForUseCase(
    useCase: AIUseCase | string,
    body: ChatCompletionRequest,
    requestHeaders?: Record<string, string>,
  ): Promise<ProxyResult> {
    if (!isAIUseCase(useCase)) {
      throw new Error(`Unknown AI use case: ${useCase}`);
    }
    const spec = getUseCaseSpec(useCase);
    const seed = [...spec.preferredChain];

    // Apply use-case temperature / max_tokens defaults if caller didn't set them.
    const enrichedBody: ChatCompletionRequest = {
      ...body,
      max_tokens:  body.max_tokens  ?? spec.maxTokens,
      ...(spec.temperature != null && body.temperature == null ? { temperature: spec.temperature } : {}),
    };

    const candidates = this.buildCandidateChain(seed);
    return this.dispatch(candidates, enrichedBody, requestHeaders);
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
    return this.dispatchJson(candidates, callParams);
  }

  private async dispatchJson(
    candidates: string[],
    callParams: Omit<Parameters<typeof dispatchVendor>[0], 'env' | 'modelChain'>,
  ): Promise<ProxyResult> {
    try {
      const result = await dispatchVendor({
        env: this.vendorEnv(),
        modelChain: candidates,
        ...callParams,
      });
      this.applyCooldowns(result.attempts);
      return {
        response: new Response(JSON.stringify(result.raw), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
        resolvedModel: result.modelUsed,
        retries: result.attempts.length,
        failovers: attemptsToFailovers(result.attempts),
        ...(result.usage ? {
          usage: {
            promptTokens:     result.usage.prompt_tokens     ?? 0,
            completionTokens: result.usage.completion_tokens ?? 0,
            totalTokens:      result.usage.total_tokens      ?? 0,
          },
        } : {}),
      };
    } catch (err) {
      // Cascade exhausted — surface as a 429 envelope so existing handlers see the same shape.
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

const STANDARD_BODY_FIELDS: ReadonlySet<string> = new Set([
  'model', 'messages', 'temperature', 'max_tokens', 'top_p', 'stream',
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
