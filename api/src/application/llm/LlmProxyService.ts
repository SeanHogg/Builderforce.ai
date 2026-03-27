/**
 * coderClawLLM — OpenRouter free-model proxy with automatic failover.
 *
 * Handles error signals from OpenRouter:
 *   1. HTTP 4xx/5xx status (except 400/401 which are client errors)
 *   2. HTTP 200 with {"error":{...}} in the body
 *      (OpenRouter sends this for upstream provider errors — rate limits, spend
 *       limits, capacity issues, etc.)
 *   3. First SSE chunk contains an error object (streaming variant of #2)
 *
 * On any of these signals the model is put on a 60-second cooldown and the next
 * healthy model in the pool is tried transparently.
 *
 * Pool strategy:
 *   - The first PREFERRED_POOL_SIZE models are the primary pool; round-robin
 *     rotates only within them so they handle the vast majority of traffic.
 *   - The remaining models are fallbacks, tried only when all preferred models
 *     are on cooldown.
 */

// ---------------------------------------------------------------------------
// Free model pool — ordered by quality/ctx preference (best first)
//
// PREFERRED_POOL_SIZE: the first N models are the primary round-robin group.
// The rest are genuine fallbacks tried only when preferred are all on cooldown.
// ---------------------------------------------------------------------------

export const FREE_MODEL_POOL = [
  'qwen/qwen3-coder:free',                                   // 262k ctx  ← preferred
  'qwen/qwen3-next-80b-a3b-instruct:free',                   // 262k ctx  ← preferred
  'stepfun/step-3.5-flash:free',                              // 256k ctx
  'nvidia/nemotron-3-nano-30b-a3b:free',                      // 256k ctx
  'google/gemma-3-27b-it:free',                               // 131k ctx
  'meta-llama/llama-3.3-70b-instruct:free',                   // 128k ctx
  'mistralai/mistral-small-3.1-24b-instruct:free',            // 128k ctx
  'nousresearch/hermes-3-llama-3.1-405b:free',                // 131k ctx
  'arcee-ai/trinity-large-preview:free',                      // 131k ctx
  'upstage/solar-pro-3:free',                                 // 128k ctx
  'nvidia/nemotron-nano-9b-v2:free',                          // 128k ctx
  'google/gemma-3-12b-it:free',                               // 32k ctx
] as const;

export const PRO_PAID_MODEL_POOL = [
  'anthropic/claude-3.7-sonnet',
  'openai/gpt-4.1',
  'google/gemini-2.5-pro',
  'x-ai/grok-3-mini',
] as const;

/**
 * Pro traffic strategy:
 * - Try free coding models first (cost-optimized).
 * - On rate-limit/provider errors, fail over to paid coding models.
 */
export const PRO_MODEL_POOL = [
  ...FREE_MODEL_POOL,
  ...PRO_PAID_MODEL_POOL,
] as const;

/** Number of models at the top of the pool that form the primary round-robin group. */
export const PREFERRED_POOL_SIZE = 2;

export type FreeModel = (typeof FREE_MODEL_POOL)[number];
export type ProModel = (typeof PRO_MODEL_POOL)[number];
type AnyPoolModel = FreeModel | ProModel;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
}

export interface ChatCompletionRequest {
  /** Ignored when proxied — we pick the model from the pool. */
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
  /** Any extra passthrough params for OpenRouter. */
  [key: string]: unknown;
}

export interface LlmUsage {
  promptTokens:     number;
  completionTokens: number;
  totalTokens:      number;
}

/** One model attempt that failed and triggered failover. */
export interface FailoverEvent {
  /** The model that was tried. */
  model: string;
  /**
   * HTTP status code for HTTP-level failures (402, 429, 503, etc.).
   * 0 for provider errors embedded in a 200 response body or stream chunk.
   */
  code: number;
}

export interface ProxyResult {
  /** The raw Response from OpenRouter (may be streamed). */
  response: Response;
  /** Which model actually served the request. */
  resolvedModel: string;
  /** How many failovers happened before success. */
  retries: number;
  /** Each model that was tried and failed before the resolved model. */
  failovers: FailoverEvent[];
  /**
   * Token usage extracted from a non-streaming response body.
   * Undefined for streaming responses — captured via stream interception in the route.
   */
  usage?: LlmUsage;
}

