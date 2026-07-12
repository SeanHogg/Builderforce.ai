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

import { applyPromptCaching } from '../promptCaching';
import { parseSseDataLine } from '../sseFrames';

export type VendorId =
  // ── Bespoke wire-format vendors (hand-rolled modules)
  | 'openrouter' | 'cerebras' | 'ollama' | 'nvidia' | 'googleai' | 'cloudflare' | 'anthropic'
  // ── Our OWN model: serves a published `.evermind` artifact from R2 via the
  //    builderforce-memory runtime (on-CPU, in-Worker). Reached only via an
  //    explicit `evermind/<ref>` pin (autoRoute:false). See vendors/evermind.ts.
  | 'evermind'
  // ── OpenAI-compatible commercial vendors (createOpenAICompatibleVendor factory).
  //    Each exposes a standard `/chat/completions` endpoint + Bearer auth, so they
  //    ride the shared transport. Reachable via an explicit `<vendor>/<id>` pin
  //    (autoRoute:false — they don't pollute the auto-selected FREE/PRO pools) and
  //    participate in the same dispatch/cooldown/fallback machinery as the rest.
  | 'openai' | 'groq' | 'deepseek' | 'mistral' | 'together' | 'fireworks' | 'qwen'
  | 'deepinfra' | 'xai' | 'perplexity' | 'moonshot' | 'hyperbolic' | 'novita'
  | 'sambanova' | 'lepton' | 'anyscale' | 'octoai' | 'featherless' | 'inferencenet'
  | 'targon' | 'avian' | 'nebius' | 'baseten' | 'lambda' | 'klusterai'
  | 'parasail' | 'nscale' | 'chutes' | 'ai21' | 'siliconflow' | 'minimax'
  // ── BYO-only vendor: no operator pool key; only reachable when a tenant
  //    connects their own Meta AI account from the provider-keys settings page.
  | 'meta';

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
  NVIDIA_API_KEY?: string | null;
  /** Google AI (Gemini) API key — direct call to generativelanguage.googleapis.com.
   *  Powers the gateway's premium fallback at the tail of every cascade. */
  GOOGLE_API_KEY?: string | null;
  /** Anthropic (Claude) API key — direct call to api.anthropic.com/v1/messages.
   *  The last-resort reliability floor for cloud CODING runs: when every
   *  OpenRouter-routed paid coder is unreachable, the coding cascade falls back to
   *  Claude directly on this key (claude-sonnet-4-6 → claude-opus-4-8). */
  CLAUDE_API_KEY?: string | null;
  /** A connected tenant's Claude Pro/Max SUBSCRIPTION access token (OAuth). When
   *  set, the `anthropic` vendor authenticates with `Authorization: Bearer` + the
   *  oauth beta header + the Claude Code system prompt instead of `x-api-key`, so
   *  the cascade's direct-Claude calls ride the tenant's OWN subscription ($0 to
   *  us) rather than the operator's metered `CLAUDE_API_KEY`. Synthesized per
   *  request by `LlmProxyService` from `resolveAnthropicOAuthToken`; absent for
   *  tenants who didn't connect a subscription (behaviour unchanged). */
  CLAUDE_OAUTH_TOKEN?: string | null;
  /** Cloudflare Workers AI token — `cfut_*` auth header for `/ai/run/...` calls. */
  CLOUDFLARE_AI_API_TOKEN?: string | null;
  /** Cloudflare account id — embedded in the endpoint URL
   *  (`/client/v4/accounts/<id>/ai/run/<model>`). Not a token, despite needing
   *  to live alongside one in the Worker secrets; we accept it under the env
   *  name the operator gave us. */
  CLOUDFLARE_ACCOUNT_ID?: string | null;

  // ──────────────────────────────────────────────────────────────────────────
  // OpenAI-compatible commercial vendor keys. Each powers one
  // `createOpenAICompatibleVendor(...)` module; absent → that vendor is simply
  // skipped by the cascade (key-bound check). Set via `wrangler secret put`.
  // The index signature lets the shared factory read `env[apiKeyEnv]` by name
  // without a cast while these named fields keep the documented surface honest.
  // ──────────────────────────────────────────────────────────────────────────
  /** OpenAI — api.openai.com/v1 (GPT-4o, o-series, etc.). */
  OPENAI_API_KEY?: string | null;
  /** Groq — api.groq.com/openai/v1 (LPU-accelerated Llama/Qwen/Kimi). */
  GROQ_API_KEY?: string | null;
  /** DeepSeek — api.deepseek.com/v1 (deepseek-chat / deepseek-reasoner). */
  DEEPSEEK_API_KEY?: string | null;
  /** Mistral La Plateforme — api.mistral.ai/v1. */
  MISTRAL_API_KEY?: string | null;
  /** Together AI — api.together.xyz/v1. */
  TOGETHER_API_KEY?: string | null;
  /** Fireworks AI — api.fireworks.ai/inference/v1. */
  FIREWORKS_API_KEY?: string | null;
  /** DeepInfra — api.deepinfra.com/v1/openai. */
  DEEPINFRA_API_KEY?: string | null;
  /** xAI (Grok) — api.x.ai/v1. */
  XAI_API_KEY?: string | null;
  /** Perplexity — api.perplexity.ai. */
  PERPLEXITY_API_KEY?: string | null;
  /** Moonshot AI (Kimi) — api.moonshot.cn/v1. */
  MOONSHOT_API_KEY?: string | null;
  QWEN_API_KEY?: string | null;
  /** Hyperbolic — api.hyperbolic.xyz/v1. */
  HYPERBOLIC_API_KEY?: string | null;
  /** Novita AI — api.novita.ai/v3/openai. */
  NOVITA_API_KEY?: string | null;
  /** SambaNova Cloud — api.sambanova.ai/v1. */
  SAMBANOVA_API_KEY?: string | null;
  /** Lepton AI — *.lepton.run / api.lepton.ai. */
  LEPTON_API_KEY?: string | null;
  /** Anyscale Endpoints — api.endpoints.anyscale.com/v1. */
  ANYSCALE_API_KEY?: string | null;
  /** OctoAI — text.octoai.run/v1. */
  OCTOAI_API_KEY?: string | null;
  /** Featherless AI — api.featherless.ai/v1. */
  FEATHERLESS_API_KEY?: string | null;
  /** Inference.net — api.inference.net/v1. */
  INFERENCENET_API_KEY?: string | null;
  /** Targon (Manifold) — api.targon.com/v1. */
  TARGON_API_KEY?: string | null;
  /** Avian.io — api.avian.io/v1. */
  AVIAN_API_KEY?: string | null;
  /** Nebius AI Studio — api.studio.nebius.com/v1. */
  NEBIUS_API_KEY?: string | null;
  /** Baseten — inference.baseten.co/v1. */
  BASETEN_API_KEY?: string | null;
  /** Lambda Inference — api.lambda.ai/v1. */
  LAMBDA_API_KEY?: string | null;
  /** Kluster.ai — api.kluster.ai/v1. */
  KLUSTERAI_API_KEY?: string | null;
  /** Parasail — api.parasail.io/v1. */
  PARASAIL_API_KEY?: string | null;
  /** nScale — inference.api.nscale.com/v1. */
  NSCALE_API_KEY?: string | null;
  /** Chutes AI — llm.chutes.ai/v1. */
  CHUTES_API_KEY?: string | null;
  /** AI21 (Jamba) — api.ai21.com/studio/v1. */
  AI21_API_KEY?: string | null;
  /** SiliconFlow — api.siliconflow.com/v1. */
  SILICONFLOW_API_KEY?: string | null;
  /** MiniMax — api.minimax.io/v1. */
  MINIMAX_API_KEY?: string | null;
  /** Meta AI (MUSE) — api.meta.ai/v1. BYO-only: populated exclusively from a
   *  tenant's connected Meta AI provider key (settings → Bring your own models).
   *  No operator-level key exists; when unset the `meta` vendor is skipped by the
   *  cascade exactly like any other unbound vendor. */
  META_API_KEY?: string | null;
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
  /** Prompt-cache breakpoint retention for caching-capable (Anthropic-family)
   *  models: `'5m'` (default ephemeral) or `'1h'` (long retention, ~2x write
   *  cost). Carried from a caller's `_builderforce.cacheTtl` hint; only the
   *  OpenRouter module honours it (other vendors cache implicitly / ignore it). */
  cacheTtl?: '5m' | '1h';
  /** Sent as `X-Title` header for OpenRouter analytics; ignored by other vendors. */
  title?: string;
  /** Per-vendor-call deadline. Overrides `DEFAULT_VENDOR_CALL_TIMEOUT_MS` when
   *  set — used by the premium routing path so PREMIUM-tier models that legitimately
   *  take 30–50s (long-context tailoring, structured extraction) don't get
   *  killed by the free-tier 25s budget. */
  timeoutMs?: number;
  /** Optional caller cancellation. When this aborts (e.g. an execution is
   *  cancelled mid-run), the in-flight fetch is aborted and the cascade stops
   *  (RequestAbortedError) instead of failing over and spending more tokens.
   *  Undefined for normal traffic — behavior is unchanged. */
  signal?: AbortSignal;
  /** R2 artifact store, threaded through dispatch for the `evermind` vendor so
   *  it can load a published `.evermind` model. Undefined for all HTTP vendors
   *  (they reach their backend over the network, not R2). */
  uploads?: import('../evermindRuntime').ArtifactStore;
}

