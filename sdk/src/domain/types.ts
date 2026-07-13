export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * One model attempt that failed before the resolved model succeeded.
 * Surfaced on successful responses in `_builderforce.failovers` (when retries
 * happened) and on cascade-exhausted errors in `error.details.failovers`.
 *
 * `vendor` lets callers detect when every failure concentrated on one
 * upstream — e.g. all `openrouter` means a saturated shared key, not a
 * model-specific issue.
 */
/**
 * Coarse failure class for one failover attempt. Branch on this instead of
 * regex-sniffing the error message. `'schema'` means the upstream rejected the
 * `response_format.json_schema` as too complex for its constrained-decoding
 * engine (see `FailoverEvent.reason === 'schema_too_complex'`); `'content_filter'`
 * means a safety system blocked the generation. Open string union for
 * forward-compat — a newer gateway may add classes an older SDK doesn't list.
 */
export type FailoverKind =
  | 'rate_limit'
  | 'timeout'
  | 'auth'
  | 'server_error'
  | 'client_error'
  | 'schema'
  | 'content_filter'
  | 'network'
  | 'skipped'
  | (string & {});

export interface FailoverEvent {
  model: string;
  /** `'openrouter' | 'cerebras' | 'nvidia' | 'ollama' | 'googleai' | …` */
  vendor: string;
  /** Gateway-normalized status, or 0 for embedded errors / network failures.
   *  For a schema rejection this is `422` (the request-error class); the REAL
   *  upstream status is in `upstreamStatus`. */
  code: number;
  /** Wall-clock time the gateway spent on this attempt, ms. Present on newer
   *  gateway versions; absent on older ones. */
  durationMs?: number;
  /** Coarse failure class — see {@link FailoverKind}. The full upstream error
   *  text is NOT exposed to callers; quote `traceId` to support for that. */
  kind?: FailoverKind;
  /** Stable machine-readable cause slug when one applies — e.g.
   *  `'schema_too_complex'`. Branch on this for structured handling instead of
   *  parsing `message`. Absent for unclassified failures. */
  reason?: string;
  /** The REAL upstream HTTP status before the gateway normalized it into `code`
   *  — e.g. a Gemini schema 400 surfaces as `code: 422` with `upstreamStatus: 400`.
   *  Absent when `code` already IS the upstream status. */
  upstreamStatus?: number;
}

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
   * Model **hint** (not a hard pin by default). The gateway puts this id at
   * the head of its candidate chain so it's tried first, but it retains the
   * right to substitute on cooldown / outage / plan-tier mismatch. Read
   * `_builderforce.resolvedModel` to detect substitution.
   *
   * Vendor prefixes (`openrouter/<id>`, `cerebras/<id>`, `ollama/<id>`) route
   * to the named vendor when that model is selected. Bare ids fall back to
   * catalog lookup.
   *
   * When unset, the gateway picks from the tenant-plan model pool with
   * shape-based reordering (tools / response_format / vision content blocks).
   *
   * For *strict* pinning, see `modelStrict`.
   */
  model?: string;
  /**
   * When `true` and `model` is set, the gateway runs on `model` exactly —
   * no substitution. If the model is on cooldown / unconfigured / unavailable,
   * the gateway returns `503 model_unavailable` instead of falling through to
   * another model. Use for reproducible eval / A-B-test runs.
   *
   * **Entitlement:** strict-pin requires a paid plan (Pro / Teams) OR a
   * superadmin-issued daily-limit override. Free-tier requests with
   * `modelStrict: true` get `403 strict_pin_not_allowed` so a single
   * misbehaving model can't drain a free tenant's daily budget.
   */
  modelStrict?: boolean;
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
   * Telemetry slug — persisted to `llm_usage_log.use_case` and echoed back in
   * `_builderforce.useCase`. The taxonomy is yours, BUT a few well-known patterns
   * also *influence routing* (the gateway substring-matches them):
   *   - `…ocr…` → prefers OCR/vision-capable models.
   *   - quality-critical work (`resume`, `cover_letter`, `tailor`, `proposal`,
   *     `cv`, …) → leads with the best models your PLAN unlocks (premium writers
   *     on paid plans). Failover + the funded reliability backstop still apply.
   * Slugs that don't match any pattern are pure telemetry. Routing is always
   * gateway-owned; this only nudges model selection.
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
    /**
     * Gateway trace id (`llm-…`) for this call. Quote it to Builderforce
     * support to pull up full server-side diagnostics (who called, every model
     * attempt, every exception, request/response bodies). On the error path the
     * same value is surfaced as `error.details.correlationId`. Only the id
     * crosses the wire — the full detail stays builder-side.
     */
    traceId?: string;
    /** The model the gateway dispatched against. Equals `request.model` when caller pinned. */
    resolvedModel?: string;
    /**
     * Vendor that owns the resolved model (`'openrouter' | 'cerebras' | 'nvidia'
     * | 'ollama' | 'googleai' | …`). Sourced from the gateway's catalog so
     * consumers doing per-vendor cost / latency aggregation get a single field
     * to group by without parsing model-id prefixes.
     */
    resolvedVendor?: string;
    /** How many vendor retries happened inside the failover chain. */
    retries?: number;
    /**
     * Per-attempt breakdown of the cascade — present only when `retries > 0`.
     * Each entry is one model the gateway tried that failed before the
     * resolved model succeeded. Use `vendor` to detect single-vendor
     * concentration (e.g. all failures on `openrouter` = saturated key).
     */
    failovers?: FailoverEvent[];
    pool?: number;
    product?: string;
    effectivePlan?: string;
    /** Number of vendor retries the gateway performed for json_schema conformance. */
    schemaRetries?: number;
    /**
     * `true` when the gateway AUTO-DOWNGRADED a too-complex `response_format.json_schema`
     * to loose `json_object` and re-ran the cascade so you still got a structured
     * result instead of a terminal `schema_too_complex` error. The strict-schema
     * guarantee was relaxed — **validate the returned JSON yourself** (it parses,
     * but wasn't constrained-decoded against your schema). Pre-empt the round-trip
     * with `deriveResponseFormat` when you know the schema is large.
     */
    schemaDowngraded?: boolean;
    /** Echo of `request.useCase` (opaque telemetry slug). */
    useCase?: string;
    /** Echo of `request.metadata` for caller-side billing trace-back. */
    metadata?: Record<string, string>;
    /** Mirror of the `x-request-id` response header. */
    requestId?: string;
    /**
     * Daily token budget snapshot at request time. Use `remaining` to
     * pre-emptively throttle before the gateway returns 429
     * `plan_token_limit_exceeded`. Same numbers are exposed via the
     * `x-builderforce-daily-tokens-{used,limit,remaining}` response headers.
     */
    dailyTokens?: {
      used:      number;
      limit:     number;
      remaining: number;
    };
  };
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Models
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shape capability a model supports — what kinds of request it can serve.
 *   `vision` — accepts image content blocks (`image_url`); reads images and
 *              page-rasterized PDFs.
 *   `ocr`    — tuned for text extraction from images / documents.
 *   `tools`  — honours `tools` / `tool_choice` round-trips.
 *   `structured_output` — reliably emits valid JSON / honours `json_schema`.
 *
 * Consumers that need to read images or PDFs (e.g. hired.video) should pick a
 * model whose `capabilities` include `vision` or `ocr`. See
 * `models.listImageCapable()` / `models.listOcr()`.
 */
