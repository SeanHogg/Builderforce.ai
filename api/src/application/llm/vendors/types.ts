/**
 * Multi-vendor LLM gateway — type system, error classes, and shared transport.
 *
 * A `VendorModule` is the canonical extension point: each provider (OpenRouter,
 * Cerebras, Ollama, …) ships exactly one of these and the registry derives
 * everything else (catalog, tier classification, cross-vendor cascade).
 *
 * Adding a new vendor:
 *   1. Add the literal id to `VendorId`.
 *   2. Add a `<NAME>_API_KEY` field to `VendorEnv`.
 *   3. Implement a `VendorModule` and register it in `vendors/registry.ts`.
 */

export type VendorId = 'openrouter' | 'cerebras' | 'ollama';

/**
 * Tier classification per model — drives pricing, plan gating, and the
 * Free vs Pro model pool composition.
 *   FREE     — wrapped by the Free plan (free upstream models)
 *   STANDARD — paid, low-cost
 *   PREMIUM  — paid, mid-cost (e.g. Claude Sonnet, GPT-4o)
 *   ULTRA    — paid, high-cost (e.g. Claude Opus, GPT-o3)
 */
export type AiModelTier = 'FREE' | 'STANDARD' | 'PREMIUM' | 'ULTRA';

/**
 * Subset of bindings the vendor modules read. The proxy service is responsible
 * for picking the correct OpenRouter key for the active plan (Free vs Pro)
 * and synthesizing this env per call — vendors don't know about plans.
 */
export interface VendorEnv {
  OPENROUTER_API_KEY?: string | null;
  CEREBRAS_API_KEY?: string | null;
  OLLAMA_API_KEY?: string | null;
}

export interface VendorCallParams {
  apiKey: string;
  model: string;
  messages: Array<Record<string, unknown>>;
  tools?: unknown[];
  toolChoice?: unknown;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  /** Vendor-specific passthrough. Last write wins over the standard fields above. */
  extraBody?: Record<string, unknown>;
  /** Sent as `X-Title` header for OpenRouter analytics; ignored by other vendors. */
  title?: string;
}

export interface VendorUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface VendorCallResult {
  raw: unknown;
  content: string;
  usage?: VendorUsage;
}

export interface VendorStreamResult {
  /** OpenAI-compatible SSE Response. The body has been validated against
   *  first-chunk embedded errors before this resolves. */
  response: Response;
}

export interface VendorModelEntry {
  id: string;
  label: string;
  brand: string;
  tier: AiModelTier;
}

export interface VendorModule {
  id: VendorId;
  apiKeyFrom(env: VendorEnv): string | null;
  catalog: ReadonlyArray<VendorModelEntry>;
  tierFor(modelId: string): AiModelTier;
  /** Used as a last-resort entry in cross-vendor fallback chains. */
  fallbackModel: string;
  call(params: VendorCallParams): Promise<VendorCallResult>;
  /** Optional streaming variant. Vendors that omit this are skipped during streaming dispatch. */
  callStream?(params: VendorCallParams): Promise<VendorStreamResult>;
}

export type ResponseParser = (raw: unknown) => {
  content: string;
  usage?: VendorUsage;
};

// ---------------------------------------------------------------------------
// Default response parser (OpenAI chat-completions shape)
// ---------------------------------------------------------------------------

export const parseOpenAIResponse: ResponseParser = (raw) => {
  const r = raw as { choices?: Array<{ message?: { content?: unknown } }>; usage?: unknown };
  return {
    content: String(r?.choices?.[0]?.message?.content ?? ''),
    usage: pickUsage(r?.usage),
  };
};

// ---------------------------------------------------------------------------
// Token-usage normalization (handles both OpenAI prompt_tokens/completion_tokens
// and Anthropic-style input_tokens/output_tokens vendors emit)
// ---------------------------------------------------------------------------

export function pickUsage(u: unknown): VendorUsage {
  const out: VendorUsage = {};
  if (!u || typeof u !== 'object') return out;
  const usage = u as Record<string, unknown>;
  const prompt     = numOrUndef(usage['prompt_tokens']     ?? usage['input_tokens']);
  const completion = numOrUndef(usage['completion_tokens'] ?? usage['output_tokens']);
  const total      = numOrUndef(usage['total_tokens']);
  if (prompt     !== undefined) out.prompt_tokens     = prompt;
  if (completion !== undefined) out.completion_tokens = completion;
  if (total      !== undefined) out.total_tokens      = total;
  return out;
}