export interface VendorUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  /**
   * Prompt-cache breakdown (when the upstream is a caching provider, e.g.
   * Anthropic via OpenRouter). `cache_read_tokens` are billed at ~10% of the
   * input rate, `cache_creation_tokens` at ~125%; persisting them separately
   * lets cost accounting reflect the discount instead of charging cached input
   * at full rate. Subset of `prompt_tokens` (OpenAI shape) — not additive to it.
   */
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
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

/** Shape-routing capabilities a model supports. Drives `reorderPoolByShape`
 *  per-catalog-entry so non-OpenRouter models can be promoted for tool/vision/
 *  structured/ocr requests instead of relying on OpenRouter-centric id sets [1429]. */
export type AiCapability = 'tools' | 'structured_output' | 'vision' | 'ocr';

export interface VendorModelEntry {
  id: string;
  label: string;
  brand: string;
  tier: AiModelTier;
  /** Optional shape capabilities for capability-aware routing. Absent = unknown
   *  (the legacy literal-id sets still apply for OpenRouter models). */
  capabilities?: AiCapability[];
  /** Optional max context window (tokens). Absent = unknown/large. Small-window
   *  models (e.g. some Cloudflare checkpoints at 24K-32K) must NOT lead a coding
   *  pool — a coding context routinely exceeds that and the model 413s; ordering by
   *  this keeps big-window coders first, and a 413 cascades (see CASCADE_STATUSES). */
  contextWindow?: number;
}

