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
/**
 * Coarse failure class for one failover attempt. Branch on this instead of
 * regex-sniffing the error message. `'schema'` means the upstream rejected the
 * `response_format.json_schema` as too complex for its constrained-decoding
 * engine (see `FailoverEvent.reason === 'schema_too_complex'`); `'content_filter'`
 * means a safety system blocked the generation. Open string union for
 * forward-compat — a newer gateway may add classes an older SDK doesn't list.
 */
type FailoverKind = 'rate_limit' | 'timeout' | 'auth' | 'server_error' | 'client_error' | 'schema' | 'content_filter' | 'network' | 'skipped' | (string & {});
interface FailoverEvent {
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
            used: number;
            limit: number;
            remaining: number;
        };
    };
    [key: string]: unknown;
}
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
type AiCapability = 'tools' | 'structured_output' | 'vision' | 'ocr';
/** One model in the tenant-plan pool, with availability + capability metadata. */
interface ModelInfo {
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
interface ModelsListResponse {
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
    /** Raw `/llm/v1/models` response — pool status, capabilities, plan, cooldowns. */
    list(): Promise<ModelsListResponse>;
    /**
     * Models in the tenant's plan pool, as structured entries. Empty when the
     * gateway is unconfigured for this tenant (no `data` branch — nothing servable).
     */
    listInfo(): Promise<ModelInfo[]>;
    /**
     * Models whose `capabilities` include `capability`. By default only
     * currently-servable models are returned (`available: true`); pass
     * `{ includeUnavailable: true }` to include cooled / key-unbound ones too.
     */
    listByCapability(capability: AiCapability, opts?: {
        includeUnavailable?: boolean;
    }): Promise<ModelInfo[]>;
    /**
     * Models that can read images and (page-rasterized) PDFs — i.e. those with the
     * `vision` OR `ocr` capability. This is the set a consumer that needs to ingest
     * images / documents (e.g. hired.video) should pick from.
     */
    listImageCapable(opts?: {
        includeUnavailable?: boolean;
    }): Promise<ModelInfo[]>;
    /** Models tuned for text extraction from images / documents (`ocr` capability). */
    listOcr(opts?: {
        includeUnavailable?: boolean;
    }): Promise<ModelInfo[]>;
    /** Models that accept image content blocks (`vision` capability). */
    listVision(opts?: {
        includeUnavailable?: boolean;
    }): Promise<ModelInfo[]>;
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

/**
 * Coarse, stable error class for a failed gateway call — keyed off the gateway's
 * OWN failure taxonomy (`error.code` + `terminal` + the failover breakdown), NOT
 * raw HTTP-status guessing. Branch on this instead of reinventing a classifier
 * per consumer (which inevitably drifts).
 *
 *   rate_limit          — the gateway's whole cascade was rate-limited (429
 *                         `cascade_exhausted`). Retry later (`retryAfter`).
 *   token_cap           — a per-TENANT cap was hit (plan/monthly/host/claw token
 *                         or image-credit limit). TERMINAL for this billing
 *                         window — a different model won't help.
 *   schema_too_complex  — every candidate rejected the `response_format.json_schema`
 *                         as too complex for its constrained-decoding engine.
 *                         TERMINAL: simplify the schema or drop to `json_object`.
 *   invalid_request     — malformed payload (400/422) every model rejected. TERMINAL.
 *   auth                — bad/missing API key (401/403). TERMINAL.
 *   model_unavailable   — a strict-pinned model is on cooldown / unconfigured (503).
 *                         Not terminal: drop the pin or pick another model.
 *   timeout             — the request (or a single vendor attempt) timed out (408).
 *   service_unavailable — infrastructure ceiling (503 `worker_subrequest_exhausted`)
 *                         or transient upstream outage (5xx). Retry after a backoff.
 *   content_filter      — a safety system blocked the generation.
 *   network             — the request never reached the gateway (DNS/TLS/reset).
 *   aborted             — the caller's AbortSignal fired (499 / AbortError).
 *   unknown             — none of the above matched.
 */
type ErrorKind = 'rate_limit' | 'token_cap' | 'schema_too_complex' | 'invalid_request' | 'auth' | 'model_unavailable' | 'timeout' | 'service_unavailable' | 'content_filter' | 'network' | 'aborted' | 'unknown';
interface ErrorClassification {
    kind: ErrorKind;
    /**
     * `true` when retrying the SAME request on a DIFFERENT model will NOT help —
     * the consumer's own failover chain should short-circuit. Sourced from the
     * gateway's `error.terminal` flag when present, with a kind-based fallback.
     */
    terminal: boolean;
    /**
     * `true` when the SAME request is safe to retry as-is (idempotently), usually
     * after `retryAfter` seconds — e.g. a transient rate-limit/outage/timeout.
     * `false` for deterministic rejections (schema, invalid request, auth, caps).
     */
    retryable: boolean;
    /** Seconds the caller should wait before retrying, when the gateway supplied it. */
    retryAfter?: number;
    /** HTTP status, when the error reached the gateway. */
    status?: number;
    /** Gateway error code slug, when present (`schema_too_complex`, `plan_token_limit_exceeded`, …). */
    code?: string;
    /** Human-readable message (the gateway's, or the thrown error's). */
    message: string;
}
/**
 * Classify any caught error from a Builderforce SDK call into a structured,
 * actionable verdict. Accepts `unknown` so a consumer can pass a raw `catch`
 * binding — non-`BuilderforceApiError` values (network throws, `AbortError`,
 * plain `Error`) are classified too.
 *
 * This is the FIRST-PARTY classifier the gateway feedback asked for: keyed off
 * the gateway's own taxonomy so every consumer agrees on what "terminal" and
 * "retryable" mean instead of hand-rolling `429/408/401/5xx → kind` guesses that
 * drift apart.
 */
declare function classifyError(err: unknown): ErrorClassification;

/**
 * deriveResponseFormat — pick the strongest `response_format` a request can SAFELY
 * use given how complex its JSON-Schema is and (optionally) which vendor will
 * serve it.
 *
 * The problem this solves: a strict `json_schema` gives the best conformance, but
 * some vendors' constrained-decoding engines reject a schema that's too complex
 * (Gemini's "too many states for serving"). The gateway now surfaces that as a
 * terminal `schema_too_complex` error — but the cleaner fix is to NOT send a
 * strict schema a vendor can't honour in the first place. This utility is the
 * pre-flight guard: it emits `{ type: 'json_schema', strict }` when the schema is
 * within the (vendor-specific or conservative-default) complexity ceiling, and
 * falls back to `{ type: 'json_object' }` (loose JSON mode — universally
 * supported) when it isn't.
 *
 * The SDK is zero-dependency, so this takes a plain JSON-Schema object — convert
 * a Zod schema first with `zod-to-json-schema` (`deriveResponseFormat(zodToJsonSchema(MySchema), …)`).
 */
interface DeriveResponseFormatOptions {
    /** Schema name sent as `json_schema.name` (default `'response'`). */
    name?: string;
    /** Set `json_schema.strict` when a strict schema is emitted (default `true`). */
    strict?: boolean;
    /**
     * The vendor that will serve the request, when known (the consumer pinned a
     * `model`). Selects that vendor's specific complexity ceiling. Omit when
     * routing is gateway-owned — the conservative default ceiling (the lowest
     * common denominator across vendors) is used so the schema is accepted
     * whichever vendor the gateway picks.
     */
    vendor?: string;
    /**
     * Override the complexity ceiling (max schema "nodes"; see
     * {@link estimateSchemaComplexity}). Above this, loose `json_object` is emitted.
     * Wins over the vendor/default ceiling.
     */
    maxComplexity?: number;
}
interface SchemaComplexity {
    /** Total schema nodes — every property, array `items`, and enum value counts one. */
    nodes: number;
    /** Deepest nesting level reached. */
    maxDepth: number;
    /** Total enum values across the whole schema (the main driver of constrained-
     *  decoding state blow-up). */
    totalEnumValues: number;
    /** Single rolled-up score compared against the ceiling: `nodes + totalEnumValues`. */
    score: number;
}
/**
 * Conservative cross-vendor ceiling, used when no `vendor` is supplied (gateway-
 * owned routing). Tuned below the lowest-ceiling vendor (Gemini's constrained-
 * decoding "too many states" limit) so a schema that passes here is accepted by
 * ANY vendor the gateway might route to.
 */
declare const DEFAULT_SCHEMA_COMPLEXITY_CEILING = 80;
/**
 * Estimate a JSON-Schema's complexity. The dominant cost for constrained decoding
 * is the number of distinct states the engine must track, which grows with the
 * node count and (especially) the total number of enum values. Pure + cheap.
 */
declare function estimateSchemaComplexity(schema: unknown): SchemaComplexity;
/**
 * True when a strict `json_schema` is safe for the given schema + vendor (i.e.
 * within the complexity ceiling, and the vendor isn't strict-schema-incapable).
 * Exposed so callers can branch (e.g. log a downgrade) without re-deriving.
 */
declare function canUseStrictSchema(schema: unknown, opts?: DeriveResponseFormatOptions): boolean;
/**
 * Derive the strongest safe `response_format`:
 *   • within the ceiling → `{ type: 'json_schema', json_schema: { name, schema, strict } }`
 *   • over the ceiling   → `{ type: 'json_object' }` (loose JSON; instruct the
 *     model to follow the shape in your prompt)
 *
 * Pure — returns a value the consumer drops straight into
 * `chat.completions.create({ response_format })`.
 */
declare function deriveResponseFormat(schema: Record<string, unknown>, opts?: DeriveResponseFormatOptions): ResponseFormat;

export { type AiCapability, BuilderforceApiError, BuilderforceClient, type BuilderforceClientOptions, type ChatCompletionChunk, type ChatCompletionCreateParams, type ChatCompletionResponse, ChatCompletionStream, type ChatMessage, type ChatRole, type ContentPart, DEFAULT_SCHEMA_COMPLEXITY_CEILING, type DeriveResponseFormatOptions, type EmbeddingObject, EmbeddingsApi, type EmbeddingsCreateParams, type EmbeddingsResponse, type ErrorClassification, type ErrorKind, type FailoverEvent, type FailoverKind, type FunctionDefinition, type ImageGenerationCreateParams, type ImageGenerationDataEntry, type ImageGenerationResponse, type ImageUrlContentPart, ImagesApi, type JsonSchemaSpec, type ModelInfo, ModelsApi, type ModelsListResponse, type PerCallOptions, type ResponseFormat, type SchemaComplexity, type TextContentPart, type ToolCall, type ToolCallDelta, type ToolCallFunction, type ToolChoice, type ToolSpec, type UsageByDay, type UsageByModel, type UsageByUser, type UsageGetParams, type UsageResponse, canUseStrictSchema, classifyError, deriveResponseFormat, estimateSchemaComplexity };
