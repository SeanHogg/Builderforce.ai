export const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Free models available on OpenRouter, used in round-robin order.
 * When a model returns 429 (rate limited) the next model in the list is tried.
 */
export const FREE_MODELS = [
  'meta-llama/llama-3.1-8b-instruct:free',
  'meta-llama/llama-3.2-3b-instruct:free',
  'google/gemma-3-4b-it:free',
  'mistralai/mistral-7b-instruct:free',
  'qwen/qwen-2-7b-instruct:free',
  'microsoft/phi-3-mini-128k-instruct:free',
];

/**
 * Module-level counter for round-robin model selection.
 *
 * NOTE: Cloudflare Workers may handle multiple concurrent requests within the
 * same isolate, so this counter is shared across simultaneous requests. The
 * distribution will be approximately round-robin but is not strictly ordered
 * under high concurrency. This is an acceptable trade-off given that the primary
 * goal is spreading load rather than guaranteeing strict ordering.
 */
let modelIndex = 0;

/** Returns the next index in the round-robin sequence and advances the counter. */
export function getNextModelIndex(): number {
  const idx = modelIndex;
  modelIndex = (modelIndex + 1) % FREE_MODELS.length;
  return idx;
}

/**
 * Reset the round-robin counter to zero.
 * @internal This function exists solely for deterministic unit testing and
 * should not be called in production code.
 */
export function resetModelIndex(): void {
  modelIndex = 0;
}

export type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string };

/**
 * AI_PROVIDER controls which backend handles a request:
 *   "cloudflare" — Cloudflare Workers AI (default)
 *   "openrouter" — OpenRouter free-model pool with round-robin failover
 *   "ab"         — Each request is randomly routed to one of the two providers
 *                  (50 / 50 split) for A/B validation.
 */
export type AIProvider = 'cloudflare' | 'openrouter' | 'ab';

export interface AIEnv {
  AI?: Ai;
  OPENROUTER_API_KEY?: string;
  /** Defaults to "cloudflare" when not set. */
  AI_PROVIDER?: AIProvider;
}

/** Fraction of A/B traffic routed to OpenRouter (remainder goes to Cloudflare AI). */
const AB_TEST_SPLIT_RATIO = 0.5;

const SYSTEM_PROMPT =
  'You are an expert coding assistant. Help users write, debug, and improve code. Be concise and provide working code examples.';

/** Prepend the system prompt if none is already present. */
export function withSystemPrompt(messages: ChatMessage[]): ChatMessage[] {
  if (messages.find(m => m.role === 'system')) return messages;
  return [{ role: 'system', content: SYSTEM_PROMPT }, ...messages];
}

// ---------------------------------------------------------------------------
// Cloudflare Workers AI
// ---------------------------------------------------------------------------

/**
 * Calls Cloudflare Workers AI (Llama 3.1 8B) and returns a streaming Response.
 * The SSE body is forwarded directly from the Workers AI binding.
 */
export async function streamCloudflareAI(messages: ChatMessage[], ai: Ai): Promise<Response> {
  const response = await ai.run('@cf/meta/llama-3.1-8b-instruct' as keyof AiModels, {
    messages,
    stream: true,
  });

  if (response instanceof ReadableStream) {
    return new Response(response, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Transfer-Encoding': 'chunked',
      },
    });
  }

  // Non-streaming fallback
  const result = response as { response?: string };
  const body = `data: ${JSON.stringify({ response: result.response ?? '' })}\n\ndata: [DONE]\n\n`;
  return new Response(body, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  });
}

// ---------------------------------------------------------------------------
// OpenRouter (free-model pool with round-robin + 429 failover)
// ---------------------------------------------------------------------------

/**
 * Calls OpenRouter using free models in round-robin order.
 * If a model returns 429 (rate limited) or any other error, the next model is
 * tried automatically until either a successful response is obtained or all
 * models have been exhausted.
 */
export async function streamOpenRouter(messages: ChatMessage[], apiKey: string): Promise<Response> {
  const startIndex = getNextModelIndex();

  for (let attempt = 0; attempt < FREE_MODELS.length; attempt++) {
    const model = FREE_MODELS[(startIndex + attempt) % FREE_MODELS.length];

    const response = await fetch(OPENROUTER_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://builderforce.ai',
        'X-Title': 'Builderforce.ai',
      },
      body: JSON.stringify({ model, messages, stream: true }),
    });

    if (response.status === 429) {
      console.warn(`OpenRouter model ${model} is rate limited, trying next model`);
      continue;
    }

    if (!response.ok || !response.body) {
      console.error(`OpenRouter model ${model} returned ${response.status}, trying next model`);
      continue;
    }

    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Transfer-Encoding': 'chunked',
      },
    });
  }

  return new Response(
    JSON.stringify({ error: 'All OpenRouter models are rate limited or unavailable. Please try again later.' }),
    { status: 503, headers: { 'Content-Type': 'application/json' } },
  );
}

// ---------------------------------------------------------------------------
// Unified entry point
// ---------------------------------------------------------------------------

/**
 * Selects an AI provider based on the AI_PROVIDER environment variable and
 * available credentials, then returns a streaming Response.
 *
 * Provider selection rules:
 *   "cloudflare" (default) — uses Cloudflare Workers AI binding (env.AI)
 *   "openrouter"           — uses OpenRouter free-model pool (env.OPENROUTER_API_KEY)
 *   "ab"                   — randomly routes each request to one of the two
 *                            providers (50 / 50) for A/B validation
 */
export async function streamAIResponse(messages: ChatMessage[], env: AIEnv): Promise<Response> {
  const allMessages = withSystemPrompt(messages);
  const provider: AIProvider = env.AI_PROVIDER ?? 'cloudflare';

  if (provider === 'ab') {
    const canUseOpenRouter = !!env.OPENROUTER_API_KEY;
    const canUseCloudflare = !!env.AI;

    if (canUseOpenRouter && canUseCloudflare) {
      // 50 / 50 random split for A/B validation
      return Math.random() < AB_TEST_SPLIT_RATIO
        ? streamOpenRouter(allMessages, env.OPENROUTER_API_KEY!)
        : streamCloudflareAI(allMessages, env.AI!);
    }

    // Fall back to whichever provider is actually configured
    if (canUseOpenRouter) return streamOpenRouter(allMessages, env.OPENROUTER_API_KEY!);
    if (canUseCloudflare) return streamCloudflareAI(allMessages, env.AI!);
  }

  if (provider === 'openrouter') {
    if (!env.OPENROUTER_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'OPENROUTER_API_KEY is not configured.' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return streamOpenRouter(allMessages, env.OPENROUTER_API_KEY);
  }

  // Default: "cloudflare"
  if (!env.AI) {
    return new Response(
      JSON.stringify({ error: 'Cloudflare AI binding (AI) is not configured.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }
  return streamCloudflareAI(allMessages, env.AI);
}