export interface VendorModule {
  id: VendorId;
  apiKeyFrom(env: VendorEnv): string | null;
  catalog: ReadonlyArray<VendorModelEntry>;
  tierFor(modelId: string): AiModelTier;
  call(params: VendorCallParams): Promise<VendorCallResult>;
  /** Optional streaming variant. Vendors that omit this are skipped during streaming dispatch. */
  callStream?(params: VendorCallParams): Promise<VendorStreamResult>;
  /**
   * Whether this vendor's models may be AUTO-SELECTED into the gateway's failover
   * pools (FREE/PRO). Default `true`. Set `false` for a vendor that should only ever
   * run when a caller hard-pins it with an explicit `<vendor>/<id>` prefix — e.g.
   * a local/self-hosted-style runtime (Ollama) that is not a reliable cloud coding
   * backend and must never be the model a cloud agent silently cascades onto.
   * Excludes the vendor from `autoRoutableModelsByTier` (the pool composer) WITHOUT
   * removing it from the catalog, so explicit `ollama/<id>` pins still resolve.
   */
  autoRoute?: boolean;
  /**
   * Per-vendor JSON-Schema dialect compatibility. When set, the gateway strips
   * `stripKeywords` from a consumer-supplied `response_format.json_schema.schema`
   * before forwarding to this vendor — because the vendor's strict-mode validator
   * rejects those draft-07 keywords with a 400 (e.g. Cerebras rejects
   * `maxLength`/`format`/`pattern`/…). Absent = permissive vendor (strip nothing).
   *
   * This replaces the old hardcoded `STRICT_VENDORS`/`STRIPPED_KEYWORDS` literals
   * in `jsonSchemaSanitize.ts` — a stricter future vendor declares its own set
   * here instead of editing the sanitizer (see jsonSchemaSanitize.ts).
   */
  schemaDialect?: { stripKeywords: readonly string[] };
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

/**
 * Detect a 200 OK with no usable content. Some free-tier upstreams accept a
 * request, take 10–20s, and return `choices[0].message.content === ""` with
 * no error code — looks like success but isn't. Tool-call-only responses
 * (`message.tool_calls` populated, `content` empty/null) are legitimate and
 * must NOT be classified as empty.
 *
 * Used by the dispatcher to convert these into `VendorRetryableError` so the
 * cascade advances and a cooldown is recorded — keeping bad-but-200 models
 * out of rotation for the standard `embedded` window (5 min).
 */
export function isEmptyChatResponse(result: VendorCallResult): boolean {
  if (result.content.trim().length > 0) return false;
  const raw = result.raw as { choices?: Array<{ message?: { tool_calls?: unknown[] } }> } | null;
  const toolCalls = raw?.choices?.[0]?.message?.tool_calls;
  if (Array.isArray(toolCalls) && toolCalls.length > 0) return false;
  return true;
}

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

  // Prompt-cache breakdown. Two shapes reach us:
  //  - Anthropic-native: top-level `cache_read_input_tokens` / `cache_creation_input_tokens`
  //  - OpenAI / OpenRouter-normalized: `prompt_tokens_details.cached_tokens` (reads only)
  const details = usage['prompt_tokens_details'];
  const cachedFromDetails = details && typeof details === 'object'
    ? numOrUndef((details as Record<string, unknown>)['cached_tokens'])
    : undefined;
  const cacheRead = numOrUndef(usage['cache_read_input_tokens']) ?? cachedFromDetails;
  const cacheCreation = numOrUndef(usage['cache_creation_input_tokens']);
  if (cacheRead     !== undefined) out.cache_read_tokens     = cacheRead;
  if (cacheCreation !== undefined) out.cache_creation_tokens = cacheCreation;
  return out;
}

/** Coerce an arbitrary value to a finite number, or `undefined` when it is
 *  null/undefined/non-numeric. Shared by `pickUsage` (here) and the Ollama
 *  vendor's native-usage parser so the "absent vs zero" boundary can't drift. */
