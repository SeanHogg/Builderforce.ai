type ChatRole = 'system' | 'user' | 'assistant' | 'tool';
/**
 * One model attempt that failed before the resolved model succeeded.
 * Surfaced on successful responses in `_builderforce.failovers` (when retries
 * happened) and on cascade-exhausted errors in `error.details.failovers`.
 *
 * `vendor` lets callers detect when every failure concentrated on one
 * upstream — e.g. all `openrouter` means a saturated shared key, not a
 * model-specific issue.
 */
interface FailoverEvent {
    model: string;
    /** `'openrouter' | 'cerebras' | 'nvidia' | 'ollama'` */
    vendor: string;
    /** HTTP status code, or 0 for embedded errors / network failures. */
    code: number;
    /** Wall-clock time the gateway spent on this attempt, ms. Present on newer
     *  gateway versions; absent on older ones. */
    durationMs?: number;
    /** Coarse failure class — `'rate_limit' | 'timeout' | 'auth' | 'server_error'
     *  | 'client_error' | 'network' | 'skipped'`. The full upstream error text is
     *  NOT exposed to callers; quote `traceId` to support for that. */
    kind?: string;
}
interface TextContentPart {
    type: 'text';
    text: string;
}
interface ImageUrlContentPart {
    type: 'image_url';
    image_url: {
        /** Either an `https://...` URL or a `data:image/...;base64,...` data URI. */
        url: string;
        /** Image detail hint — `'low' | 'high' | 'auto'`. Vendor-specific behaviour. */
        detail?: 'low' | 'high' | 'auto';
    };
}
type ContentPart = TextContentPart | ImageUrlContentPart;
interface FunctionDefinition {
    name: string;
    description?: string;
    /** JSON-Schema describing the function's argument shape. */
    parameters?: Record<string, unknown>;
}
interface ToolSpec {
    type: 'function';
    function: FunctionDefinition;
}
interface ToolCallFunction {
    name: string;
    /** JSON-encoded argument string. Caller is responsible for `JSON.parse`. */
    arguments: string;
}
interface ToolCall {
    id: string;
    type: 'function';
    function: ToolCallFunction;
}
type ToolChoice = 'auto' | 'none' | 'required' | {
    type: 'function';
    function: {
        name: string;
    };
};
/** Streaming-mode tool-call delta. Each chunk carries an `index` so callers
 *  can stitch fragments together by call slot. */
