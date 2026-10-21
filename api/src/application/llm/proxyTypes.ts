/**
 * builderforceLLM gateway — the public request / result / option types.
 *
 * Split out of `LlmProxyService.ts` (which re-exports every one of them) so the
 * gateway's collaborators — dispatch, seed composition, envelopes, finalize — can
 * share the contract without importing the facade class.
 */

import type { DispatchAttempt, UpstreamDiagnostic, VendorEgress, VendorEnv, VendorId } from './vendors';
import type { TenantVendorKeys } from './tenantProviderKeyService';
import type { OpenRouterConnection } from './openRouterConnectionService';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
}

export interface ChatCompletionRequest {
  /** Preferred model. By default a soft hint: seeded at the head of the cascade,
   *  but the chain may fall through to other pool models on failure. Set
   *  `modelStrict: true` to enforce it as a hard single-model pin (no failover). */
  model?: string;
  /** When true (and `model` is set), dispatch ONLY `model` — no cascade, no
   *  failover. Used by cloud coding agents to honour an explicit user/agent model
   *  selection for the whole run instead of silently swapping models per turn.
   *  `strict` (below) is the public SDK alias for the same behaviour. */
  modelStrict?: boolean;
  /** Public SDK alias for `modelStrict`. Eval / reproducibility callers set
   *  `strict: true` (or pass `?strict=true`) so the gateway pins the named
   *  `model` with NO substitution — an unavailable model 503s rather than
   *  silently swapping. Normalized onto `modelStrict` by `resolveStrictPin`. */
  strict?: boolean;
  /** Explicit interactive routing choice. Absent preserves legacy BYO-first,
   * fail-closed behavior for existing SDK and autonomous callers. */
  routingMode?: 'auto' | 'byo_pool';
  /**
   * Models the CALLER has already proved unusable for this piece of work, to be
   * routed around. A soft de-selection, not a ban: they are removed from the
   * candidate chain only while something else remains, because an empty chain is a
   * worse outcome than retrying a weak model.
   *
   * The case this exists for: an agentic caller advertises tools, the auto-selected
   * model answers in prose without calling any, and the caller retries. With no way
   * to say "not that one", every retry re-selects the same model and the caller's only
   * remaining move is to refuse to run — which is exactly what bricked a Canvas session
   * on 2026-08-12, where the free pool's one auto model would not emit a tool call and
   * the surface then told a free-plan visitor to "select a different model" they had no
   * ability to select.
   *
   * Gateway-only: listed in STANDARD_BODY_FIELDS so it is stripped before vendor dispatch.
   */
  excludeModels?: string[];
  /**
   * What kind of call this is (plan/code/verify/explore/chat/utility). Orders the
   * tenant's connected accounts for the work ({@link orderForRole}): a coding turn
   * leads with the strongest connected model, a planning turn keeps the tenant's own
   * precedence. Unknown values are ignored. Gateway-only: stripped before dispatch.
   */
  role?: string;
  /** The launching canvas session's arc stage — a nudge on top of `role`. Gateway-only. */
  arcStage?: string;
  /** OPTIONAL vendor-neutral reasoning intent (the VS Code chat "Thinking" toggle).
   *  Omitted entirely when the toggle is off. The level names are `AgentThinkLevel`
   *  members, so `reasoningCapability` maps them to the CORRECT vendor param for the
   *  model that actually serves — or drops them for a family that can't accept one.
   *  Gateway-only: consumed in `dispatch()`, never forwarded to a vendor. */
  reasoning?: { level?: string };
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
  /** Prompt-cache breakdown (subset of promptTokens). Present only for caching
   *  upstreams. Persisted so cost accounting can discount cache reads (~0.1x). */
  cacheReadTokens?:     number;
  cacheCreationTokens?: number;
}

/** One model attempt that failed before the resolved model succeeded. */
export interface FailoverEvent {
  model: string;
  /** Vendor that owns this model — lets callers see if failures concentrate
   *  on one upstream (e.g. all OpenRouter free-tier saturated) vs are
   *  distributed across vendors. */
  vendor: VendorId;
  /** HTTP status, or 0 for embedded errors / network failures. */
  code: number;
  /** Wall-clock time spent on this attempt, ms (diagnostic tracing). */
  durationMs?: number;
  /** Coarse failure class — rate_limit | timeout | auth | server_error |
   *  schema | network | skipped (diagnostic tracing). */
  kind?: string;
  /** Stable machine-readable cause slug when one applies (e.g. `schema_too_complex`).
   *  Lets consumers branch on structured data instead of regex-sniffing the message. */
  reason?: string;
  /** The REAL upstream HTTP status before the gateway normalized it into its own
   *  failure class (e.g. a Gemini schema 400 normalized to the 422 request-error
   *  class records `upstreamStatus: 400`). Absent when `code` IS the upstream status. */
  upstreamStatus?: number;
  /** Human-readable failure detail (the vendor error message / thrown `Error.message`,
   *  truncated). Critical for the `code: 0` case, where the status alone ("no response")
   *  hides WHY the vendor `fetch()` threw — e.g. `network: <cause>` or a rejected body.
   *  Surfaced in diagnostics so a connected-account failure names its own cause. */
  detail?: string;
  /** Redacted upstream evidence — where the call went, the provider's own correlation
   *  headers, and whether the body was an edge block page rather than an API error.
   *  This is what makes a provider support ticket actionable: "your gateway is broken"
   *  and "your CDN refused us before the key was read" look identical in `detail` alone. */
  diagnostic?: UpstreamDiagnostic;
}