// ---------------------------------------------------------------------------
// Cooldown tracker  (in-memory, per-isolate)
// ---------------------------------------------------------------------------

/** model → timestamp when cooldown expires */
const cooldowns = new Map<string, number>();

const COOLDOWN_MS = 60_000; // 60 s cooldown after any provider error

function markCooldown(model: string): void {
  cooldowns.set(model, Date.now() + COOLDOWN_MS);
}

function isOnCooldown(model: string): boolean {
  const until = cooldowns.get(model);
  if (!until) return false;
  if (Date.now() >= until) { cooldowns.delete(model); return false; }
  return true;
}

// ---------------------------------------------------------------------------
// Round-robin cursor  (in-memory, per-isolate)
// ---------------------------------------------------------------------------

/** Advances each request so the starting model rotates within the preferred pool. */
let requestCursor = 0;

// ---------------------------------------------------------------------------
// Error detection helpers
// ---------------------------------------------------------------------------

/**
 * HTTP status codes that warrant failover to the next model.
 * - 400 Bad Request: client error — won't improve by switching models.
 * - 401 Unauthorized: API key invalid — switching models won't help.
 * - Everything else 4xx/5xx: provider/capacity error → try next model.
 */
function isFailoverStatus(status: number): boolean {
  return status >= 400 && status !== 400 && status !== 401;
}

/** Detect any provider error in a parsed JSON body. */
function isBodyError(json: Record<string, unknown>): boolean {
  return 'error' in json && json['error'] != null;
}

/**
 * Detect a provider error in a raw SSE text chunk.
 * Tries to parse the first `data:` line as JSON; falls back to text heuristics.
 */