export function numOrUndef(v: unknown): number | undefined {
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
  /** Vendor identifier as a string label so this class can be shared between
   *  the chat surface (`VendorId`) and the image surface (`ImageVendorId`)
   *  without the union pulling image ids into the chat registry's
   *  `Record<VendorId, VendorModule>` lookup. */
  public readonly vendorId: string;
  public readonly status: number;
  public readonly model: string;
  constructor(vendorId: string, model: string, status: number, message: string) {
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
  public readonly vendorId: string;
  public readonly status: number;
  constructor(vendorId: string, status: number, message: string) {
    super(`[${vendorId}] ${status}: ${message}`);
    this.name = 'VendorFatalError';
    this.vendorId = vendorId;
    this.status = status;
  }
}

/**
 * Schema-shape rejection: the upstream refused the request because the supplied
 * `response_format.json_schema` is too complex for ITS constrained-decoding
 * engine — Gemini's "too many states for serving" / "schema is too complex" is
 * the canonical case, but OpenAI-shaped vendors emit analogous
 * `response_format.json_schema` / "schema is invalid" 400s. This is NOT a
 * malformed request (the JSON-Schema is valid) and NOT a model-health problem
 * (a different vendor with a higher/absent ceiling can serve the SAME schema),
 * so the dispatcher CASCADES on it like a retryable error — but tags the attempt
 * as `kind: 'schema'` and carries the upstream status, so that when EVERY
 * candidate rejects the same schema the proxy can surface a deterministic,
 * TERMINAL 4xx (`schema_too_complex`) instead of a misleading 429 that invites a
 * doomed retry loop. Distinct from {@link VendorFatalError} (genuine 400 bad
 * payload) and {@link VendorRetryableError} (transient/rate-limit) so the
 * dispatcher can classify it without sniffing the message a second time.
 */
export class VendorSchemaError extends Error {
  public readonly vendorId: string;
  public readonly model: string;
  /** The real upstream HTTP status (usually 400) before the gateway normalized
   *  it to the 422 request-error class. Surfaced as `FailoverEvent.upstreamStatus`. */
  public readonly status: number;
  constructor(vendorId: string, model: string, status: number, message: string) {
    super(`[${vendorId}/${model}] schema_too_complex (upstream ${status}): ${message}`);
    this.name = 'VendorSchemaError';
    this.vendorId = vendorId;
    this.model = model;
    this.status = status;
  }
}

/**
 * Worker-runtime exhaustion: the Cloudflare Worker that's running the gateway
 * has hit its per-invocation subrequest cap (50 on free, 1000 on paid). Every
 * subsequent `fetch()` from the same isolate will throw the same error, so
 * advancing the cascade is *guaranteed* to waste 4–6 more attempts on
 * identical 0ms-failures. The dispatcher must short-circuit on this error,
 * surface a distinct envelope to the caller, and SKIP cooldown writes
 * (which are themselves subrequests that would compound the problem).
 *
 * Detected by substring match in `fetchWithVendorTimeout` because the
 * runtime's exception is a plain `Error` whose message is the only
 * machine-readable signal. The substring `Too many subrequests by single
 * Worker invocation` is the canonical phrasing as of the 2026-05-26
 * production trace `llm-2cc6ba1b-...`.
 */
export class WorkerSubrequestExhaustedError extends Error {
  public readonly vendorId: string;
  public readonly model: string;
  constructor(vendorId: string, model: string, message: string) {
    super(`[${vendorId}/${model}] worker subrequest cap exhausted: ${message}`);
    this.name = 'WorkerSubrequestExhaustedError';
    this.vendorId = vendorId;
    this.model = model;
  }
}

/**
 * Thrown when an EXTERNAL AbortSignal (caller cancellation, e.g. an execution
 * cancelled mid-run) aborts the in-flight vendor fetch — distinct from the
 * per-vendor *timeout* (which is a 408 VendorRetryableError that cascades). A
 * caller cancel must STOP the cascade, not fail over to the next model and keep
 * spending — so the dispatcher treats this like WorkerSubrequestExhaustedError:
 * record the attempt and bubble up immediately.
 */
export class RequestAbortedError extends Error {
  public readonly vendorId: string;
  public readonly model: string;
  constructor(vendorId: string, model: string) {
    super(`[${vendorId}/${model}] request aborted by caller`);
    this.name = 'RequestAbortedError';
    this.vendorId = vendorId;
    this.model = model;
  }
}

/** Detect Cloudflare's per-invocation subrequest cap exhaustion message.
 *  Single source of truth — the substring is also matched in tests. */
const SUBREQUEST_CAP_MARKER = 'Too many subrequests by single Worker invocation';
export function isSubrequestCapMessage(msg: string): boolean {
  return msg.includes(SUBREQUEST_CAP_MARKER);
}

/** Statuses that trigger cascade to the next model.
 *  413 (payload/context too large) is here so a model whose context window the
 *  request exceeds (e.g. a 97K coding context hitting a 32K Cloudflare model →
 *  "exceeded this model context window limit") FAILS OVER to a bigger-window model
 *  instead of hard-failing the run. The pool is ordered big-window-first, so the
 *  cascade lands on a model that fits. */
export const CASCADE_STATUSES: ReadonlySet<number> = new Set<number>([
  404, 408, 413, 429, 500, 502, 503, 504,
]);

export const AUTH_STATUSES: ReadonlySet<number> = new Set<number>([401, 403]);

/**
 * True when a non-OK 4xx body is a CAPACITY / billing condition — a usage cap,
 * spend limit, low credit balance, or exhausted quota — rather than a malformed
 * request. Several upstreams return these as HTTP **400** (not 429): Anthropic
 * emits `invalid_request_error` "You have reached your specified API usage
 * limits" / "Your credit balance is too low to access the Anthropic API", and
 * OpenAI-shaped vendors use `insufficient_quota` / "exceeded your current
 * quota". These are NOT payload bugs — the *request* is fine and a DIFFERENT
 * vendor can serve it — so the cascade must fail over (and cool this vendor)
 * instead of hard-failing the run with a misleading 400. (Fix: a cloud coding
 * run flooring onto the direct-Anthropic backstop died with a fatal 400 when
 * that account hit its monthly usage cap, never failing over — execution #73.)
 */
/**
 * Stable marker embedded in the retryable error a capacity/billing limit raises
 * ({@link throwClassified4xx}). The cooldown store keys off this exact substring
 * to give a capacity failure a LONG vendor backoff (a usage cap won't recover in
 * the 5-minute transient window), so the gateway stops re-hammering — and
 * re-spending on — a metered key that has hit its monthly limit. Shared so the
 * producer (here) and the classifier (cooldownStore.classifyFailure) can't drift.
 */
export const CAPACITY_LIMIT_MARKER = 'capacity/usage limit';

export function isCapacityLimitBody(text: string | undefined | null): boolean {
  if (!text) return false;
  return /usage\s+limit|credit\s+balance|insufficient[_\s-]?quota|exceeded\s+your\s+(current\s+)?quota|spend(ing)?\s+limit|billing\s+(hard\s+)?limit|reached\s+your[^.]*\blimit/i.test(
    text,
  );
}

/**
 * Stable `reason` slug a schema-shape rejection carries through the cascade
 * ({@link VendorSchemaError} → `DispatchAttempt.reason` → `FailoverEvent.reason`
 * → the terminal `error.code`). Single source so the producer (the vendor
 * transport) and every downstream consumer (proxy envelope, SDK `classifyError`)
 * agree on the slug.
 */
export const SCHEMA_TOO_COMPLEX_REASON = 'schema_too_complex';

/**
 * True when a non-OK 4xx body (or a 200-embedded error) is the upstream
 * rejecting a `response_format.json_schema` as too complex for its constrained-
 * decoding engine, rather than a malformed request. Several upstreams surface
 * this differently:
 *   - Gemini (direct or via OpenRouter): `"too many states for serving"`,
 *     `"schema is too complex"`, `"exceeds the maximum number of ... states"`.
 *   - OpenAI-shaped vendors: `"response_format.json_schema"` invalid /
 *     `"schema is too large"` / `"too many enum values"` / constrained-decoding
 *     ceiling messages.
 * These are NOT payload bugs (the JSON-Schema is structurally valid) and a
 * DIFFERENT vendor can serve the SAME schema — so the cascade fails over, but
 * the proxy surfaces a deterministic TERMINAL `schema_too_complex` 4xx when
 * EVERY candidate rejects it (rather than a misleading 429). Deliberately narrow
 * so a generic `"invalid request"` 400 stays a normal request-error.
 */
export function isSchemaComplexityBody(text: string | undefined | null): boolean {
  if (!text) return false;
  // Must mention a schema/structured-output construct AND a complexity/limit
  // signal — keeps a plain malformed-payload 400 out of this bucket.
  const mentionsSchema = /schema|response_format|structured\s+output|constrained|grammar|states\s+for\s+serving/i.test(text);
  if (!mentionsSchema) return false;
  return /too\s+complex|too\s+many\s+states|too\s+many\s+enum|too\s+large|maximum\s+number\s+of|exceeds?\s+the\s+maximum|state\s+limit|nesting\s+(depth|too\s+deep)|too\s+deeply\s+nested/i.test(
    text,
  );
}

/**
 * Classify a would-be-FATAL 4xx the shared way and throw: a capacity/billing
 * limit ({@link isCapacityLimitBody}) becomes a **retryable** error tagged 429
 * so the cascade fails over to another vendor AND `recordFailure` cools this one
 * (a usage cap recovers later, exactly like a rate limit); a genuine malformed
 * request stays fatal. Single source so every vendor agrees on the boundary.
 * Always throws — return type `never`.
 */
export function throwClassified4xx(
  vendorId: string,
  model: string,
  status: number,
  errText: string,
): never {
  // Schema-too-complex is checked FIRST: it rides on a 400 (so the fatal branch
  // below would wrongly hard-fail the run) but a DIFFERENT vendor can serve the
  // same schema, so it must cascade — and carry the `schema` class so an
  // all-schema cascade surfaces a terminal `schema_too_complex` 4xx, not a 429.
  if (isSchemaComplexityBody(errText)) {
    throw new VendorSchemaError(vendorId, model, status, errText.slice(0, 240));
  }
  if (isCapacityLimitBody(errText)) {
    throw new VendorRetryableError(
      vendorId,
      model,
      429,
      `${CAPACITY_LIMIT_MARKER} (upstream ${status}): ${errText.slice(0, 200)}`,
    );
  }
  throw new VendorFatalError(vendorId, status, errText);
}

/**
 * Per-vendor-call timeout *default*. The caller (SDK) sets the *outer* deadline
 * for the whole request; this is the *inner* deadline for one vendor attempt.
 * When a vendor hangs (e.g. OpenRouter free-tier queueing under load), the
 * inner timeout fires first, the dispatcher advances to the next candidate,
 * and the caller still has budget left for another try.
 *
 * 25s gives a 60s outer-budget room for ~2 attempts (incl. retry overhead).
 *
 * Per-call override via `VendorCallParams.timeoutMs` — used by the premium
 * routing path to extend this to 60s for PREMIUM-tier models that legitimately
 * take 30-50s (long-context tailoring, structured extraction). See
 * `PREMIUM_VENDOR_CALL_TIMEOUT_MS` in LlmProxyService for the premium value.
 */
export const DEFAULT_VENDOR_CALL_TIMEOUT_MS = 25_000;

/**
 * Hard ceiling on any per-call timeout override. A caller can opt a single long
 * call into a larger inner budget via `body._builderforce.vendorTimeoutMs`
 * (see `resolveVendorTimeoutOverride` in LlmProxyService) regardless of plan —
 * but never beyond this clamp. Pinned to the premium routing budget so a
 * non-premium tenant's one-off long call can reach the same 60s extended budget
 * the premium path already uses, without letting an arbitrary value hold a
 * Worker isolate (and its subrequest budget) open indefinitely.
 */
export const MAX_VENDOR_CALL_TIMEOUT_MS = 60_000;

/**
 * Wrap a vendor fetch in a per-call timeout. On timeout, abort the underlying
 * request AND throw a `VendorRetryableError` so the dispatcher advances. On
 * any other network error, surface as a retryable error too — dispatcher
 * already classifies these as cascade-eligible.
 *
 * Exported so the image-generation vendors (`../imageVendors/`) reuse the
 * same timeout + classification path instead of duplicating it. The vendor id
 * is typed as `string` because the chat-side `VendorId` enum doesn't include
 * image vendor ids (different registries); the value flows into
 * `VendorRetryableError.vendorId` (also `string`) without a cast.
 */
export async function fetchWithVendorTimeout(
  vendorId: string,
  model: string,
  endpoint: string,
  init: RequestInit,
  timeoutMsArg?: number,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const timeoutMs = timeoutMsArg && timeoutMsArg > 0 ? timeoutMsArg : DEFAULT_VENDOR_CALL_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Fold the caller's cancellation into this fetch's controller so an external
  // abort (execution cancelled mid-run) stops the in-flight request — and is
  // distinguishable from the timeout below so the cascade stops instead of
  // failing over. Cheap no-op when no signal is passed (normal traffic).
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }
  try {
    return await fetch(endpoint, { ...init, signal: controller.signal });
  } catch (err) {
    if (externalSignal?.aborted) {
      throw new RequestAbortedError(vendorId, model);
    }
    if (controller.signal.aborted) {
      throw new VendorRetryableError(vendorId, model, 408, `vendor timed out after ${timeoutMs}ms`);
    }
    const msg = err instanceof Error ? err.message : String(err);
    // Cloudflare's per-invocation subrequest cap. Every later `fetch()` from
    // this isolate will throw the same thing, so trying the next vendor in
    // the cascade is guaranteed to burn budget on 0ms identical failures —
    // raise a sentinel error the dispatcher recognises and propagates
    // immediately. Caught BEFORE the generic `network:` wrap so the
    // dispatcher sees the typed error class, not a `VendorRetryableError`.
    if (isSubrequestCapMessage(msg)) {
      throw new WorkerSubrequestExhaustedError(vendorId, model, msg);
    }
    throw new VendorRetryableError(vendorId, model, 0, `network: ${msg}`);
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

// ---------------------------------------------------------------------------
// Shared OpenAI-compatible request body builder
//
// Every OpenAI-shaped vendor (openrouter / nvidia / cerebras / googleai /
// cloudflare) was hand-rolling the SAME `{ model, messages, tools, tool_choice,
// max_tokens, temperature, top_p, ...extraBody }` body. This is the single source.
// Per-vendor quirks ride the small `opts` (Cerebras's `max_completion_tokens`,
// OpenRouter's prompt-cache message transform + schema sanitize) so the shape lives
// in ONE place. (Ollama is genuinely different — native `options`/NDJSON — and keeps
// its own builder.)
// ---------------------------------------------------------------------------

export interface OpenAIChatBodyOptions {
  /** Field name for the output-token cap. Cerebras prefers `max_completion_tokens`. */
  maxTokensField?: 'max_tokens' | 'max_completion_tokens';
  /** Transform the passthrough `extraBody` (e.g. strip JSON-Schema keywords a strict
   *  vendor validator rejects). */
  transformExtra?: (extraBody: Record<string, unknown> | undefined) => Record<string, unknown> | undefined;
  /** Opt out of prompt-cache breakpoint injection. Default OFF (caching ON for every
   *  call) — `applyPromptCaching` no-ops for non-caching-capable models, so it is safe
   *  everywhere and only marks the stable prefix on caching-capable (Anthropic-family)
   *  ids, where re-sending a large coding prefix every turn would otherwise pay full
   *  price instead of the ~0.1x cache-read rate. */
  noCache?: boolean;
}

export function buildOpenAIChatBody(params: VendorCallParams, opts?: OpenAIChatBodyOptions): Record<string, unknown> {
  const { model, messages, tools, toolChoice, maxTokens, temperature, topP, extraBody } = params;
  const mtField = opts?.maxTokensField ?? 'max_tokens';
  // Cache the stable prefix on EVERY call by default (no-op for non-caching models).
  const msgs = opts?.noCache ? messages : applyPromptCaching(messages, model, params.cacheTtl);
  const extra = opts?.transformExtra ? opts.transformExtra(extraBody) : extraBody;
  return {
    model,
    messages: msgs,
    ...(tools ? { tools } : {}),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
    ...(maxTokens != null ? { [mtField]: maxTokens } : {}),
    ...(temperature != null ? { temperature } : {}),
    ...(topP != null ? { top_p: topP } : {}),
    ...extra,
  };
}

/**
 * Forward the three optional per-call passthrough fields (`title`, `timeoutMs`,
 * `signal`) as a spreadable object, omitting each when unset. Every OpenAI-shaped
 * vendor module (openaiCompatible factory, googleai, cloudflare, openrouter,
 * ollama) hand-rolled this identical triple-spread; this is the single source so
 * a new passthrough field is added in ONE place.
 */
export function forwardCallOpts(params: VendorCallParams): {
  title?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
} {
  return {
    ...(params.title ? { title: params.title } : {}),
    ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
    ...(params.signal ? { signal: params.signal } : {}),
  };
}

// ---------------------------------------------------------------------------
// Shared HTTP transport for non-streaming requests
//
// `executeVendorPost` is the ONE POST-JSON-with-Bearer transport every
// non-streaming surface rides: it does the fetch (with the per-vendor timeout +
// abort classification), the optional 200-with-embedded-`{error}` guard, and the
// CASCADE / AUTH / fatal status ladder. Each surface passes its own
// `parseResponse`, its `logPrefix` + auth failover noun, an optional
// `onEmbeddedError` (chat/embeddings check the embedded body; image does not),
// and an `onFatal` (chat → `throwClassified4xx`; image/embeddings →
// `VendorFatalError`). This preserves each surface's EXACT error classes and log
// prefixes while collapsing three near-identical transports into one.
// ---------------------------------------------------------------------------

export async function executeVendorPost<T>(args: {
  vendorId: string;
  endpoint: string;
  apiKey: string;
  model: string;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Console log prefix for the auth-failure line, e.g. `vendors` / `imageVendors`. */
  logPrefix: string;
  /** Noun in the "Failing over to next <noun>." auth message (`model` / `vendor`). */
  authFailoverNoun: string;
  parseResponse: (raw: unknown) => T;
  /** Called (throws) when a 200 OK carries an embedded `{ error }`. Omit to skip
   *  the embedded-error guard entirely (the image surface has none). */
  onEmbeddedError?: (vendorId: string, model: string, msg: string) => never;
  /** Called (throws) for a non-cascade, non-auth 4xx (400/422 etc.). */
  onFatal: (vendorId: string, model: string, status: number, errText: string) => never;
}): Promise<T> {
  const {
    vendorId, endpoint, apiKey, model, body, headers, timeoutMs, signal,
    logPrefix, authFailoverNoun, parseResponse, onEmbeddedError, onFatal,
  } = args;

  // Per-vendor timeout — see fetchWithVendorTimeout for rationale. Throws
  // VendorRetryableError on timeout/network, so there's no catch block here.
  const resp = await fetchWithVendorTimeout(vendorId, model, endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(headers ?? {}),
    },
    body: JSON.stringify(body),
  }, timeoutMs, signal);

  if (resp.ok) {
    const raw = await resp.json();
    // Some providers (notably OpenRouter) return 200 with { error: ... } embedded.
    if (onEmbeddedError && raw && typeof raw === 'object' && 'error' in raw && (raw as Record<string, unknown>)['error'] != null) {
      const errObj = (raw as Record<string, unknown>)['error'];
      const msg = (errObj && typeof errObj === 'object' && 'message' in errObj
        ? String((errObj as Record<string, unknown>)['message'])
        : JSON.stringify(errObj)).slice(0, 240);
      onEmbeddedError(vendorId, model, msg);
    }
    return parseResponse(raw);
  }

  const errText = (await resp.text()).slice(0, 400);

  if (CASCADE_STATUSES.has(resp.status)) {
    throw new VendorRetryableError(vendorId, model, resp.status, errText.slice(0, 240));
  }

  if (AUTH_STATUSES.has(resp.status)) {
    console.error(
      `[${logPrefix}] ${vendorId}/${model} auth ${resp.status} — check ${vendorId.toUpperCase()}_API_KEY. Failing over to next ${authFailoverNoun}.`,
      errText.slice(0, 200),
    );
    throw new VendorRetryableError(vendorId, model, resp.status, `auth ${resp.status}: ${errText.slice(0, 200)}`);
  }

  return onFatal(vendorId, model, resp.status, errText);
}