export interface ProxyResult {
  /** Final upstream Response (may be streamed). */
  response: Response;
  /** Which model actually served the request. */
  resolvedModel: string;
  /** Vendor that owns `resolvedModel` — sourced from the catalog. Always set
   *  (every successful or failed response has *some* model the cascade landed
   *  on); routes echo it back to consumers as `_builderforce.resolvedVendor`
   *  and on errors as the top-level `vendor` field. */
  resolvedVendor: VendorId;
  /** How many failovers happened before success. */
  retries: number;
  failovers: FailoverEvent[];
  /** Token usage from non-streaming responses; undefined for streams (route intercepts). */
  usage?: LlmUsage;
  /** On a `response_cache_hit` only: the usage the ORIGINAL upstream call recorded,
   *  read from the stored body. Deliberately NOT `usage` — nothing was dispatched, so no
   *  spend may be metered from it; the savings ledger prices the avoided call from it. */
  cachedUsage?: LlmUsage;
  /** True when the request resolved via the funded overflow path (premium
   *  fallback / backstop on Builderforce's own key) rather than a plan-pool
   *  model. The route stamps this onto the usage row so overflow spend can be
   *  capped per tenant. See {@link isPaidOverflowModel}. */
  paidOverflow?: boolean;
  /** True when the tenant's OWN provider credential (a connected subscription or
   *  a BYO vendor key) served this call — so the platform pays nothing. The route
   *  stamps it onto the usage row as `byo`, which forces cost 0 and (for on-prem /
   *  VSIX surfaces) exempts the row from the plan token allowance. Stamped by
   *  finalize() via {@link isTenantFunded}. */
  byoFunded?: boolean;
  /** True when the final model came from a tenant-registered OpenRouter
   * connection. These calls carry the flat platform routing surcharge whether
   * they used Builderforce's key or the tenant's own OpenRouter key. */
  platformSurcharge?: boolean;
  /** Number of times the gateway re-dispatched on non-conforming JSON output
   *  (only applies when `body.response_format.type` is `json_object`/`json_schema`). */
  schemaRetries?: number;
  /** True when the gateway AUTO-DOWNGRADED a too-complex `response_format.json_schema`
   *  to loose `json_object` and re-ran the cascade so the caller still got a
   *  structured result instead of a terminal `schema_too_complex`. The strict
   *  schema guarantee was relaxed — the caller should validate the JSON itself. */
  schemaDowngraded?: boolean;
  // --- Diagnostic tracing (stamped by complete() via finalize) -------------
  /** Authoritative gateway trace id (`llm-<uuid>`) echoed to the consumer and
   *  used by the superadmin trace lookup. */
  traceId?: string;
  /** Total gateway wall-clock time for this call, ms. */
  durationMs?: number;
  /** Final HTTP status returned to the caller (mirrors `response.status`). */
  status?: number;
  /** The model chain the gateway actually walked for this request. */
  candidateChain?: string[];
  /** success | cascade_exhausted | all_cooldown | subrequest_exhausted |
   *  strict_unavailable | model_unavailable | schema_nonconforming | request_error |
   *  byo_unavailable (BYO required but no connected provider can serve) |
   *  schema_too_complex (every candidate rejected the json_schema as too complex). */
  outcome?: string;
  /** Rolled-up failure class across attempts — rate_limit | timeout | auth |
   *  server_error | mixed | none. */
  classification?: string;
  /** Raw per-attempt diagnostics (model, vendor, status, error text, durationMs,
   *  kind). Server-side ONLY — written to the superadmin trace, NEVER serialized
   *  back to the caller (the per-attempt error text can contain raw upstream
   *  provider payloads). */
  attempts?: DispatchAttempt[];
}

/** Assistant message shape carried in a chat-completion choice. */
export interface ProxyChoiceMessage {
  role?: string;
  content?: string | null;
  tool_calls?: Array<{ id: string; type?: string; function: { name: string; arguments?: string } }>;
}