function isChunkError(text: string): boolean {
  if (!text.includes('"error"')) return false;
  // Try to parse the first SSE data line
  const dataLine = text.split('\n').find((l) => l.startsWith('data: '));
  if (!dataLine) return true; // has "error" substring but no parseable line → be safe
  try {
    const parsed = JSON.parse(dataLine.slice(6)) as Record<string, unknown>;
    return 'error' in parsed && parsed['error'] != null;
  } catch {
    return true; // unparseable chunk that mentions "error" → failover
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1/chat/completions';

export class LlmProxyService {
  private readonly apiKey: string;
  private readonly modelPool: readonly AnyPoolModel[];
  private readonly preferredPoolSize: number;
  private readonly productName: 'coderClawLLM' | 'coderClawLLMPro' | 'coderClawLLMTeams';

  constructor(
    apiKey: string,
    options?: {
      modelPool?: readonly AnyPoolModel[];
      preferredPoolSize?: number;
      productName?: 'coderClawLLM' | 'coderClawLLMPro' | 'coderClawLLMTeams';
    },
  ) {
    this.apiKey = apiKey;
    this.modelPool = options?.modelPool ?? FREE_MODEL_POOL;
    this.preferredPoolSize = Math.min(options?.preferredPoolSize ?? PREFERRED_POOL_SIZE, this.modelPool.length);
    this.productName = options?.productName ?? 'coderClawLLM';
  }

  /**
   * Forward a chat-completion request through the free model pool.
   *
   * Candidate selection:
   *   1. Round-robin within the preferred pool (first PREFERRED_POOL_SIZE models).
   *   2. If all preferred are on cooldown, fall through to the remaining models.
   *   3. If everything is on cooldown, try all models in order as last resort.
   *
   * Any failed attempt is recorded as a FailoverEvent in the result.
   */
  async complete(
    body: ChatCompletionRequest,
    requestHeaders?: Record<string, string>,
  ): Promise<ProxyResult> {
    const preferredPool = this.modelPool.slice(0, this.preferredPoolSize) as AnyPoolModel[];
    const fallbackPool  = this.modelPool.slice(this.preferredPoolSize) as AnyPoolModel[];

    const preferredAvailable = preferredPool.filter((m) => !isOnCooldown(m));
    const fallbackAvailable  = fallbackPool.filter((m)  => !isOnCooldown(m));

    let candidates: AnyPoolModel[];
    if (preferredAvailable.length > 0) {
      // Round-robin within the preferred pool; fallbacks appended after
      const start = requestCursor % preferredAvailable.length;
      candidates = [
        ...preferredAvailable.slice(start),
        ...preferredAvailable.slice(0, start),
        ...fallbackAvailable,
      ];
    } else if (fallbackAvailable.length > 0) {
      candidates = fallbackAvailable;
    } else {
      // Everything on cooldown — try all in original order as last resort
      candidates = [...this.modelPool] as AnyPoolModel[];
    }
    requestCursor++;

    let lastResponse: Response | undefined;
    let retries = 0;
    const failovers: FailoverEvent[] = [];

    for (const model of candidates) {
      const upstream = await fetch(OPENROUTER_BASE, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://builderforce.ai',
          'X-Title': this.productName,
          ...(requestHeaders ?? {}),
        },
        body: JSON.stringify({ ...body, model }),
      });

      // ── HTTP error status (402 spend limit, 429 rate limit, 5xx, etc.) ───────
      if (isFailoverStatus(upstream.status)) {
        failovers.push({ model, code: upstream.status });
        markCooldown(model);
        lastResponse = upstream;
        retries++;
        continue;
      }

      // ── Streaming: peek first chunk for embedded error ────────────────────
      if (body.stream && upstream.body) {
        const [peekStream, passStream] = upstream.body.tee();
        const reader = peekStream.getReader();
        const { value: firstChunk } = await reader.read();
        reader.cancel().catch(() => { /* ignore */ });

        const firstText = firstChunk ? new TextDecoder().decode(firstChunk) : '';

        if (isChunkError(firstText)) {
          await passStream.cancel().catch(() => { /* ignore */ });
          failovers.push({ model, code: 0 });
          markCooldown(model);
          retries++;
          continue;
        }

        // Good stream — pass through
        return {
          response: new Response(passStream, { status: upstream.status, headers: upstream.headers }),
          resolvedModel: model,
          retries,
          failovers,
        };
      }

      // ── Non-streaming: read body and check for embedded error ─────────────
      const json = await upstream.json() as Record<string, unknown>;

      if (isBodyError(json)) {
        failovers.push({ model, code: 0 });
        markCooldown(model);
        retries++;
        continue;
      }

      // Extract token usage from the response body
      const rawUsage = json['usage'] as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;
      const usage: LlmUsage | undefined = rawUsage ? {
        promptTokens:     rawUsage.prompt_tokens     ?? 0,
        completionTokens: rawUsage.completion_tokens ?? 0,
        totalTokens:      rawUsage.total_tokens      ?? 0,
      } : undefined;

      // Good response — reconstruct so the route handler can .json() it
      return {
        response: new Response(JSON.stringify(json), {
          status: upstream.status,
          headers: upstream.headers,
        }),
        resolvedModel: model,
        retries,
        failovers,
        usage,
      };
    }

    // All candidates exhausted — return a clean error
    const exhaustedBody = JSON.stringify({
      error: {
        message: 'All free models are temporarily unavailable. Please retry in a moment.',
        code: 429,
        type: 'rate_limit_error',
      },
    });
    return {
      response: lastResponse ?? new Response(exhaustedBody, {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
      resolvedModel: candidates[candidates.length - 1] ?? this.modelPool[0] ?? FREE_MODEL_POOL[0],
      retries,
      failovers,
    };
  }

  /** Return the current model pool with cooldown status. */
  status(): Array<{ model: string; preferred: boolean; available: boolean; cooldownUntil?: number }> {
    return this.modelPool.map((model, i) => {
      const until = cooldowns.get(model);
      const available = !until || Date.now() >= until;
      return {
        model,
        preferred: i < this.preferredPoolSize,
        available,
        ...(until && !available ? { cooldownUntil: until } : {}),
      };
    });
  }
}