export async function executeChatCompletion(args: {
  vendorId: VendorId;
  endpoint: string;
  apiKey: string;
  model: string;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
  title?: string;
  parseResponse?: ResponseParser;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<VendorCallResult> {
  const { vendorId, endpoint, apiKey, model, body, headers, title, timeoutMs, signal } = args;
  const parseResponse = args.parseResponse ?? parseOpenAIResponse;

  return executeVendorPost<VendorCallResult>({
    vendorId,
    endpoint,
    apiKey,
    model,
    body,
    // X-Title first so a caller-supplied `headers` entry still wins (spread last).
    headers: { 'X-Title': title ?? 'Builderforce.ai', ...(headers ?? {}) },
    ...(timeoutMs != null ? { timeoutMs } : {}),
    ...(signal ? { signal } : {}),
    logPrefix: 'vendors',
    authFailoverNoun: 'model',
    parseResponse: (raw): VendorCallResult => {
      const parsed = parseResponse(raw);
      return { raw, content: parsed.content, ...(parsed.usage ? { usage: parsed.usage } : {}) };
    },
    onEmbeddedError: (vId, m, msg): never => {
      // A schema-too-complex rejection from Gemini-family upstreams routinely
      // arrives HERE — a 200 OK with the real cause buried in an embedded error
      // body (the `code: 0` failovers hired.video's trace showed). Classify it
      // as `schema` so an all-schema cascade surfaces a terminal 4xx instead of
      // cascading as a generic embedded/network failure and collapsing into 429.
      if (isSchemaComplexityBody(msg)) {
        throw new VendorSchemaError(vId, m, 200, msg);
      }
      throw new VendorRetryableError(vId, m, 0, `embedded: ${msg}`);
    },
    // 400/422 → fatal, UNLESS the body is a capacity/billing limit (failover-able).
    onFatal: throwClassified4xx,
  });
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
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<VendorStreamResult> {
  const { vendorId, endpoint, apiKey, model, body, headers, title, timeoutMs, signal } = args;

  const resp = await fetchWithVendorTimeout(vendorId, model, endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Title': title ?? 'Builderforce.ai',
      ...(headers ?? {}),
    },
    body: JSON.stringify({ ...body, stream: true }),
  }, timeoutMs, signal);

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
    // 400/422 → fatal, UNLESS the body is a capacity/billing limit (failover-able).
    throwClassified4xx(vendorId, model, resp.status, errText);
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
    // Schema-too-complex can also surface as a first-chunk embedded error on the
    // streaming surface — classify it the same way so the cascade tags it
    // `schema` (terminal-eligible) rather than a generic embedded failure.
    if (isSchemaComplexityBody(firstText)) {
      throw new VendorSchemaError(vendorId, model, 200, firstText.slice(0, 200));
    }
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

/** Detect a provider error embedded in the first SSE chunk. Uses the shared
 *  `parseSseDataLine` (canonical `slice(5).trim()`) so a spaceless `data:{…}`
 *  frame parses too — the old hand-rolled `slice(6)` here silently chopped a
 *  character off such a frame and mis-fired the fallback. */
function isChunkError(text: string): boolean {
  if (!text.includes('"error"')) return false;
  const dataLine = text.split('\n').find((l) => l.trim().startsWith('data:'));
  if (!dataLine) return true; // mentions "error" without a data line — be safe
  const parsed = parseSseDataLine(dataLine);
  if (parsed === undefined || typeof parsed !== 'object' || parsed === null) {
    return true; // unparseable / [DONE] but mentions "error" — treat as error
  }
  return 'error' in parsed && (parsed as Record<string, unknown>)['error'] != null;
}