/** The unwrapped first choice of a {@link ProxyResult}. */
export interface ProxyChoice {
  /** The raw assistant message (undefined on a non-JSON / error body). */
  message: ProxyChoiceMessage | undefined;
  /** Trimmed assistant text — `''` when the turn was tool-only, genuinely empty, or the
   *  body was a non-2xx/non-JSON envelope. */
  content: string;
  /** Tool calls the model requested (empty array when none). */
  toolCalls: NonNullable<ProxyChoiceMessage['tool_calls']>;
  /** OpenAI `finish_reason` (`stop` | `tool_calls` | `length` | …), `''` when absent. */
  finishReason: string;
  /** Full parsed OpenAI-shaped body, for callers that also need `usage`/`error`/etc. */
  body: Record<string, unknown> | null;
}

export type ProductName = 'builderforceLLM' | 'builderforceLLMPro' | 'builderforceLLMTeams';

export interface ProxyEnv extends VendorEnv {
  /** Pro-tier OpenRouter key. Used in place of OPENROUTER_API_KEY when the
   *  proxy was constructed with a Pro/Teams productName. */
  OPENROUTER_API_KEY_PRO?: string | null;
  /** Optional KV namespace for persistent cooldown + key-resolution caching.
   *  When unset, both fall back to in-memory per-isolate state. */
  AUTH_CACHE_KV?: KVNamespace;
  /** R2 bucket holding published `.evermind` model artifacts. Threaded into the
   *  vendor dispatch so the `evermind` vendor can load + run a tenant's own model.
   *  Absent in environments without R2 (the evermind vendor then errors cleanly). */
  UPLOADS?: R2Bucket;
  /** Tool-choice confidence bar override, resolved here and threaded to the vendor
   *  (vendors are env-free by design). See `evermindToolChoiceMinMargin`. */
  EVERMIND_TOOL_CHOICE_MIN_MARGIN?: string;
}

