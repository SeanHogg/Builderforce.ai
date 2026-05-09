export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

// ─────────────────────────────────────────────────────────────────────────────
// Vision content blocks (OpenAI-compatible). A user/system message's `content`
// can be a plain string OR a sequence of typed parts (text + image_url).
// ─────────────────────────────────────────────────────────────────────────────

export interface TextContentPart {
  type: 'text';
  text: string;
}

export interface ImageUrlContentPart {
  type: 'image_url';
  image_url: {
    /** Either an `https://...` URL or a `data:image/...;base64,...` data URI. */
    url: string;
    /** Image detail hint — `'low' | 'high' | 'auto'`. Vendor-specific behaviour. */
    detail?: 'low' | 'high' | 'auto';
  };
}

export type ContentPart = TextContentPart | ImageUrlContentPart;

// ─────────────────────────────────────────────────────────────────────────────
// Tool / function calling (OpenAI-compatible).
// ─────────────────────────────────────────────────────────────────────────────

export interface FunctionDefinition {
  name: string;
  description?: string;
  /** JSON-Schema describing the function's argument shape. */
  parameters?: Record<string, unknown>;
}

export interface ToolSpec {
  type: 'function';
  function: FunctionDefinition;
}

export interface ToolCallFunction {
  name: string;
  /** JSON-encoded argument string. Caller is responsible for `JSON.parse`. */
  arguments: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: ToolCallFunction;
}

export type ToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'function'; function: { name: string } };

/** Streaming-mode tool-call delta. Each chunk carries an `index` so callers
 *  can stitch fragments together by call slot. */