interface ToolCallDelta {
    index: number;
    id?: string;
    type?: 'function';
    function?: {
        name?: string;
        /** Partial JSON-encoded arguments — concatenate across deltas to reassemble. */
        arguments?: string;
    };
}
interface JsonSchemaSpec {
    name: string;
    description?: string;
    /** JSON-Schema document. Use `strict: true` for vendor-side conformance retry. */
    schema: Record<string, unknown>;
    strict?: boolean;
}
type ResponseFormat = {
    type: 'text';
} | {
    type: 'json_object';
} | {
    type: 'json_schema';
    json_schema: JsonSchemaSpec;
};
interface ChatMessage {
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
interface PerCallOptions {
    /** Override the client-level timeout for just this call. Useful when use
     *  cases have a wide latency spread (autofill ~2s vs `career_360` ~30s). */
    timeoutMs?: number;
    /** Caller-supplied AbortSignal for user-cancellable generation. Fires alongside
     *  the SDK's internal timeout signal — whichever fires first wins. */
    signal?: AbortSignal;
    /** Sent as `Idempotency-Key` header — gateway dedupes retries within its TTL. */
    idempotencyKey?: string;
}
interface ChatCompletionCreateParams extends PerCallOptions {
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
interface ChatCompletionChunk {
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
interface ChatCompletionResponse {
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
            used: number;
            limit: number;
            remaining: number;
        };
    };
    [key: string]: unknown;
}
interface ModelsListResponse {
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
interface UsageByModel {
    llmProduct: string;
    model: string;
    requests: number;
    prompt_tokens: string | number;
    completion_tokens: string | number;
    total_tokens: string | number;
    retries: number;
}
interface UsageByDay {
    day: string;
    requests: number;
    total_tokens: string | number;
}
interface UsageByUser {
    user_id: string;
    requests: number;
    total_tokens: string | number;
}
interface UsageResponse {
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
interface UsageGetParams {
    days?: number;
}
interface EmbeddingsCreateParams extends PerCallOptions {
    model?: string;
    /** Single string or array of strings to embed. */
    input: string | string[];
    /** Opaque telemetry slug — same semantics as chat. */
    useCase?: string;
    /** Free-form attribution metadata (same semantics as chat). */
    metadata?: Record<string, string>;
    [key: string]: unknown;
}
interface EmbeddingObject {
    object: 'embedding';
    index: number;
    embedding: number[];
}
interface EmbeddingsResponse {
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
interface ImageGenerationCreateParams extends PerCallOptions {
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
interface ImageGenerationDataEntry {
    url?: string;
    b64_json?: string;
    /** Vendor-side prompt revision (some vendors auto-rewrite for safety / quality). */
    revised_prompt?: string;
}
interface ImageGenerationResponse {
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

declare class BuilderforceApiError extends Error {
    readonly status: number;
    readonly code?: string;
    readonly details?: unknown;
    readonly requestId?: string;
    /**
     * `true` when the gateway has signalled this error will not resolve by
     * retrying on a different model — e.g. plan or per-claw daily token cap
     * exhausted (those caps are per-tenant, not per-model). Consumer-side
     * fallback chains should short-circuit when this is set.
     */
    readonly terminal?: boolean;
    /** Seconds the consumer should wait before retrying — server-supplied. */
    readonly retryAfter?: number;
    /**
     * Cascade attempts that failed before this error was returned — populated
     * when the gateway returns `429 cascade_exhausted` with a `details.failovers`
     * array. Each entry includes the vendor that owns the model so callers can
     * detect single-vendor saturation (e.g. all attempts on `openrouter`).
     */
    readonly failovers?: FailoverEvent[];
    /**
     * Upstream vendor the gateway dispatched against (`'openrouter' | 'cerebras'
     * | 'nvidia' | 'ollama' | 'googleai' | …`). Set on every error where the
     * gateway selected an upstream — including single-attempt failures that
     * never ran a cascade (timeouts, single-vendor 429s, `model_unavailable`).
     *
     * Unset only for pre-dispatch errors where no vendor was ever selected:
     * `401`/`403` auth failures, `400` validation failures, `409` idempotent
     * replay, and tenant-cap 429s (`plan_token_limit_exceeded`,
     * `claw_token_limit_exceeded`) — those caps are per-tenant, not per-model.
     *
     * Sourced from the gateway's catalog lookup so consumers never have to
     * parse the model id to recover vendor identity.
     */
    readonly vendor?: string;
    /**
     * Model id the gateway dispatched against — set whenever `vendor` is set.
     * Pair with `vendor` for per-attempt observability without prefix parsing.
     */
    readonly model?: string;
    constructor(message: string, status: number, code?: string, details?: unknown, requestId?: string, extras?: {
        terminal?: boolean;
        retryAfter?: number;
        vendor?: string;
        model?: string;
    });
}
interface HttpClientOptions {
    apiKey: string;
    baseUrl: string;
    fetchFn?: typeof fetch;
    /** Default per-request timeout in ms. Overridable per call. */
    timeoutMs?: number;
}
/** Per-request overrides — passed by the API layer, not by SDK consumers directly. */
interface RequestOptions {
    /** Override the client default timeout for just this request. */
    timeoutMs?: number;
    /** Caller-provided AbortSignal. Linked together with the SDK's internal timeout
     *  signal — whichever fires first aborts the request. */
    signal?: AbortSignal;
    /** Extra headers to merge in (e.g. `Idempotency-Key`). */
    headers?: Record<string, string>;
}
declare class HttpClient {
    private readonly apiKey;
    private readonly baseUrl;
    private readonly fetchFn;
    private readonly defaultTimeoutMs;
    constructor(options: HttpClientOptions);
    getJson<T>(path: string, options?: RequestOptions): Promise<T>;
    postJson<T>(path: string, body: unknown, options?: RequestOptions): Promise<T>;
    postRaw(path: string, body: unknown, options?: RequestOptions): Promise<Response>;
    private mergeHeaders;
    /**
     * Wrap a fetch in a combined abort signal: an internal timeout AND any
     * caller-provided signal. Either firing aborts the request. Single source of
     * abort plumbing — every method routes through here (DRY).
     */
    private fetchWithTimeout;
    private parseJsonResponse;
    private toApiError;
}

declare class ChatCompletionStream implements AsyncIterable<ChatCompletionChunk> {
    private readonly stream;
    constructor(stream: ReadableStream<Uint8Array>);
    [Symbol.asyncIterator](): AsyncIterator<ChatCompletionChunk, void, unknown>;
    toText(): Promise<string>;
}
declare class ChatCompletionsApi {
    private readonly http;
    constructor(http: HttpClient);
    create(params: ChatCompletionCreateParams & {
        stream: true;
    }): Promise<ChatCompletionStream>;
    create(params: ChatCompletionCreateParams & {
        stream?: false | undefined;
    }): Promise<ChatCompletionResponse>;
}

declare class EmbeddingsApi {
    private readonly http;
    constructor(http: HttpClient);
    /**
     * Create one or more text embeddings. Wired to OpenRouter (default model
     * `nvidia/llama-nemotron-embed-vl-1b-v2:free`). Override via `model`.
     */
    create(params: EmbeddingsCreateParams): Promise<EmbeddingsResponse>;
}

/**
 * `client.images.generate({ prompt, ... })` — OpenAI-compatible image generation
 * routed through the Builderforce gateway. The gateway cascades free Together
 * vendors → premium FluxAPI fallback so callers always see a successful
 * response unless every upstream is saturated. Read
 * `_builderforce.resolvedModel` / `resolvedVendor` to detect which vendor
 * served the request.
 *
 * Image generations are billed against the tenant's daily token budget at a
 * flat per-image rate (currently ~1000 tokens/image — deliberately conservative).
 * Hitting the cap returns the same `429 plan_token_limit_exceeded` envelope
 * as chat — caller code that already handles that path needs no changes.
 */
declare class ImagesApi {
    private readonly http;
    constructor(http: HttpClient);
    generate(params: ImageGenerationCreateParams): Promise<ImageGenerationResponse>;
}

declare class ModelsApi {
    private readonly http;
    constructor(http: HttpClient);
    list(): Promise<ModelsListResponse>;
}

declare class UsageApi {
    private readonly http;
    constructor(http: HttpClient);
    get(params?: UsageGetParams): Promise<UsageResponse>;
}

interface BuilderforceClientOptions {
    apiKey: string;
    baseUrl?: string;
    fetch?: typeof fetch;
    /** Default request timeout in ms (default 60_000). Per-call override available
     *  via `chat.completions.create({ timeoutMs })` and `embeddings.create({ timeoutMs })`. */
    timeoutMs?: number;
}
declare class BuilderforceClient {
    readonly chat: {
        completions: ChatCompletionsApi;
    };
    readonly embeddings: EmbeddingsApi;
    readonly images: ImagesApi;
    readonly models: ModelsApi;
    readonly usage: UsageApi;
    constructor(options: BuilderforceClientOptions);
}

export { BuilderforceApiError, BuilderforceClient, type BuilderforceClientOptions, type ChatCompletionChunk, type ChatCompletionCreateParams, type ChatCompletionResponse, ChatCompletionStream, type ChatMessage, type ChatRole, type ContentPart, type EmbeddingObject, EmbeddingsApi, type EmbeddingsCreateParams, type EmbeddingsResponse, type FailoverEvent, type FunctionDefinition, type ImageGenerationCreateParams, type ImageGenerationDataEntry, type ImageGenerationResponse, type ImageUrlContentPart, ImagesApi, type JsonSchemaSpec, type ModelsListResponse, type PerCallOptions, type ResponseFormat, type TextContentPart, type ToolCall, type ToolCallDelta, type ToolCallFunction, type ToolChoice, type ToolSpec, type UsageByDay, type UsageByModel, type UsageByUser, type UsageGetParams, type UsageResponse };