export interface LlmProxyOptions {
  modelPool?: readonly string[];
  preferredPoolSize?: number;
  productName?: ProductName;
  /** Per-vendor-call deadline. Defaults to `DEFAULT_VENDOR_CALL_TIMEOUT_MS`
   *  in the vendor transport. The premium routing path sets this to
   *  `PREMIUM_VENDOR_CALL_TIMEOUT_MS` so PREMIUM-tier long-context calls
   *  aren't killed by the free-tier 25s budget. */
  vendorCallTimeoutMs?: number;
  /** Reliability-floor chain dispatched (on the credited key) after the primary
   *  cascade fails. Defaults to `[GUARANTEED_BACKSTOP_MODEL]`. Coding runtimes
   *  pass `CODING_BACKSTOP_MODELS` so an exhausted coding cascade floors onto a
   *  coder, not the general-purpose backstop. Tried in order. */
  backstopModels?: readonly string[];
  /** When true, the cascade drops the premium fallback chain AND skips the paid
   *  backstop — so an exhausted primary pool surfaces `cascade_exhausted` instead
   *  of falling through to a model Builderforce funds on its own key. Set by the
   *  gateway route once a tenant has exceeded its daily paid-overflow $ cap, to
   *  put a hard ceiling on overflow spend (a Free tenant's primary free pool
   *  still runs — only the funded overflow path is closed). */
  disablePaidOverflow?: boolean;
  /** Connected accounts first as ORDER, not a boundary (`fundingOrder.ts` byo_first /
   * free_first): keep connected accounts at the head (or behind the free tier with
   * `freeFirst`), but allow the gateway to continue into entitled shared routes. Absent
   * keeps the BYO execution boundary used by autonomous callers. */
  allowGatewayAuto?: boolean;
  /** The free tier (FREE models + the Cloudflare daily allowance) leads the chain and
   *  connected accounts follow it — see `fundingOrder.ts` (`resolveFundingOrder`). */
  freeFirst?: boolean;
  /** When true, this proxy is serving a CODING run: the appended premium fallback
   *  chain is the coding-capable one (`CODING_PREMIUM_FALLBACK_MODELS`, paid
   *  coders) instead of the general non-coder gemini chain, so an exhausted coding
   *  cascade never resolves onto a generalist. Set by `llmProxyForPlan({codingOnly})`.
   *  Pairs with `backstopModels: CODING_BACKSTOP_MODELS` for the credited-key floor. */
  codingOnly?: boolean;
  /** Max FREE-tier seed models the cascade tries before falling through to the
   *  premium fallback. Defaults to `FREE_ATTEMPT_BUDGET` (2) for latency-sensitive
   *  general requests; coding runs pass `CODING_FREE_ATTEMPT_BUDGET` (the whole
   *  free coding pool) so every free coder is exhausted before any paid/metered
   *  coder. */
  freeBudget?: number;
  /** A connected tenant's Claude Pro/Max SUBSCRIPTION access token. When set, the
   *  `anthropic` vendor authenticates with it (Bearer + oauth) instead of the
   *  operator key, so any direct-Claude resolution in the cascade rides the
   *  tenant's own subscription — and is NOT metered as paid-overflow (it's $0 to
   *  us). Resolved per request from `resolveAnthropicOAuthToken`. */
  anthropicOAuthToken?: string | null;
  openaiCodexAuth?: { accessToken: string; accountId: string } | null;
  xaiOAuthToken?: string | null;
  /** A tenant's BYO api-key credentials (OpenAI / Google / Anthropic) keyed by
   *  provider. When set, vendorEnv overrides the matching operator env key with
   *  the tenant's key for that vendor and marks the vendor tenant-funded (byo) —
   *  so its usage is $0 to us and metered per the BYO rules. Resolved per request
   *  from {@link resolveTenantVendorKeys}. */
  tenantVendorKeys?: TenantVendorKeys | null;
  /** The tenant's BYO PRECEDENCE as ordered gateway vendor ids (most-preferred first).
   *  Threaded into the auto-select connected-flagship seed ({@link byoAutoSeedModels})
   *  so the gateway completion seed leads with the owner's chosen account (e.g. Meta
   *  first), matching the cloud-agent pin. Empty/undefined = catalog-tier order. */
  byoVendorPriority?: readonly string[];
  /** Gateway vendor ids whose underlying TENANT account is currently known-broken
   *  (401 / 403 / out-of-budget, per `providerAuthAlerts`). Unioned with the global
   *  5xx-streak set and passed to {@link byoAutoSeedModels} as `demotedVendors`, so a
   *  rejected account stops LEADING the seed. Resolved by the caller because the
   *  alert is keyed per tenant and this service has no tenant id — the same seam that
   *  already threads `byoVendorPriority` (`TenantLlmCredentials.alertedVendors`).
   *  Demotion only: the vendor stays in the seed, one position back, because a
   *  `capacity` alert self-heals and removal would silently change the funding source. */
  byoAlertedVendors?: readonly string[];
  /** Shared precedence ranks for provider accounts. Unlike `byoVendorPriority`,
   * this preserves gaps occupied by OpenRouter connections so both kinds can
   * interleave in one ordered list. */
  byoProviderPriorities?: readonly { vendor: string; priority: number | null }[];
  /**
   * Run vendors that declare `requiresLocalEgress` from the tenant's OWN connected
   * runtime instead of from the Worker — see `hostEgress.ts`.
   *
   * Resolved per request by the caller (which knows the tenant) rather than here,
   * because it is a tenant fact, not a plan fact. Absent = direct egress for
   * everything, which is the behaviour every other vendor has always had.
   */
  hostEgress?: VendorEgress | null;
  /** Named OpenRouter registrations and their selected model sets. */
  openRouterConnections?: readonly OpenRouterConnection[];
  /** Bare OpenRouter model id -> tenant key for keyed registrations. */
  openRouterModelKeys?: Readonly<Record<string, string>>;
  /** Each connected vendor's SELECTED models as tenant-keyed refs (1165), keyed by
   *  dispatch vendor. Replaces that vendor's single flagship in the BYO seed — see
   *  {@link byoAutoSeedModels}. Resolved per tenant (`TenantLlmCredentials.byoSelectedModels`). */
  byoSelectedModels?: Readonly<Record<string, readonly string[]>>;
  /** A tenant has selected BYO execution, even if every stored credential is
   *  temporarily unresolved. Prevents an expired/revoked key from silently
   *  changing the funding source to BuilderForce's shared pool. */
  byoRequired?: boolean;
  /** What the tenant CONFIGURED (a stored credential row per provider) and, for each
   *  provider that could not be resolved this call, WHY. Diagnostics only — routing
   *  never reads it. It exists so a fail-closed BYO 503 can NAME the providers and the
   *  models it walked instead of asserting a bare "no configured provider is usable",
   *  which reads as a lie to an operator looking at four connected accounts in the UI.
   *  Sourced from {@link TenantLlmCredentials} (`configuredProviders` +
   *  `unresolvedReasons`), the same fields behind `x-builderforce-byo-unresolved`. */
  byoDiagnostics?: ByoDiagnostics;
}

/** Configured-vs-resolved BYO state, carried purely so a fail-closed 503 can explain
 *  itself. Mirrors the {@link TenantLlmCredentials} fields it is built from. */
export interface ByoDiagnostics {
  /** Every provider with a stored credential row — what the UI shows as "connected". */
  configuredProviders?: readonly string[];
  /** provider → why it produced no usable credential this call (`revoked`, `expired`,
   *  `undecryptable`, …). Only populated for a configured-but-unresolved provider. */
  unresolvedReasons?: Readonly<Record<string, string>>;
}