export type AiCapability = 'tools' | 'structured_output' | 'vision' | 'ocr';

/** One model in the tenant-plan pool, with availability + capability metadata. */
export interface ModelInfo {
  model: string;
  vendor: string;
  /** In the top "preferred" sub-pool the gateway round-robins across first. */
  preferred: boolean;
  /** Servable right now — key bound and not on per-model / per-vendor cooldown. */
  available: boolean;
  /** Epoch ms when the per-model cooldown lifts. Absent when not cooling. */
  cooldownUntil?: number;
  /** Epoch ms when the per-vendor cooldown lifts. Set when an upstream is wholesale-cooled. */
  vendorCooledUntil?: number;
  /** Whether the vendor's API key is bound. False → model is unservable. */
  keyBound?: boolean;
  /** Shape capabilities this model supports — drives image/PDF (`vision`/`ocr`),
   *  tool-calling (`tools`), and structured-output (`structured_output`) routing.
   *  Absent on older gateways that don't yet emit it. */
  capabilities?: AiCapability[];
}

export interface ModelsListResponse {
  configured?: boolean;
  object?: 'list';
  product?: string;
  effectivePlan?: string;
  /** Per-model pool status (present on the `configured: true` branch). */
  data?: ModelInfo[];
  /** Bare model-id pool (present on the `configured: false` branch). */
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

// ─────────────────────────────────────────────────────────────────────────────
// Image generation (`POST /v1/images/generations`) — OpenAI-compatible shape.
// Cascades free Together vendors → premium FluxAPI fallback so callers always
// see a successful response unless every upstream is saturated.
// ─────────────────────────────────────────────────────────────────────────────

export interface ImageGenerationCreateParams extends PerCallOptions {
  /**
   * Model hint — gateway-owned routing. Bare ids resolve via catalog lookup;
   * vendor-prefixed ids (`together/<id>`, `fluxapi/flux-kontext-pro`) pin to a
   * specific vendor. When unset, the gateway picks from the tenant-plan image
   * pool starting with the free tier.
   */
  model?: string;
  /** Required text prompt. */
  prompt: string;
  /** OpenAI-compatible size string: "1024x1024", "1792x1024", "1024x1792", etc.
   *  Mapped to each vendor's native dimension format (FluxAPI receives an
   *  `aspectRatio`; Together receives `width`/`height`). */
  size?: string;
  /** Number of images to generate (default 1). Vendors that don't support
   *  batching silently clamp to 1 — read `data.length` to confirm. */
  n?: number;
  /** "url" (default) returns hosted URLs; "b64_json" returns base64-encoded image bytes. */
  response_format?: 'url' | 'b64_json';
  /** Opaque telemetry slug — same semantics as chat. Persisted to `llm_usage_log.use_case`. */
  useCase?: string;
  /** Free-form attribution metadata — same semantics as chat. */
  metadata?: Record<string, string>;
  [key: string]: unknown;
}

export interface ImageGenerationDataEntry {
  url?: string;
  b64_json?: string;
  /** Vendor-side prompt revision (some vendors auto-rewrite for safety / quality). */
  revised_prompt?: string;
}

export interface ImageGenerationResponse {
  /** ISO seconds timestamp — OpenAI-compatible. */
  created: number;
  /** One entry per generated image. */
  data: ImageGenerationDataEntry[];
  /** The model that actually served the request (same as `_builderforce.resolvedModel`). */
  model?: string;
  _builderforce?: {
    /** Gateway trace id (`llm-…`) — quote to support for full server-side
     *  diagnostics. Mirrors `error.details.correlationId` on the failure path. */
    traceId?: string;
    /** The model the gateway dispatched against. */
    resolvedModel?: string;
    /** Vendor that owns the resolved model — `'together' | 'fluxapi'`. */
    resolvedVendor?: string;
    /** How many vendor retries happened before the resolved vendor succeeded. */
    retries?: number;
    /** Per-attempt breakdown, present only when `retries > 0`. */
    failovers?: FailoverEvent[];
    product?: string;
    effectivePlan?: string;
    /** True when superadmin premium-override is active for this tenant. */
    premium?: boolean;
    /** Echo of `request.useCase`. */
    useCase?: string;
    /** Echo of `request.metadata`. */
    metadata?: Record<string, string>;
    /** Mirror of the `x-request-id` response header. */
    requestId?: string;
  };
  [key: string]: unknown;
}