function numOrUndef(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// ---------------------------------------------------------------------------
// Errors — drive vendor cascade behavior
// ---------------------------------------------------------------------------

/**
 * Recoverable error: caller should try the next model/vendor in the chain.
 * Status semantics:
 *   0           — network / fetch threw (DNS, TLS, connection reset, etc.)
 *   401, 403    — auth issue (logged to console.error and cascaded — config bug, not "bad payload")
 *   404, 408    — model removed / request timeout
 *   429         — rate limit
 *   5xx         — provider outage
 *   200 + error — provider returned a 200 with `{error: ...}` in the body or first SSE chunk
 */
export class VendorRetryableError extends Error {
  public readonly vendorId: VendorId;
  public readonly status: number;
  public readonly model: string;
  constructor(vendorId: VendorId, model: string, status: number, message: string) {
    super(`[${vendorId}/${model}] ${status}: ${message}`);
    this.name = 'VendorRetryableError';
    this.vendorId = vendorId;
    this.status = status;
    this.model = model;
  }
}

/**
 * Non-recoverable error: bubbles up to the caller. Cascading won't help — the
 * payload itself is bad. Currently only HTTP 400.
 */
export class VendorFatalError extends Error {
  public readonly vendorId: VendorId;
  public readonly status: number;
  constructor(vendorId: VendorId, status: number, message: string) {
    super(`[${vendorId}] ${status}: ${message}`);
    this.name = 'VendorFatalError';
    this.vendorId = vendorId;
    this.status = status;
  }
}

/** Statuses that trigger cascade to the next model. */
export const CASCADE_STATUSES: ReadonlySet<number> = new Set<number>([
  404, 408, 429, 500, 502, 503, 504,
]);

const AUTH_STATUSES: ReadonlySet<number> = new Set<number>([401, 403]);

// ---------------------------------------------------------------------------
// Shared HTTP transport for non-streaming requests
// ---------------------------------------------------------------------------

export async function executeChatCompletion(args: {
  vendorId: VendorId;
  endpoint: string;
  apiKey: string;
  model: string;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
  title?: string;
  parseResponse?: ResponseParser;
}): Promise<VendorCallResult> {
  const { vendorId, endpoint, apiKey, model, body, headers, title } = args;
  const parseResponse = args.parseResponse ?? parseOpenAIResponse;

  let resp: Response;
  try {
    resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': title ?? 'Builderforce.ai',
        ...(headers ?? {}),
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new VendorRetryableError(vendorId, model, 0, `network: ${msg}`);
  }

  if (resp.ok) {
    const raw = await resp.json();
    // Some providers (notably OpenRouter) return 200 with { error: ... } embedded.
    if (raw && typeof raw === 'object' && 'error' in raw && (raw as Record<string, unknown>)['error'] != null) {
      const errObj = (raw as Record<string, unknown>)['error'];
      const msg = (errObj && typeof errObj === 'object' && 'message' in errObj
        ? String((errObj as Record<string, unknown>)['message'])
        : JSON.stringify(errObj)).slice(0, 240);
      throw new VendorRetryableError(vendorId, model, 0, `embedded: ${msg}`);
    }
    const parsed = parseResponse(raw);
    return { raw, content: parsed.content, ...(parsed.usage ? { usage: parsed.usage } : {}) };
  }

  const errText = (await resp.text()).slice(0, 400);

  if (CASCADE_STATUSES.has(resp.status)) {
    throw new VendorRetryableError(vendorId, model, resp.status, errText.slice(0, 240));
  }

  if (AUTH_STATUSES.has(resp.status)) {
    console.error(
      `[vendors] ${vendorId}/${model} auth ${resp.status} — check ${vendorId.toUpperCase()}_API_KEY. Failing over to next model.`,
      errText.slice(0, 200),
    );
    throw new VendorRetryableError(vendorId, model, resp.status, `auth ${resp.status}: ${errText.slice(0, 200)}`);
  }

  throw new VendorFatalError(vendorId, resp.status, errText);
}

// ---------------------------------------------------------------------------
// Shared HTTP transport for streaming (SSE) requests
//
// Validates the first SSE chunk for embedded { "error": ... } payloads, which
// some vendors (OpenRouter especially) emit as a 200-OK with an error in the
// first data line. If detected, both peeked + pass-through legs are cancelled
// and a VendorRetryableError is thrown so the orchestrator can cascade.
// ---------------------------------------------------------------------------

export async function executeChatCompletionStream(args: {
  vendorId: VendorId;
  endpoint: string;
  apiKey: string;
  model: string;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
  title?: string;
}): Promise<VendorStreamResult> {
  const { vendorId, endpoint, apiKey, model, body, headers, title } = args;

  let resp: Response;
  try {
    resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': title ?? 'Builderforce.ai',
        ...(headers ?? {}),
      },
      body: JSON.stringify({ ...body, stream: true }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new VendorRetryableError(vendorId, model, 0, `network: ${msg}`);
  }

  if (!resp.ok) {
    const errText = (await resp.text()).slice(0, 400);
    if (CASCADE_STATUSES.has(resp.status)) {
      throw new VendorRetryableError(vendorId, model, resp.status, errText.slice(0, 240));
    }
    if (AUTH_STATUSES.has(resp.status)) {
      console.error(
        `[vendors] ${vendorId}/${model} stream auth ${resp.status} — check ${vendorId.toUpperCase()}_API_KEY.`,
        errText.slice(0, 200),
      );
      throw new VendorRetryableError(vendorId, model, resp.status, `auth ${resp.status}`);
    }
    throw new VendorFatalError(vendorId, resp.status, errText);
  }

  if (!resp.body) {
    throw new VendorRetryableError(vendorId, model, 0, 'empty stream body');
  }

  // Tee — one leg to peek for embedded error, one to pass through to the caller.
  const [peek, pass] = resp.body.tee();
  const reader = peek.getReader();
  const { value: firstChunk } = await reader.read();
  reader.cancel().catch(() => { /* ignore */ });
  const firstText = firstChunk ? new TextDecoder().decode(firstChunk) : '';

  if (isChunkError(firstText)) {
    await pass.cancel().catch(() => { /* ignore */ });
    throw new VendorRetryableError(vendorId, model, 0, `embedded chunk error: ${firstText.slice(0, 200)}`);
  }

  return {
    response: new Response(pass, {
      status: resp.status,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Transfer-Encoding': 'chunked',
      },
    }),
  };
}

/** Detect a provider error embedded in the first SSE chunk. */
function isChunkError(text: string): boolean {
  if (!text.includes('"error"')) return false;
  const dataLine = text.split('\n').find((l) => l.startsWith('data: '));
  if (!dataLine) return true; // mentions "error" without parseable line — be safe
  try {
    const parsed = JSON.parse(dataLine.slice(6)) as Record<string, unknown>;
    return 'error' in parsed && parsed['error'] != null;
  } catch {
    return true; // unparseable but mentions "error" — treat as error
  }
}