export interface ToolCallDelta {
  index: number;
  id?: string;
  type?: 'function';
  function?: {
    name?: string;
    /** Partial JSON-encoded arguments — concatenate across deltas to reassemble. */
    arguments?: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Response format — typed JSON / structured-output mode.
// ─────────────────────────────────────────────────────────────────────────────

export interface JsonSchemaSpec {
  name: string;
  description?: string;
  /** JSON-Schema document. Use `strict: true` for vendor-side conformance retry. */
  schema: Record<string, unknown>;
  strict?: boolean;
}

export type ResponseFormat =
  | { type: 'text' }
  | { type: 'json_object' }
  | { type: 'json_schema'; json_schema: JsonSchemaSpec };

// ─────────────────────────────────────────────────────────────────────────────
// Chat messages
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: ChatRole;
  /** String for plain text. `ContentPart[]` for vision (text + image_url). `null`
   *  is allowed on assistant turns that only carry `tool_calls`. */
  content: string | ContentPart[] | null;
  name?: string;
  /** Assistant-turn tool calls. Caller executes each and replies with a `tool` message
   *  whose `tool_call_id` matches `tool_calls[i].id`. */
  tool_calls?: ToolCall[];
  /** Required on `role: 'tool'` messages — the id of the assistant tool call this
   *  message is responding to. */
  tool_call_id?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-call request options (timeout / abort / idempotency / metadata)
// ─────────────────────────────────────────────────────────────────────────────

export interface PerCallOptions {
  /** Override the client-level timeout for just this call. Useful when use
   *  cases have a wide latency spread (autofill ~2s vs `career_360` ~30s). */
  timeoutMs?: number;
  /** Caller-supplied AbortSignal for user-cancellable generation. Fires alongside
   *  the SDK's internal timeout signal — whichever fires first wins. */
  signal?: AbortSignal;
  /** Sent as `Idempotency-Key` header — gateway dedupes retries within its TTL. */
  idempotencyKey?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat completions
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatCompletionCreateParams extends PerCallOptions {
  /**
   * Model id. When set, the gateway forwards verbatim — no substitution, no
   * "best available" routing, no silent failover. On vendor error, the upstream
   * status + body surfaces as a `BuilderforceApiError` so the caller can decide
   * whether to advance their own fallback chain.
   *
   * Vendor prefixes (`openrouter/<id>`, `cerebras/<id>`, `ollama/<id>`) route
   * to that vendor explicitly. Bare ids fall back to catalog lookup.
   *
   * When unset, the gateway picks from the tenant-plan model pool with
   * shape-based reordering (tools / response_format / vision content blocks).
   */
  model?: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  /** Tool / function-calling spec. */
  tools?: ToolSpec[];
  tool_choice?: ToolChoice;
  /** Structured-output mode. `'json_object'` is loose JSON; `'json_schema'` requests
   *  gateway-side schema validation with retry across the failover chain. */
  response_format?: ResponseFormat;
  /**
   * Opaque telemetry slug. The gateway treats this as a free-form string —
   * persisted to `llm_usage_log.use_case` and echoed back in `_builderforce.useCase`
   * for confirmation, but **never used for routing**. The taxonomy is yours.
   */
  useCase?: string;
  /** Free-form key/value pairs persisted to `llm_usage_log.metadata` for billing
   *  trace-back ({ toolRunId, sessionId, userId, featureKey, … }). Echoed back
   *  in `_builderforce.metadata`. Not forwarded to vendors. */
  metadata?: Record<string, string>;
  [key: string]: unknown;
}

export interface ChatCompletionChunk {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: Array<{
    index?: number;
    delta?: {
      role?: ChatRole;
      content?: string | null;
      tool_calls?: ToolCallDelta[];
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface ChatCompletionResponse {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: Array<{
    index?: number;
    message?: {
      role?: ChatRole;
      content?: string | null;
      tool_calls?: ToolCall[];
    };
    /** `'stop' | 'length' | 'tool_calls' | 'content_filter' | …` */
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  _builderforce?: {
    /** The model the gateway dispatched against. Equals `request.model` when caller pinned. */
    resolvedModel?: string;
    /** How many vendor retries happened inside the failover chain. */
    retries?: number;
    pool?: number;
    product?: string;
    effectivePlan?: string;
    /** Number of vendor retries the gateway performed for json_schema conformance. */
    schemaRetries?: number;
    /** Echo of `request.useCase` (opaque telemetry slug). */
    useCase?: string;
    /** Echo of `request.metadata` for caller-side billing trace-back. */
    metadata?: Record<string, string>;
    /** Mirror of the `x-request-id` response header. */
    requestId?: string;
  };
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Models
// ─────────────────────────────────────────────────────────────────────────────

export interface ModelsListResponse {
  configured?: boolean;
  object?: 'list';
  product?: string;
  effectivePlan?: string;
  data?: Array<{
    model: string;
    vendor: string;
    preferred: boolean;
    available: boolean;
    cooldownUntil?: number;
  }>;
  models?: string[];
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Usage analytics
// ─────────────────────────────────────────────────────────────────────────────

export interface UsageByModel {
  llmProduct: string;
  model: string;
  requests: number;
  prompt_tokens: string | number;
  completion_tokens: string | number;
  total_tokens: string | number;
  retries: number;
}

export interface UsageByDay {
  day: string;
  requests: number;
  total_tokens: string | number;
}

export interface UsageByUser {
  user_id: string;
  requests: number;
  total_tokens: string | number;
}

export interface UsageResponse {
  days: number;
  tenantId: number;
  plan: string;
  effectivePlan: string;
  billingStatus: string;
  totals: {
    requests: number;
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
  };
  mine: {
    userId: string | null;
    requests: number;
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
  };
  byModel: UsageByModel[];
  byDay: UsageByDay[];
  byUser: UsageByUser[];
}

export interface UsageGetParams {
  days?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Embeddings
// ─────────────────────────────────────────────────────────────────────────────

export interface EmbeddingsCreateParams extends PerCallOptions {
  model?: string;
  /** Single string or array of strings to embed. */
  input: string | string[];
  /** Opaque telemetry slug — same semantics as chat. */
  useCase?: string;
  /** Free-form attribution metadata (same semantics as chat). */
  metadata?: Record<string, string>;
  [key: string]: unknown;
}

export interface EmbeddingObject {
  object: 'embedding';
  index: number;
  embedding: number[];
}

export interface EmbeddingsResponse {
  object: 'list';
  data: EmbeddingObject[];
  model: string;
  usage?: {
    prompt_tokens?: number;
    total_tokens?: number;
  };
  _builderforce?: {
    resolvedModel?: string;
    retries?: number;
    product?: string;
  };
  [key: string]: unknown;
}
