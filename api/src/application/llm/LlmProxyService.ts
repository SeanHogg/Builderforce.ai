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
 * Single entry point:
 *   - `complete(body)` — chat completion. Routing is shape-driven: presence of
 *     `tools`, `response_format`, image content blocks, etc., influences the
 *     candidate chain inside the pool. Callers do not pass routing intents.
 */

import {
  CascadeExhaustedError,
  catalogEntry,
  dispatchVendor,
  dispatchVendorStream,
  kindForStatus,
  autoRoutableModelsByTier,
  parseVendorPrefix,
  tierForModel,
  vendorForModel,
  vendorKeyBound,
  passthroughVendorKeys,
  MAX_VENDOR_CALL_TIMEOUT_MS,
  SCHEMA_TOO_COMPLEX_REASON,
  WorkerSubrequestExhaustedError,
  RequestAbortedError,
  VendorFatalError,
  type AiCapability,
  type DispatchAttempt,
  type VendorEnv,
  type VendorId,
} from './vendors';
// Consumed by the service below AND re-exported at the bottom of this file, so
// callers that still import them from 'LlmProxyService' keep working.
import { checkResponseFormatConformance } from './responseFormat';
import {
  capabilitiesForModel,
  inferShape,
  isQualityCriticalUseCase,
  reorderPoolByShape,
  reorderPoolForCoding,
  reorderPoolForQuality,
  stripStandardFields,
} from './poolRouting';
import { composeFreeCappedCascade, buildCooldownPredicate } from './cascadeComposer';
import { sanitizeRequestToolCalls, restoreResponseToolNames, restoreStreamToolNames } from './toolNameSanitizer';
import {
  loadCooldownExpiries,
  loadCooldowns,
  loadCooledVendors,
  loadCooledVendorExpiries,
  recordFailure,
} from '../../infrastructure/auth/cooldownStore';
import { validateJsonSchema } from './jsonSchemaValidator';
import { parseClientReasoningIntent } from './reasoningCapability';
import { estimateTokensFromChars } from './tokenUsage';
import type { ActionType } from './actionTypes';
import { PROVIDER_VENDOR_MAP, byoVendorIdsFromCredentials, type TenantVendorKeys } from './tenantProviderKeyService';
import {
  loadDemotedVendors,
  recordVendorUpstreamFault,
  recordVendorUpstreamSuccess,
} from './vendors/vendorHealth';

// ─────────────────────────────────────────────────────────────────────────────
// Collaborators split out of this file (2026-07-26). Re-exported here so the
// modules that import them from 'LlmProxyService' are unaffected — the split is
// about where the code LIVES, not about churning every call site.
//
//   modelPool      — which models exist, in what order, for which plan (leaf).
//   poolRouting    — in what order should the pool be tried for THIS request?
//   responseFormat — does a model's reply satisfy the requested response_format?
// ─────────────────────────────────────────────────────────────────────────────
import {
  CODING_BACKSTOP_MODELS,
  CODING_DEFAULT_MODEL,
  CODING_FREE_ATTEMPT_BUDGET,
  CODING_MODEL_POOL,
  CODING_PREMIUM_FALLBACK_MODELS,
  COOLDOWN_PREFETCH_LIMIT,
  FREE_ATTEMPT_BUDGET,
  FREE_MODEL_POOL,
  FREE_VENDOR_CALL_TIMEOUT_MS,
  GUARANTEED_BACKSTOP_MODEL,
  PREFERRED_POOL_SIZE,
  PREMIUM_FALLBACK_MODELS,
  PREMIUM_PRIORITY_POOL,
  PREMIUM_VENDOR_CALL_TIMEOUT_MS,
  PRO_MODEL_POOL,
  byoAutoSeedModels,
  canonicalModelId,
  explicitModelPreemptsByo,
  freeAttemptBudgetForPlan,
  isKnownModel,
  isPaidOverflowModel,
  resolveCacheTtl,
  resolveStrictPin,
  resolveVendorTimeoutOverride,
} from './modelPool';
export * from './modelPool';
// ---------------------------------------------------------------------------
// Public types — kept stable for callers (llmRoutes, ideAiRoutes)
// ---------------------------------------------------------------------------

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
   *  strict_unavailable | schema_nonconforming | request_error |
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

/**
 * THE single place a {@link ProxyResult}'s HTTP Response body is unwrapped into its first
 * chat choice. `ProxyResult.response` is an HTTP `Response` (a JSON body), NOT the parsed
 * object — every consumer MUST `await` its `.json()`. Reading `.choices` straight off the
 * Response (as several call sites historically did) silently yields `undefined` and
 * empties EVERY reply regardless of what the model returned. Centralising the unwrap here
 * kills that whole class of bug and the extraction duplication that let it hide in one
 * surface while working in others.
 *
 * The Response is CLONED, so callers may still read `result.response` (`.status` / `.ok`)
 * and background metering may re-read the original body. A non-2xx or non-JSON body yields
 * empty fields (never throws), so a caller can gate on `result.response.status` first and
 * treat `content === ''` as "no usable output".
 */
export async function readProxyChoice(result: { response: Response }): Promise<ProxyChoice> {
  const body = (await result.response.clone().json().catch(() => null)) as
    | { choices?: Array<{ message?: ProxyChoiceMessage; finish_reason?: string }> }
    | null;
  const choice = body?.choices?.[0];
  const message = choice?.message;
  return {
    message,
    content: (typeof message?.content === 'string' ? message.content : '').trim(),
    toolCalls: message?.tool_calls ?? [],
    finishReason: choice?.finish_reason ?? '',
    body: body as Record<string, unknown> | null,
  };
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
}

// ---------------------------------------------------------------------------
// Cooldown tracking lives in `infrastructure/auth/cooldownStore.ts` — KV-backed
// when the namespace is bound, in-memory fallback otherwise. See that module
// for the classification → TTL table.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Round-robin cursor (per-isolate)
// ---------------------------------------------------------------------------

/** Round-robin cursor (per-isolate). Boxed in an object so it can be shared
 *  by reference with `composeFreeCappedCascade` — the helper increments it
 *  in place, so chat and image cascades both contribute to the same rotation
 *  on a single Worker isolate (no contention, just a counter). */
const chatRequestCursor: { value: number } = { value: 0 };

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

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

export class LlmProxyService {
  private readonly env: ProxyEnv;
  private readonly modelPool: readonly string[];
  private readonly preferredPoolSize: number;
  private readonly productName: ProductName;
  private readonly isPro: boolean;
  private readonly vendorCallTimeoutMs: number | undefined;
  private readonly backstopModels: readonly string[];
  private readonly disablePaidOverflow: boolean;
  private readonly codingOnly: boolean;
  private readonly freeBudget: number;
  private readonly anthropicOAuthToken: string | null;
  private readonly openaiCodexAuth: { accessToken: string; accountId: string } | null;
  private readonly xaiOAuthToken: string | null;
  private readonly tenantVendorKeys: TenantVendorKeys;
  private readonly byoVendorPriority: readonly string[];
  private readonly byoRequired: boolean;
  private readonly byoDiagnostics: ByoDiagnostics;

  constructor(env: ProxyEnv, options?: LlmProxyOptions) {
    this.env = env;
    this.modelPool = options?.modelPool ?? FREE_MODEL_POOL;
    this.preferredPoolSize = Math.min(options?.preferredPoolSize ?? PREFERRED_POOL_SIZE, this.modelPool.length);
    this.productName = options?.productName ?? 'builderforceLLM';
    this.isPro = this.productName === 'builderforceLLMPro' || this.productName === 'builderforceLLMTeams';
    this.vendorCallTimeoutMs = options?.vendorCallTimeoutMs;
    this.backstopModels = options?.backstopModels?.length ? options.backstopModels : [GUARANTEED_BACKSTOP_MODEL];
    this.disablePaidOverflow = options?.disablePaidOverflow ?? false;
    this.codingOnly = options?.codingOnly ?? false;
    this.freeBudget = options?.freeBudget && options.freeBudget > 0 ? options.freeBudget : FREE_ATTEMPT_BUDGET;
    this.anthropicOAuthToken = options?.anthropicOAuthToken ?? null;
    this.openaiCodexAuth = options?.openaiCodexAuth ?? null;
    this.xaiOAuthToken = options?.xaiOAuthToken ?? null;
    this.tenantVendorKeys = options?.tenantVendorKeys ?? {};
    this.byoVendorPriority = options?.byoVendorPriority ?? [];
    this.byoRequired = options?.byoRequired ?? false;
    this.byoDiagnostics = options?.byoDiagnostics ?? {};
    // Mark every vendor a BYO key overrides as tenant-funded up front, so any
    // resolution landing on that vendor this request is stamped byo (cost 0,
    // on-prem/VSIX exempt). vendorEnv() applies the matching key override.
    for (const provider of Object.keys(this.tenantVendorKeys) as Array<keyof TenantVendorKeys>) {
      if (this.tenantVendorKeys[provider]) this.tenantFundedVendors.add(PROVIDER_VENDOR_MAP[provider].vendorId as VendorId);
    }
  }

  /** True when this result was served by the tenant's connected Claude SUBSCRIPTION
   *  (the `anthropic` vendor with an OAuth token bound) — so it's free to us and
   *  must NOT be metered as paid-overflow. The vendor only ever uses OAuth when the
   *  token is present, so vendor=anthropic + token bound ⇒ subscription-funded. */
  private isSubscriptionFunded(result: ProxyResult): boolean {
    return (this.anthropicOAuthToken != null && result.resolvedVendor === 'anthropic')
      || (this.openaiCodexAuth != null && result.resolvedVendor === 'openai-codex')
      || (this.xaiOAuthToken != null && result.resolvedVendor === 'xai-oauth');
  }

  /** Gateway vendor ids the tenant can serve from their OWN connected account this
   *  request — a BYO api-key (any provider) OR a connected subscription (Anthropic /
   *  ChatGPT-Codex / SuperGrok) on its OAuth vendor. Derived through the SHARED
   *  {@link byoVendorIdsFromCredentials} so the ids the gateway SEEDS
   *  ({@link byoAutoSeedModels}) can never disagree with the ids the BYO boundary
   *  filter in {@link buildCandidateChain} keeps. */
  private get connectedByoVendors(): Set<string> {
    // Memoized: the credentials are fixed for this instance's lifetime, and this set is
    // read per-candidate by the BYO chain filter and per-attempt by the cooldown scope
    // check — rebuilding it in those loops was pure waste.
    this.connectedByoVendorsMemo ??= byoVendorIdsFromCredentials({
      anthropicOAuthToken: this.anthropicOAuthToken,
      openaiCodexAuth: this.openaiCodexAuth,
      xaiOAuthToken: this.xaiOAuthToken,
      vendorKeys: this.tenantVendorKeys,
    });
    return this.connectedByoVendorsMemo;
  }

  private connectedByoVendorsMemo?: Set<string>;

  /**
   * Cooldown SCOPE — is this vendor served by the tenant's OWN credential this request?
   *
   * The cooldown store is keyed globally (`cooldown:<vendor>:<model>`, see
   * cooldownStore.ts), which is exactly right for the operator's SHARED keys: one 429 on
   * our OpenRouter key really does mean the next request should skip that model. It is
   * wrong in BOTH directions once the call rides a tenant's own account:
   *
   *   - READ: a bench written by our shared key — or by another tenant's lapsed
   *     subscription — says nothing about THIS owner's account. Gating on it hides a
   *     healthy credential, and on the strict-pin path turns it into a hard 503 that the
   *     caller reads as "your provider is unavailable" (which is how a green Integrations
   *     card could sit next to a failing Test connection).
   *   - WRITE: an owner's own 401 would bench that model for our shared key AND for every
   *     other tenant, so one expired token starves the pool for everybody.
   *
   * So a vendor the tenant can serve themselves is exempt from the cooldown keyspace
   * entirely. Its failure signal lives in two stores that ARE tenant-scoped:
   * `vendorHealth` (governs BYO seed ORDER) and `providerAuthAlerts` (drives the
   * "reconnect this account" prompt + the daily BYO credential probe's email). This is
   * the same rule the non-strict path already applied via its BYO probe backstop —
   * stated once, here, so strict dispatch, chain composition and cooldown writes agree.
   */
  private isOwnerServedVendor(vendor: string): boolean {
    return this.connectedByoVendors.has(vendor);
  }

  /** Vendors whose call was served with a tenant's OWN BYO credential this
   *  request (populated by {@link vendorEnv} when it overlays a per-tenant key on
   *  the operator env). Combined with the Anthropic-subscription case, this is the
   *  full "the tenant funded it" signal for any provider. */
  private readonly tenantFundedVendors = new Set<VendorId>();

  /** True when the tenant's OWN provider credential served the call — a connected
   *  Claude subscription OR a BYO vendor key (OpenAI/Google/Anthropic). The single
   *  source of truth for ProxyResult.byoFunded, generalizing isSubscriptionFunded
   *  across every provider. */
  private isTenantFunded(result: ProxyResult): boolean {
    return this.isSubscriptionFunded(result) || this.tenantFundedVendors.has(result.resolvedVendor);
  }

  /** BYO is strict when configured OR when at least one credential resolved. */
  private get byoStrict(): boolean {
    return this.byoRequired || this.connectedByoVendors.size > 0;
  }

  /** The premium fallback chain appended to every cascade — empty when the tenant
   *  has exhausted its paid-overflow cap, so the chain composer won't fall through
   *  to a funded model. A CODING run uses the coding-capable chain (paid coders)
   *  so it never resolves onto a general non-coder. Single source for both the
   *  cooldown-prefetch and the chain. */
  private get premiumFallback(): readonly string[] {
    // A usable connected credential makes this a BYO-strict request. Never append
    // BuilderForce-funded models behind the owner's account: an upstream failure
    // must stay inside the owner's connected providers or surface honestly.
    if (this.disablePaidOverflow || this.byoStrict) return [];
    return this.codingOnly ? CODING_PREMIUM_FALLBACK_MODELS : PREMIUM_FALLBACK_MODELS;
  }

  // --- Public entry points --------------------------------------------------

  /**
   * Forward a chat-completion request through the configured pool.
   *
   * Routing is gateway-owned. The caller's `body.model` (if any) is treated
   * as a *hint* — the gateway puts it at the head of the candidate chain so
   * it's tried first, but the gateway retains the right to advance through
   * its own failover chain when that model is unavailable, on cooldown, or
   * fails. The actual model used is reported via `_builderforce.resolvedModel`
   * so callers can detect substitution and decide whether to retry on their
   * own.
   *
   * Vendor prefixes (`openrouter/<id>`, `cerebras/<id>`, `ollama/<id>`) route
   * to the named vendor explicitly. Bare ids fall back to catalog lookup.
   *
   * When `body.model` is unset, shape-based reordering (tools / response_format
   * / vision content) ranks the most-capable models in the pool first.
   */
  async complete(
    body: ChatCompletionRequest,
    requestHeaders?: Record<string, string>,
    traceId?: string,
    signal?: AbortSignal,
    opts?: { estimatedTokens?: number },
  ): Promise<ProxyResult> {
    const startedAt = Date.now();
    const tid = traceId ?? newTraceId();
    // Rewrite a superseded pin to its live successor BEFORE anything reads it. This is
    // the gateway-side seam of {@link canonicalModelId}: `body.model` is whatever the
    // caller had stored (an agent base_model, a lane default, an SDK pin), and that can
    // be months old. Rewriting here covers the strict-pin branch and the chained branch
    // together, so a retired id can never reach `dispatch` — and can never be filtered
    // out of the BYO seed as "not dispatchable", which is what turned a stale Opus pin
    // into a bare `byo_unavailable` with four providers connected.
    const rawCallerModel = (body as { model?: unknown }).model;
    const callerModel = typeof rawCallerModel === 'string' && rawCallerModel.trim()
      ? canonicalModelId(rawCallerModel)
      : rawCallerModel;
    // `modelStrict` OR the public `strict` alias → single-model hard pin. Both
    // funnel through `resolveStrictPin` (which also enforces the "model present"
    // precondition) so the service can't disagree with the route's gate.
    const wantsStrict = resolveStrictPin(body as { model?: unknown; modelStrict?: unknown; strict?: unknown });

    // Strict-pin path: single-model dispatch, no chain, no failover. Cooldown
    // and missing-vendor-key are the only pre-flight gates; if either fails
    // the request returns 503 `model_unavailable` instead of falling through.
    if (wantsStrict) {
      return this.finalize(
        await this.dispatchStrict(callerModel as string, body, requestHeaders),
        tid, startedAt, [callerModel as string],
      );
    }

    // 1) Pool composition is already TTFT-ordered (Cerebras → Ollama → NVIDIA
    //    → OpenRouter) because `modelsByTier` walks the registry's MODULES
    //    array in priority order. Shape-based reorder then floats capable
    //    models (tools / structured / vision) to the head within that order.
    const reorderedPool = reorderPoolByShape(body, this.modelPool);

    // 1b) Quality-critical useCase (resume tailoring, cover letters, …): re-rank
    //     the shape-sorted pool so the best models the PLAN unlocks lead (premium
    //     writers for paid; a no-op within a free pool). For a strict json_schema
    //     it still keeps a low-ceiling model (Gemini) last within its tier, so the
    //     two routing rules compose. The capability order from the shape sort is
    //     preserved as the within-tier tiebreak.
    const useCase = (body as { useCase?: unknown }).useCase;
    const useCaseStr = typeof useCase === 'string' ? useCase : undefined;
    const qualityCritical = isQualityCriticalUseCase(useCaseStr);
    let routedPool: readonly string[] = qualityCritical
      ? reorderPoolForQuality(reorderedPool, {
          strictSchema: (body as { response_format?: { type?: string } }).response_format?.type === 'json_schema',
        })
      : reorderedPool;

    // 1b2) Agentic tool-loop (the request carries `tools`) is coding-critical: a
    //      long tool-calling analysis turn served by a cheap generalist loops
    //      without converging. `reorderPoolByShape` above floats every tools-capable
    //      model equally, so a merely-tool-advertising generalist can still lead its
    //      bucket; this pass promotes the real CODING_MODEL_POOL drivers ahead of
    //      them. A pure permutation of the plan pool — free tenants only float their
    //      own free coding models (no plan escalation). Skipped for quality-critical
    //      traffic (output-quality writers, ranked by tier just above).
    if (!qualityCritical && inferShape(body).hasTools) {
      routedPool = reorderPoolForCoding(routedPool);
    }

    // 1c) Context-fit first pass: when the caller estimates how many tokens the
    //     turn will send, drop pool models whose catalog window can't hold it, so
    //     a small-window model isn't SEEDED into a context it would 413 on (the
    //     97K-into-32K bug — the exact "Brain dies after several executions"
    //     failover). Never empties the pool (see modelsFittingContext); oversized
    //     requests still fall through to the normal cascade + 413 failover.
    const fittedPool = modelsFittingContext(routedPool, opts?.estimatedTokens);

    // 2) Caller hint goes at the head; rest of the pool follows.
    //    `callerModel` was extracted at the top of this function for the strict-pin
    //    branch; reuse it here for the chained path. With NO caller model, the
    //    owner's connected accounts lead the pool (soft seed) so an auto-select turn
    //    uses the tenant's OWN premium frontier model(s) before the free/paid tiers —
    //    registration-driven (one flagship per connected provider, strongest tier
    //    first), NOT a fixed vendor; Opus/Sonnet for Anthropic per turn shape. The
    //    cascade then fails over across the owner's other connected accounts, and the
    //    plan pool stays behind them all as final fallback. See byoAutoSeedModels.
    // A non-strict caller `model` is a HINT, not an override of the tenant's connected
    // account. Honour it at the head ONLY when it PREEMPTS the BYO seed — nothing
    // connected, or the model is itself served by a connected BYO vendor (see
    // {@link explicitModelPreemptsByo}). A NON-BYO caller model (the VS Code Brain's
    // configured `defaultModel`, a stale coder default, any SDK caller's pin) must NOT
    // shadow the connected flagship: otherwise a tenant with a connected Claude account
    // silently runs a weak free coder — the "should have selected Opus" regression. This
    // is the SAME invariant `byoAwareModel`/`explicitModelPreemptsByo` enforce on the
    // tenantProxy + /v1/messages paths; applying it centrally HERE stops the gateway
    // completion seed from drifting from them (a caller model bypassed the gate before).
    // A shadowed hint still joins the pool just BEHIND the flagship, so it's the first
    // failover after the connected account rather than being dropped.
    const hasCallerModel = typeof callerModel === 'string' && callerModel.length > 0;
    const connectedByo = this.connectedByoVendors;
    const callerLeads = hasCallerModel && explicitModelPreemptsByo(callerModel as string, connectedByo);
    // Demote any connected vendor on a 5xx streak out of the LEAD position (it stays
    // in the seed — see `byoAutoSeedModels`). Returns an empty set and issues no reads
    // when nothing is connected, so the non-BYO path is untouched.
    const demotedVendors = await loadDemotedVendors(this.env, connectedByo);
    const byoSeeds = byoAutoSeedModels(connectedByo, {
      agentic: this.codingOnly,
      vendorPriority: this.byoVendorPriority,
      ...(demotedVendors.size ? { demotedVendors } : {}),
    });
    // An honoured caller model LEADS, but it never stands alone: the tenant's OTHER
    // connected accounts follow it as failover. BYO is an execution boundary — the
    // chain composer below drops every operator-funded model — so a lead-only head
    // means a single cooled/faulting provider ends the request with `byo_unavailable`
    // while three other connected accounts sit unused. (The measured stall: a cloud run
    // pinned `claude-opus-4-8` with Anthropic, xAI, OpenAI AND Meta connected and never
    // tried the other three.) Dedup keeps the lead's position when it IS a flagship.
    const seedHead: readonly string[] = callerLeads
      ? [callerModel as string, ...byoSeeds.filter((m) => m !== callerModel)]
      : byoSeeds;
    const basePool: readonly string[] = (hasCallerModel && !callerLeads && !fittedPool.includes(callerModel as string))
      ? [callerModel as string, ...fittedPool]
      : fittedPool;
    const seed: readonly string[] = seedHead.length > 0
      ? [...seedHead, ...basePool.filter((m) => !seedHead.includes(m))]
      : basePool;

    // 3) Pre-fetch cooldown state for the leading seed slice + premium fallback
    //    (KV-backed when bound, in-memory fallback otherwise). The seed is
    //    truncated to `COOLDOWN_PREFETCH_LIMIT` entries to bound subrequest
    //    cost — see that constant for the trade-off rationale. Vendor
    //    cooldown short-circuits the per-model walk when one upstream's key
    //    is globally throttled; the fallback models are included so the
    //    chain composer skips any individually cooled entry instead of
    //    firing a doomed retry against a saturated endpoint.
    const seedPrefix = seed.slice(0, COOLDOWN_PREFETCH_LIMIT);
    const fallbackPairs = this.premiumFallback.map((m) => ({ vendor: vendorForModel(m), model: m }));
    const seedVendors = Array.from(new Set([
      ...seedPrefix.map((m) => vendorForModel(m)),
      ...fallbackPairs.map((p) => p.vendor),
    ]));
    // Never ASK about a vendor the tenant serves themselves: the global keyspace can't
    // speak for the owner's account ({@link isOwnerServedVendor}). Filtering the pairs
    // BEFORE the read (rather than the results after) both applies the exemption and drops
    // those KV subrequests. Without it, a stale bench on connected provider A silently
    // demotes it below connected provider B — violating the tenant's own BYO precedence —
    // and, once it covers every connected model, composes an empty chain that only the
    // probe backstop below rescues.
    const [cooledSet, cooledVendors] = await Promise.all([
      loadCooldowns(this.env, [
        ...seedPrefix.map((m) => ({ vendor: vendorForModel(m), model: m })),
        ...fallbackPairs,
      ].filter((p) => !this.isOwnerServedVendor(p.vendor))),
      loadCooledVendors(this.env, seedVendors.filter((v) => !this.isOwnerServedVendor(v))),
    ]);
    // Pinned hint bypasses vendor-level cooldown so a caller-explicit paid model
    // (`anthropic/claude-3-haiku`) gets tried even when the same vendor's free
    // key has 429'd its way into vendor cooldown. Per-model cooldown still
    // applies — we won't retry a model that *itself* just failed.
    // The seed's head (caller pin OR the strongest connected-BYO flagship) bypasses
    // vendor-level cooldown so the owner's own account is still tried even when that
    // vendor's operator key has 429'd its way into vendor cooldown. Per-model cooldown
    // still applies.
    const pinnedHint = seedHead.length > 0 ? seedHead[0] : undefined;
    // Pass seedHead as the cascade HEAD so a deliberately-seeded connected-BYO flagship
    // (or explicit pin) leads verbatim — otherwise a PREMIUM/ULTRA seed falls behind the
    // free pool and the connected account is tried last (or never). See composeFreeCappedCascade.
    const candidates = this.buildCandidateChain(seed, cooledSet, cooledVendors, pinnedHint, seedHead);
    if (candidates.length === 0) {
      if (this.byoStrict) {
        // Nothing composed — but "every connected model is COOLED" is not the same as
        // "the tenant has no usable provider", and only the latter deserves a 503.
        // Cooldown protects OUR shared keys from being hammered by fan-out; the owner's
        // own account gets at most this one attempt per request, and failing closed here
        // is what turned a transient bench into a permanently stalled ticket (autonomy's
        // failure breaker trips after 3). So probe the connected flagships once, ignoring
        // per-model cooldown, and surface the REAL upstream error if they still fail.
        const probe = seedHead.filter((m) => connectedByo.has(vendorForModel(m)));
        if (probe.length > 0) {
          const probed = await this.dispatch(probe, body, requestHeaders, { signal });
          probed.paidOverflow = false; // BYO-only chain — always the tenant's own account.
          return this.finalize(probed, tid, startedAt, probe, probed.response.status < 400 ? 'success' : undefined);
        }
        // Genuinely nothing to try. Report WHAT was walked, not just that nothing was:
        // the seed we composed, the vendors that actually resolved, what the tenant has
        // configured (with the per-provider reason it was unusable), and anything the
        // cooldown gate removed. Passing `seed` (not `[]`) as the candidate chain also
        // makes the cloud loop's ` · chain: …` suffix report the real list.
        return this.finalize(
          byoUnavailableResult(seed[0] ?? 'byo-required', {
            attempted: seed,
            connectedVendors: [...connectedByo],
            cooled: seed.filter((m) => cooledSet.has(`${vendorForModel(m)}/${m}`) || cooledVendors.has(vendorForModel(m))),
            configuredProviders: this.byoDiagnostics.configuredProviders ?? [],
            unresolvedReasons: this.byoDiagnostics.unresolvedReasons ?? {},
          }),
          tid, startedAt, seed, 'byo_unavailable',
        );
      }
      // Every model in the seed + premium fallback list is on cooldown. The
      // guaranteed paid backstop (credited key) is the last chance before we
      // surface a hard failure — unless the tenant has exhausted its paid-overflow
      // cap, in which case we don't fund another paid call.
      const backstop = this.disablePaidOverflow ? null : await this.dispatchBackstop(body, requestHeaders);
      if (backstop) {
        // Tenant-funded (a connected subscription OR a BYO api-key) is free to us →
        // never meter it as overflow.
        backstop.paidOverflow = !this.isTenantFunded(backstop);
        return this.finalize(backstop, tid, startedAt, [...this.backstopModels], 'success');
      }
      return this.finalize(
        this.exhaustedResponse(
          seed.slice(),
          0,
          new Error('All candidate models are on cooldown. Retry in a minute or two.'),
        ),
        tid, startedAt, seed.slice(), 'all_cooldown',
      );
    }

    let primary = await this.dispatch(candidates, body, requestHeaders, { signal });
    if (primary.response.status < 400) {
      // Mark overflow when the primary cascade itself landed on an appended
      // premium-fallback model (vs a plan-pool model) so the route meters it —
      // UNLESS the tenant's OWN account served it (a connected subscription OR a BYO
      // api-key — free to us; see isTenantFunded), e.g. an owner whose connected-BYO
      // flagship (claude-*) seeded the head and served the turn on their own account.
      primary.paidOverflow = isPaidOverflowModel(primary.resolvedModel) && !this.isTenantFunded(primary);
      return this.finalize(primary, tid, startedAt, candidates);
    }

    // A genuine malformed request (400/422) can't be fixed by failover OR by
    // relaxing the schema — surface it straight away.
    if (primary.outcome === 'request_error') {
      return this.finalize(primary, tid, startedAt, candidates);
    }

    // AUTO-DOWNGRADE: every candidate rejected the `response_format.json_schema`
    // as too complex for its constrained-decoding engine. Rather than hard-fail a
    // feature that just needs a structured answer (hired.video's resume-tailor),
    // relax the request to loose `json_object` mode — no schema, so no
    // constrained-decoding ceiling — and re-run the cascade. The model still
    // returns JSON (the schema is carried into the prompt as guidance); the caller
    // validates it client-side. This is what turns a terminal schema rejection
    // into a delivered result. The downgraded body also feeds the backstop below,
    // so even a saturated pool floors onto a funded model in json_object mode.
    let effectiveBody = body;
    if (primary.outcome === 'schema_too_complex') {
      const downgraded = downgradeResponseFormat(body);
      if (!downgraded) {
        // No strict json_schema to relax (shouldn't happen for this outcome) —
        // surface the terminal error honestly.
        return this.finalize(primary, tid, startedAt, candidates);
      }
      effectiveBody = downgraded;
      const retry = await this.dispatch(candidates, downgraded, requestHeaders, { signal });
      // Carry the schema-rejection trace in front of the retry's own attempts so
      // the diagnostic record shows BOTH the rejection and the recovery.
      retry.failovers = [...primary.failovers, ...retry.failovers];
      retry.attempts  = [...(primary.attempts ?? []), ...(retry.attempts ?? [])];
      retry.schemaDowngraded = true;
      if (retry.response.status < 400) {
        retry.paidOverflow = isPaidOverflowModel(retry.resolvedModel) && !this.isTenantFunded(retry);
        return this.finalize(retry, tid, startedAt, candidates, 'success');
      }
      // Downgraded cascade still failed for a NON-schema reason (saturation, etc.)
      // — fall through to the funded backstop with the downgraded body.
      primary = retry;
    }

    // Primary cascade failed (saturated free pool, cascade-exhausted 429, etc.).
    // Fire the guaranteed paid backstop on the credited key before giving up so
    // the caller gets a real answer instead of `AI_UNAVAILABLE`. On success,
    // splice the primary cascade's diagnostics in front of the backstop's so the
    // trace still records everything that was tried. Uses `effectiveBody` so a
    // schema-downgraded request floors onto the backstop in json_object mode too.
    const backstop = this.disablePaidOverflow ? null : await this.dispatchBackstop(effectiveBody, requestHeaders);
    if (backstop) {
      backstop.failovers = [...primary.failovers, ...backstop.failovers];
      backstop.retries   = primary.retries + backstop.retries;
      backstop.attempts  = [...(primary.attempts ?? []), ...(backstop.attempts ?? [])];
      backstop.paidOverflow = !this.isTenantFunded(backstop);
      if (effectiveBody !== body) backstop.schemaDowngraded = true;
      return this.finalize(backstop, tid, startedAt, [...candidates, ...this.backstopModels], 'success');
    }
    return this.finalize(primary, tid, startedAt, candidates);
  }

  /** Stamp request-level diagnostics onto a ProxyResult before it leaves
   *  complete(). Single place that owns the trace id, total duration, candidate
   *  chain, final status, rolled-up classification, and outcome — so every
   *  return path (strict / cooldown / dispatched) is uniform. */
  private finalize(
    result: ProxyResult,
    traceId: string,
    startedAt: number,
    candidateChain: readonly string[],
    outcomeOverride?: string,
  ): ProxyResult {
    result.traceId = traceId;
    result.durationMs = Date.now() - startedAt;
    result.status = result.response.status;
    if (!result.candidateChain) result.candidateChain = [...candidateChain];
    if (!result.classification) result.classification = classificationFromFailovers(result.failovers);
    if (outcomeOverride) result.outcome = outcomeOverride;
    else if (!result.outcome) result.outcome = result.response.status < 400 ? 'success' : 'cascade_exhausted';
    // Stamp the tenant-funding signal once, on the single path every result
    // leaves complete() through, so the route can mark the usage row `byo`.
    if (result.byoFunded === undefined) result.byoFunded = this.isTenantFunded(result);
    return result;
  }

  /**
   * Strict-pin dispatch — single model, no chain, no failover. Used when
   * `body.modelStrict === true`. Pre-flight gates:
   *   - vendor key bound? otherwise 503 `model_unavailable` (reason: `vendor_key_unconfigured`)
   *   - model on cooldown?  otherwise 503 `model_unavailable` (reason: `cooldown`)
   * If both pass, dispatches a chain of length 1. Vendor errors propagate
   * verbatim instead of being absorbed into a chain-exhausted envelope.
   */
  private async dispatchStrict(
    model: string,
    body: ChatCompletionRequest,
    requestHeaders?: Record<string, string>,
  ): Promise<ProxyResult> {
    const vendor = vendorForModel(model);
    if (this.byoStrict && !this.connectedByoVendors.has(vendor)) {
      // Name the vendor the pin needs AND the vendors that actually resolved — the bare
      // reason code can't distinguish "you pinned a model on an account you never
      // connected" from "the account IS connected but its credential didn't resolve".
      const usable = [...this.connectedByoVendors];
      return strictUnavailableResult(model, 'byo_provider_required', {
        requiredVendor: vendor,
        connectedVendors: usable,
        configuredProviders: this.byoDiagnostics.configuredProviders ?? [],
        unresolvedReasons: this.byoDiagnostics.unresolvedReasons ?? {},
      });
    }
    if (!vendorKeyBound(this.vendorEnv(), vendor)) {
      return strictUnavailableResult(model, 'vendor_key_unconfigured');
    }

    // A vendor the tenant serves from their OWN account is exempt from the global
    // cooldown keyspace ({@link isOwnerServedVendor}) — the pinned model IS the owner's
    // account, so it gets its one attempt and surfaces the REAL upstream error instead of
    // a synthetic 503 inherited from someone else's key. Skipping the gate also drops two
    // KV subrequests from every BYO strict-pin dispatch.
    if (!this.isOwnerServedVendor(vendor)) {
      const [cooledSet, cooledVendors] = await Promise.all([
        loadCooldowns(this.env, [{ vendor, model }]),
        loadCooledVendors(this.env, [vendor]),
      ]);
      if (cooledVendors.has(vendor) || cooledSet.has(`${vendor}/${model}`)) {
        return strictUnavailableResult(model, 'cooldown');
      }
    }

    return this.dispatch([model], body, requestHeaders);
  }

  /** Per-model status with cooldown + key-bound info — used by /v1/models.
   *  `capabilities` lets SDK consumers discover image/PDF-reading models
   *  (`vision` / `ocr`) and tool/structured-output support without hard-coding ids. */
  async status(): Promise<Array<{ model: string; preferred: boolean; available: boolean; cooldownUntil?: number; vendor: VendorId; vendorCooledUntil?: number; keyBound: boolean; capabilities: AiCapability[] }>> {
    const env = this.vendorEnv();
    const poolVendors = Array.from(new Set(this.modelPool.map((m) => vendorForModel(m))));
    const [cooledMap, vendorCooledMap] = await Promise.all([
      // `'display'` mode (not the default `'gate'`) so a model still inside its
      // cooldown TTL but past its `trialAfter` half-open instant ([1235]) keeps
      // reporting its full `until` — the admin UI can show the "cooling, probing"
      // countdown for that ~5-min tail instead of flipping to `available:true`.
      loadCooldownExpiries(this.env, this.modelPool.map((m) => ({ vendor: vendorForModel(m), model: m })), 'display'),
      loadCooledVendorExpiries(this.env, poolVendors),
    ]);
    return this.modelPool.map((model, i) => {
      const vendor      = vendorForModel(model);
      const until       = cooledMap.get(`${vendor}/${model}`);
      const vendorUntil = vendorCooledMap.get(vendor);
      const keyBound    = vendorKeyBound(env, vendor);
      return {
        model,
        vendor,
        preferred: i < this.preferredPoolSize,
        keyBound,
        available: keyBound && vendorUntil === undefined && until === undefined,
        capabilities: capabilitiesForModel(model),
        ...(until       !== undefined && until       > 0 ? { cooldownUntil:       until       } : {}),
        ...(vendorUntil !== undefined && vendorUntil > 0 ? { vendorCooledUntil:   vendorUntil } : {}),
      };
    });
  }

  // --- Internals ------------------------------------------------------------

  /**
   * Compose the candidate chain for one request via the shared
   * `composeFreeCappedCascade` helper.
   *
   * Per-model cooldown excludes specific models that recently failed. Per-vendor
   * cooldown is the wider net: when one upstream key is globally throttled
   * (e.g. all OpenRouter free-tier 429s), the vendor itself is cooled and we
   * skip every model owned by that vendor in one pass — instead of walking
   * many models on the saturated key one 429 at a time. See
   * `maybeTripVendorCooldown` in cooldownStore.ts for the trip conditions.
   *
   * The FREE cap is the headline guarantee: regardless of how saturated the
   * upstream free pool is, every cascade tries at most 2 free models before
   * falling through to the premium fallback — so callers always see a
   * successful response instead of `cascade-exhausted` 429s.
   */
  private buildCandidateChain(
    seed: readonly string[],
    cooledSet: Set<string>,
    cooledVendors: Set<VendorId>,
    pinnedModel?: string,
    head?: readonly string[],
  ): string[] {
    const candidates = composeFreeCappedCascade({
      seed,
      ...(head && head.length ? { head } : {}),
      premiumFallback: this.premiumFallback,
      freeBudget: this.freeBudget,
      tierOf: tierForModel,
      isUnavailable: buildCooldownPredicate({
        cooledModels:  cooledSet,
        cooledVendors,
        vendorOf:      vendorForModel,
        ...(pinnedModel !== undefined ? { pinnedModel } : {}),
      }),
      cursor: chatRequestCursor,
    });
    // BYO is an execution boundary, not merely a preference. Once at least one
    // tenant credential resolves, remove every shared/operator-funded vendor from
    // the chain. Multiple connected providers may still fail over among themselves.
    return this.byoStrict
      ? candidates.filter((model) => this.connectedByoVendors.has(vendorForModel(model)))
      : candidates;
  }

  /** Synthesize the env passed to vendors — picks the Pro OpenRouter key when applicable. */
  private vendorEnv(): VendorEnv {
    return {
      OPENROUTER_API_KEY: this.isPro
        ? (this.env.OPENROUTER_API_KEY_PRO ?? this.env.OPENROUTER_API_KEY ?? null)
        : (this.env.OPENROUTER_API_KEY ?? null),
      OPENAI_CODEX_AUTH: this.openaiCodexAuth ? JSON.stringify(this.openaiCodexAuth) : null,
      XAI_OAUTH_TOKEN: this.xaiOAuthToken,
      CEREBRAS_API_KEY:         this.env.CEREBRAS_API_KEY         ?? null,
      NVIDIA_API_KEY:           this.env.NVIDIA_API_KEY           ?? null,
      OLLAMA_API_KEY:           this.env.OLLAMA_API_KEY           ?? null,
      // A tenant BYO Google key overrides the operator key for the `googleai`
      // vendor (marked tenant-funded in the constructor → byo, $0 to us).
      GOOGLE_API_KEY:           this.tenantVendorKeys.google      ?? this.env.GOOGLE_API_KEY ?? null,
      // Direct-Anthropic floor key. Flows through creditedVendorEnv() too (which
      // spreads this) so the coding backstop can reach Claude regardless of plan.
      // A tenant BYO Anthropic api-key overrides it (the subscription/OAuth path
      // is separate, via CLAUDE_OAUTH_TOKEN below).
      CLAUDE_API_KEY:           this.tenantVendorKeys.anthropic   ?? this.env.CLAUDE_API_KEY ?? null,
      // A connected tenant's Claude subscription token — when present the anthropic
      // vendor prefers it over CLAUDE_API_KEY (tenant-funded, $0 to us). Spread into
      // creditedVendorEnv() too, so a backstop landing on Claude also uses it.
      CLAUDE_OAUTH_TOKEN:       this.anthropicOAuthToken         ?? null,
      CLOUDFLARE_AI_API_TOKEN:  this.env.CLOUDFLARE_AI_API_TOKEN  ?? null,
      CLOUDFLARE_ACCOUNT_ID:    this.env.CLOUDFLARE_ACCOUNT_ID    ?? null,
      // OpenAI-compatible commercial vendor keys (openai / groq / deepseek / …).
      // Passed straight through so an explicit `<vendor>/<id>` pin (e.g. from the
      // dataset wizard or model picker) reaches the vendor via the SAME dispatch
      // machinery. Each is autoRoute:false, so an unbound key just means that
      // vendor is skipped — it never affects the default FREE/PRO cascade. The
      // list is derived from `OPENAI_COMPATIBLE_VENDOR_KEYS` so it can't drift
      // from the registered vendors.
      ...passthroughVendorKeys(this.env),
      // A tenant BYO OpenAI key overrides the operator OpenAI key (spread above)
      // for the `openai` vendor — marked tenant-funded → byo, $0 to us.
      ...(this.tenantVendorKeys.openai ? { OPENAI_API_KEY: this.tenantVendorKeys.openai } : {}),
      ...(this.tenantVendorKeys.kimi ? { MOONSHOT_API_KEY: this.tenantVendorKeys.kimi } : {}),
      ...(this.tenantVendorKeys.qwen ? { QWEN_API_KEY: this.tenantVendorKeys.qwen } : {}),
      ...(this.tenantVendorKeys.minimax ? { MINIMAX_API_KEY: this.tenantVendorKeys.minimax } : {}),
      ...(this.tenantVendorKeys.xai ? { XAI_API_KEY: this.tenantVendorKeys.xai } : {}),
      // A tenant BYO Meta AI key powers the `meta` vendor (MUSE models). There is
      // NO operator-level Meta key — this is the ONLY source. When absent the meta
      // vendor no-key-skips at dispatch, same as any other unbound vendor.
      ...(this.tenantVendorKeys.meta ? { META_API_KEY: this.tenantVendorKeys.meta } : {}),
    };
  }

  /**
   * Vendor env that forces the *credited* (Pro) OpenRouter key regardless of the
   * proxy's plan, so the guaranteed backstop can reach paid models even when the
   * request itself came in on the free key. Falls back to the standard key when
   * no Pro key is bound (single-key deployments still get a backstop attempt).
   */
  private creditedVendorEnv(): VendorEnv {
    return {
      ...this.vendorEnv(),
      OPENROUTER_API_KEY: this.env.OPENROUTER_API_KEY_PRO ?? this.env.OPENROUTER_API_KEY ?? null,
    };
  }

  /**
   * Guaranteed paid backstop — see `GUARANTEED_BACKSTOP_MODEL`. Dispatched only
   * after the primary cascade has failed (or every candidate was cooled). Forces
   * the credited key + the extended premium timeout so one low-variance paid
   * model can answer even on the free plan with a saturated free pool.
   *
   * Returns the successful `ProxyResult`, or `null` when no credited key is bound
   * or the backstop itself fails — the caller then surfaces the original failure.
   */
  private async dispatchBackstop(
    body: ChatCompletionRequest,
    requestHeaders?: Record<string, string>,
  ): Promise<ProxyResult | null> {
    if (this.byoStrict) return null;
    const creditedEnv = this.creditedVendorEnv();
    if (!creditedEnv.OPENROUTER_API_KEY) return null; // no paid key to fall back to
    const result = await this.dispatch([...this.backstopModels], body, requestHeaders, {
      vendorEnv: creditedEnv,
      timeoutMs: PREMIUM_VENDOR_CALL_TIMEOUT_MS,
    });
    return result.response.status < 400 ? result : null;
  }

  private async dispatch(
    candidates: string[],
    body: ChatCompletionRequest,
    requestHeaders?: Record<string, string>,
    overrides?: { vendorEnv?: VendorEnv; timeoutMs?: number; signal?: AbortSignal },
  ): Promise<ProxyResult> {
    // Sanitize tool names (`governance.snapshot` → `governance__DOT__snapshot`)
    // AND tool-call ids (foreign ids with `:` `/` `.` → `^[a-zA-Z0-9_-]+$`)
    // before the body reaches a vendor — Anthropic / some Cerebras configs
    // reject both. Walks `tools`, `tool_choice`, message `tool_calls` (name+id),
    // and tool-message `name`/`tool_call_id`. Names are restored in dispatchJson
    // before returning to the caller; ids are opaque and are not restored.
    const sanitizedBody = sanitizeRequestToolCalls(body as unknown as Record<string, unknown>) as unknown as ChatCompletionRequest;
    const messages = sanitizedBody.messages as unknown as Array<Record<string, unknown>>;
    const extraBody = stripStandardFields(sanitizedBody);
    // ── Client reasoning intent ─────────────────────────────────────────────
    // The optional vendor-neutral `reasoning: { level }` (VS Code "Thinking" toggle) is
    // validated into an `AgentExecParams` lever here and threaded to the vendor
    // dispatcher AS INTENT — deliberately NOT resolved to a vendor param at this seam.
    // A dispatch carries a candidate CHAIN that the dispatcher walks internally on
    // failover, so a param computed once here would ride onto whichever model the
    // cascade lands on; `dispatchInternal` instead derives it PER CANDIDATE through the
    // single `reasoningParamsForModel` mapping, so an `auto`/mixed-family chain gets the
    // right param on the Anthropic/OpenAI hops and nothing at all on a
    // Cloudflare/deepseek/qwen coder.
    // `isFirstTurn`: a request with no assistant turn yet is definitionally a planning
    // turn (a tool-result continuation always carries one), which is what makes Anthropic
    // extended thinking safe alongside tools — same rule the cloud loop uses.
    const reasoningIntent = parseClientReasoningIntent((sanitizedBody as Record<string, unknown>).reasoning);
    // Timeout precedence: an explicit dispatch override (e.g. the paid backstop
    // forcing the premium budget) wins; otherwise a per-request caller override
    // (`_builderforce.vendorTimeoutMs`, clamped) lets even a free-plan one-off
    // long call escape the short plan default; otherwise the proxy's configured
    // plan default. Reuses the existing `overrides.timeoutMs` plumbing — no
    // parallel path.
    const effectiveTimeoutMs =
      overrides?.timeoutMs
      ?? resolveVendorTimeoutOverride(sanitizedBody as unknown as Record<string, unknown>)
      ?? this.vendorCallTimeoutMs;
    const vendorEnv = overrides?.vendorEnv ?? this.vendorEnv();
    const cacheTtl = resolveCacheTtl(sanitizedBody as unknown as Record<string, unknown>);
    const callParams = {
      messages,
      ...(sanitizedBody.max_tokens  != null ? { maxTokens:   sanitizedBody.max_tokens  } : {}),
      ...(sanitizedBody.temperature != null ? { temperature: sanitizedBody.temperature } : {}),
      ...(sanitizedBody.top_p       != null ? { topP:        sanitizedBody.top_p       } : {}),
      ...(Object.keys(extraBody).length > 0 ? { extraBody } : {}),
      ...(reasoningIntent
        ? {
            reasoningIntent: {
              execParams: reasoningIntent,
              isFirstTurn: !messages.some((m) => m.role === 'assistant'),
            },
          }
        : {}),
      ...(cacheTtl ? { cacheTtl } : {}),
      title: this.productName,
      ...(effectiveTimeoutMs ? { timeoutMs: effectiveTimeoutMs } : {}),
      ...(overrides?.signal ? { signal: overrides.signal } : {}),
      // Thread the R2 artifact store so the `evermind` vendor can load a
      // published model. Harmless for every other (HTTP) vendor — they ignore it.
      ...(this.env.UPLOADS ? { uploads: this.env.UPLOADS } : {}),
    };

    if (sanitizedBody.stream) {
      return this.dispatchStream(candidates, callParams, vendorEnv, requestHeaders);
    }
    return this.dispatchJson(candidates, callParams, vendorEnv, sanitizedBody);
  }

  /**
   * Non-streaming dispatch with optional `response_format` conformance retry.
   *
   * When the request asks for `json_object` or `json_schema` output, the
   * gateway parses the assistant message after each successful vendor call.
   * If parsing fails (or, for strict `json_schema`, the document is missing
   * a required field) the gateway advances past the model that just answered
   * and re-dispatches on the remaining suffix. The total non-conforming
   * round-trips are surfaced via `_builderforce.schemaRetries`.
   */
  private async dispatchJson(
    candidates: string[],
    callParams: Omit<Parameters<typeof dispatchVendor>[0], 'env' | 'modelChain'>,
    vendorEnv: VendorEnv,
    body: ChatCompletionRequest,
  ): Promise<ProxyResult> {
    let chain = candidates;
    let totalAttempts = 0;
    const totalFailovers: FailoverEvent[] = [];
    let schemaRetries = 0;
    let lastResult: Awaited<ReturnType<typeof dispatchVendor>> | null = null;

    while (chain.length > 0) {
      let result: Awaited<ReturnType<typeof dispatchVendor>>;
      try {
        result = await dispatchVendor({
          env: vendorEnv,
          modelChain: chain,
          ...callParams,
        });
      } catch (err) {
        // Worker subrequest cap exhausted — every later fetch from this isolate
        // throws the same thing. Surface a distinct 503 envelope and SKIP
        // cooldown writes (each is another subrequest that would compound the
        // problem and may itself throw the same error). The 503 lets the
        // caller distinguish "infrastructure ceiling" from "vendor rate limit"
        // and back off rather than retrying a doomed loop.
        if (err instanceof WorkerSubrequestExhaustedError) {
          return this.subrequestExhaustedResponse(candidates, schemaRetries, err);
        }
        // Caller cancelled — propagate so complete() stops immediately instead of
        // firing the paid backstop and spending more tokens on a cancelled run.
        if (err instanceof RequestAbortedError) throw err;
        // Fatal bad-payload (400/422) short-circuits the cascade in the vendor
        // dispatcher (failover can't fix a malformed request). Surface it as a
        // FATAL 4xx carrying the upstream diagnostic — NOT a 429 — and write no
        // cooldown (recordFailure no-ops request_error anyway). Mirrors the
        // all-request-error branch in exhaustedResponse for the cascaded case.
        if (err instanceof VendorFatalError && isRequestErrorStatus(err.status)) {
          const att = fatalErrorAttempt(err, chain);
          return this.requestErrorResponse([att], att.model, att.vendor, attemptsToFailovers([att]), schemaRetries);
        }
        const errAttempts = err instanceof CascadeExhaustedError ? err.attempts : [];
        await this.applyCooldowns(errAttempts);
        return this.exhaustedResponse(candidates, schemaRetries, err, errAttempts);
      }

      await this.applyCooldowns(result.attempts);
      totalAttempts += result.attempts.length;
      totalFailovers.push(...attemptsToFailovers(result.attempts));
      lastResult = result;

      const conformanceErr = checkResponseFormatConformance(body, result.raw);
      if (!conformanceErr) {
        return this.successJsonResult(result, totalAttempts, totalFailovers, schemaRetries);
      }

      // Non-conforming: advance past the model that just answered.
      schemaRetries++;
      const idx = chain.indexOf(result.modelUsed);
      chain = idx >= 0 ? chain.slice(idx + 1) : [];
    }

    // Chain exhausted with all candidates non-conforming. Return the last
    // body so callers see whatever the most-capable model produced, but
    // surface the retry count so they can detect the conformance failure.
    if (lastResult) {
      return this.successJsonResult(lastResult, totalAttempts, totalFailovers, schemaRetries);
    }
    return this.exhaustedResponse(candidates, schemaRetries);
  }

  private successJsonResult(
    result: Awaited<ReturnType<typeof dispatchVendor>>,
    totalAttempts: number,
    totalFailovers: FailoverEvent[],
    schemaRetries: number,
  ): ProxyResult {
    // The vendor that served this request is demonstrably healthy — clear any 5xx
    // streak so it reclaims its lead position in the BYO seed immediately instead of
    // waiting out the health TTL. Fire-and-forget: this method is synchronous, and
    // the signal is advisory (a dropped clear costs at most one extra demoted
    // ordering window, never a wrong routing decision).
    void this.clearVendorHealth(result.vendorUsed);
    // Restore dotted tool names that the request-side sanitizer escaped, so
    // `tool_calls[*].function.name` round-trips to the caller's namespace.
    const restoredRaw = restoreResponseToolNames(result.raw);
    return {
      response: new Response(JSON.stringify(restoredRaw), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      resolvedModel: result.modelUsed,
      resolvedVendor: result.vendorUsed,
      retries: totalAttempts,
      failovers: totalFailovers,
      outcome: 'success',
      attempts: result.attempts,
      ...(result.usage ? {
        usage: {
          promptTokens:     result.usage.prompt_tokens     ?? 0,
          completionTokens: result.usage.completion_tokens ?? 0,
          totalTokens:      result.usage.total_tokens      ?? 0,
          ...(result.usage.cache_read_tokens     != null ? { cacheReadTokens:     result.usage.cache_read_tokens     } : {}),
          ...(result.usage.cache_creation_tokens != null ? { cacheCreationTokens: result.usage.cache_creation_tokens } : {}),
        },
      } : {}),
      ...(schemaRetries > 0 ? { schemaRetries } : {}),
    };
  }

  /**
   * Build the cascade-exhausted 429 envelope. When real `attempts[]` are
   * available (from `CascadeExhaustedError`), use them for `failovers` so the
   * downstream `llm_failover_log` row carries the actual upstream status —
   * not a synthetic `code: 0`. Without this, the per-model rate-limit panel
   * cannot distinguish "model 429'd 50 times" from "model wasn't tried."
   */
  private exhaustedResponse(
    candidates: string[],
    schemaRetries: number,
    err?: unknown,
    attempts?: ReadonlyArray<DispatchAttempt>,
  ): ProxyResult {
    const message = err instanceof Error ? err.message : (err ? String(err) : 'All candidates produced non-conforming output');
    const failovers: FailoverEvent[] = attempts && attempts.length > 0
      ? attempts.map(attemptToFailover)
      : candidates.map((model) => ({ model, vendor: vendorForModel(model), code: 0, durationMs: 0, kind: 'skipped' }));
    // Pick the *last* dispatched attempt as the "model the gateway was on when
    // it gave up" — that's the most informative attribution for consumers
    // doing per-vendor saturation rollups. Falls back to the last candidate
    // when no attempts ran (every model on cooldown / no key bound).
    const resolvedModel = attempts && attempts.length > 0
      ? attempts[attempts.length - 1]!.model
      : (candidates[candidates.length - 1] ?? this.modelPool[0] ?? FREE_MODEL_POOL[0] ?? '');
    const resolvedVendor: VendorId = attempts && attempts.length > 0
      ? attempts[attempts.length - 1]!.vendor
      : vendorForModel(resolvedModel);

    // All-request-error short-circuit: when EVERY dispatched attempt failed with
    // a 400/422 (caller-side schema / validation bug), the cascade isn't
    // "exhausted" in the rate-limit sense — no amount of failover or backstop
    // will fix a malformed request. Surface a FATAL 4xx carrying the upstream's
    // own diagnostic so the caller can fix their payload, instead of a generic
    // 429 that invites a doomed retry loop. Mirrors the no-cooldown decision in
    // cooldownStore.classifyFailure('request_error').
    if (attempts && attempts.length > 0 && attempts.every((a) => isRequestErrorStatus(a.status))) {
      return this.requestErrorResponse(attempts, resolvedModel, resolvedVendor, failovers, schemaRetries);
    }

    // Failover breakdown lives under `error.details.failovers` — OpenAI-style
    // envelope so the SDK's existing `details` accessor on BuilderforceApiError
    // picks it up without a parser change. Top-level `vendor` + `model` give
    // consumers a single field to group by without parsing the model-id prefix
    // (which fails silently for OpenRouter-routed families like `qwen/*`,
    // `google/*`, `anthropic/*` that share the prefix with the model family,
    // not the upstream vendor).
    const exhaustedBody = JSON.stringify({
      error: {
        message,
        code: 429,
        type: 'rate_limit_error',
        vendor: resolvedVendor,
        model: resolvedModel,
        details: { failovers },
      },
    });
    return {
      response: new Response(exhaustedBody, {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
      resolvedModel,
      resolvedVendor,
      retries: attempts?.length ?? candidates.length,
      failovers,
      outcome: 'cascade_exhausted',
      attempts: attempts ? [...attempts] : [],
      ...(schemaRetries > 0 ? { schemaRetries } : {}),
    };
  }

  /**
   * Build the FATAL request-error envelope — used when every dispatched
   * candidate failed with a 400/422 (caller-side schema / validation bug).
   *
   * Surfaces the upstream's status verbatim (400 or 422) and its diagnostic
   * message so the caller gets an actionable "your request is malformed"
   * signal instead of a 429 cascade-exhausted (which implies "retry later" and
   * invites a doomed loop on a request that can never succeed). No cooldown was
   * written for these attempts — see `cooldownStore.classifyFailure`.
   */
  private requestErrorResponse(
    attempts: ReadonlyArray<DispatchAttempt>,
    resolvedModel: string,
    resolvedVendor: VendorId,
    failovers: FailoverEvent[],
    schemaRetries: number,
  ): ProxyResult {
    // Echo the *last* attempt's status (400 vs 422 are both caller-fixable) and
    // its error text — that's the model the gateway gave up on, and its body
    // carries the most specific validation diagnostic.
    const last   = attempts[attempts.length - 1]!;
    const status = isRequestErrorStatus(last.status) ? last.status : 400;

    // Distinguish a SCHEMA-too-complex cascade from a generic malformed-payload
    // one: when every dispatched attempt rejected the request because the
    // `response_format.json_schema` exceeded its constrained-decoding ceiling
    // (Gemini "too many states", etc.), surface a distinct, actionable code so
    // the caller knows to simplify the schema or drop to `json_object` mode —
    // NOT a generic `invalid_request_error` that reads like a payload bug.
    const allSchema = attempts.length > 0 && attempts.every((a) => a.kind === 'schema');
    const code: string | number = allSchema ? SCHEMA_TOO_COMPLEX_REASON : status;
    const message = allSchema
      ? `Every candidate model rejected the supplied response_format.json_schema as too complex for its constrained-decoding engine. Simplify the schema (fewer/optional fields, shallower nesting, fewer enums) or use response_format { type: 'json_object' }. Upstream: ${last.error || 'schema too complex'}`
      : (last.error || 'Request rejected by every candidate model as malformed (400/422).');
    const body = JSON.stringify({
      error: {
        message,
        code,
        type: 'invalid_request_error',
        // Both classes are TERMINAL: retrying the SAME request on a DIFFERENT
        // model won't help — every candidate already rejected it. The SDK honours
        // `terminal` to short-circuit its own failover loop (no more burning the
        // chain on a request that can never succeed as-is).
        terminal: true,
        ...(allSchema ? { reason: SCHEMA_TOO_COMPLEX_REASON } : {}),
        vendor: resolvedVendor,
        model: resolvedModel,
        details: { failovers },
      },
    });
    return {
      response: new Response(body, {
        status,
        headers: { 'content-type': 'application/json' },
      }),
      resolvedModel,
      resolvedVendor,
      retries: attempts.length,
      failovers,
      outcome: allSchema ? 'schema_too_complex' : 'request_error',
      attempts: [...attempts],
      ...(schemaRetries > 0 ? { schemaRetries } : {}),
    };
  }

  /**
   * Build the 503 `worker_subrequest_exhausted` envelope. Distinct from
   * `exhaustedResponse` because the failure mode is infrastructure
   * (Cloudflare's per-invocation subrequest cap), not vendor saturation —
   * callers should back off and retry rather than walk their own failover
   * chain across more models. Skips cooldown writes deliberately: each KV
   * `put` is another subrequest that would compound the problem and may
   * itself throw the same error.
   */
  private subrequestExhaustedResponse(
    candidates: string[],
    schemaRetries: number,
    err: WorkerSubrequestExhaustedError,
  ): ProxyResult {
    const resolvedModel  = err.model || (candidates[candidates.length - 1] ?? this.modelPool[0] ?? FREE_MODEL_POOL[0] ?? '');
    const resolvedVendor = vendorForModel(resolvedModel);
    const body = JSON.stringify({
      error: {
        message: `Gateway hit Cloudflare's per-invocation subrequest cap; retry the request to land on a fresh Worker isolate. (${err.message})`,
        code: 503,
        type: 'service_unavailable',
        reason: 'worker_subrequest_exhausted',
        vendor: resolvedVendor,
        model:  resolvedModel,
        details: { failovers: [{ model: resolvedModel, vendor: resolvedVendor, code: 0, durationMs: 0, kind: 'network' }] },
      },
    });
    return {
      response: new Response(body, {
        status: 503,
        headers: { 'content-type': 'application/json', 'retry-after': '1' },
      }),
      resolvedModel,
      resolvedVendor,
      retries: 1,
      failovers: [{ model: resolvedModel, vendor: resolvedVendor, code: 0, durationMs: 0, kind: 'network' }],
      outcome: 'subrequest_exhausted',
      attempts: [{ model: resolvedModel, vendor: resolvedVendor, status: 0, error: err.message, durationMs: 0, kind: 'network' }],
      ...(schemaRetries > 0 ? { schemaRetries } : {}),
    };
  }

  private async dispatchStream(
    candidates: string[],
    callParams: Omit<Parameters<typeof dispatchVendorStream>[0], 'env' | 'modelChain'>,
    vendorEnv: VendorEnv,
    _requestHeaders?: Record<string, string>,
  ): Promise<ProxyResult> {
    try {
      const result = await dispatchVendorStream({
        env: vendorEnv,
        modelChain: candidates,
        ...callParams,
      });
      this.applyCooldowns(result.attempts);
      // Restore dotted tool names in the streamed SSE deltas — symmetric to the
      // non-streaming `restoreResponseToolNames` in successJsonResult. Names can
      // arrive in fragments, so a stateful restorer buffers per tool-call index.
      const restoredBody = result.response.body
        ? restoreStreamToolNames(result.response.body)
        : result.response.body;
      const response = restoredBody && restoredBody !== result.response.body
        ? new Response(restoredBody, {
            status: result.response.status,
            headers: result.response.headers,
          })
        : result.response;
      // Streaming counterpart of the health clear in `successJsonResult` — headers
      // arrived, so this vendor is serving again.
      await this.clearVendorHealth(result.vendorUsed);
      return {
        response,
        resolvedModel: result.modelUsed,
        resolvedVendor: result.vendorUsed,
        retries: result.attempts.length,
        failovers: attemptsToFailovers(result.attempts),
        outcome: 'success',
        attempts: result.attempts,
      };
    } catch (err) {
      if (err instanceof WorkerSubrequestExhaustedError) {
        return this.subrequestExhaustedResponse(candidates, 0, err);
      }
      if (err instanceof RequestAbortedError) throw err;
      // Fatal bad-payload (400/422) — surface as a fatal 4xx, not a 429. See the
      // non-streaming dispatchJson branch for rationale.
      if (err instanceof VendorFatalError && isRequestErrorStatus(err.status)) {
        const att = fatalErrorAttempt(err, candidates);
        return this.requestErrorResponse([att], att.model, att.vendor, attemptsToFailovers([att]), 0);
      }
      const errAttempts = err instanceof CascadeExhaustedError ? err.attempts : [];
      await this.applyCooldowns(errAttempts);
      return this.exhaustedResponse(candidates, 0, err, errAttempts);
    }
  }

  /**
   * Record cooldowns for every failed attempt. Classification (5 min for
   * transient, 30 min for auth) lives in `cooldownStore.classifyFailure`.
   *
   * Awaited (not fire-and-forget): on Cloudflare Workers a `void` promise can
   * be aborted when the request lifecycle ends, leaving the cooldown unwritten.
   * KV writes are ~50–200ms in parallel — only on the failure path — so the
   * extra latency is acceptable in exchange for cooldowns that actually stick.
   */
  private async applyCooldowns(attempts: ReadonlyArray<DispatchAttempt>): Promise<void> {
    if (attempts.length === 0) return;
    // An attempt that rode the tenant's OWN credential writes NO cooldown: the keyspace is
    // global, so one owner's expired token would bench that model for our shared key and
    // for every other tenant ({@link isOwnerServedVendor}). Their signal is the vendor-health
    // fault below (seed order) plus the per-tenant `providerAuthAlerts` record the gateway
    // route and the daily BYO probe both write.
    const coolable = attempts.filter((a) => !this.isOwnerServedVendor(a.vendor));
    await Promise.all([
      ...coolable.map((a) => recordFailure(this.env, a.vendor, a.model, a.status, a.error)),
      // Independent of the cooldown above: extend the 5xx streak that governs BYO
      // SEED ORDER. `recordVendorUpstreamFault` ignores non-5xx, so handing it every
      // attempt is safe — a 429 or an auth failure must not demote a vendor, those
      // are the cooldown store's business. See `vendorHealth` for why the two
      // signals are deliberately separate.
      ...attempts.map((a) => recordVendorUpstreamFault(this.env, a.vendor, a.status)),
    ]);
  }

  /**
   * Clear a served vendor's 5xx streak so a recovered account reclaims its lead
   * position on the NEXT request rather than waiting out the health TTL. Cheap: a
   * vendor with no streak recorded exits after one cached read and writes nothing,
   * which is the state of essentially every successful call.
   *
   * Only the vendor that actually SERVED the request is cleared — vendors that
   * failed on the way to it were just recorded as faults by `applyCooldowns`.
   */
  private async clearVendorHealth(vendor: VendorId): Promise<void> {
    await recordVendorUpstreamSuccess(this.env, vendor).catch((error) => { /* advisory */ 
      console.error('[suppressed-error] application/llm/LlmProxyService.ts:1549 clearVendorHealth', { error });
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A request-validation status (400/422) — caller-side schema bug. Mirrors the
 *  `request_error` branch in `cooldownStore.classifyFailure`: these write no
 *  cooldown and, when they're the ONLY failure across the cascade, surface as a
 *  fatal 4xx rather than a 429. Single source of truth for the gateway's
 *  "caller's fault, not the model's" status set. */
export function isRequestErrorStatus(status: number): boolean {
  return status === 400 || status === 422;
}

/**
 * Relax a too-complex `response_format.json_schema` to loose `json_object` so a
 * re-dispatch escapes the vendor's constrained-decoding ceiling while still
 * returning JSON — the gateway's auto-recovery for `schema_too_complex` (so a
 * structured feature like resume-tailoring returns a result instead of a terminal
 * 422). Returns a shallow-cloned body, or `null` when there's no strict
 * json_schema to downgrade (a genuine malformed request, or already loose mode).
 *
 * The original schema is appended to `messages` as a SYSTEM hint so the model
 * still targets the expected shape now that the constrained decoder is gone —
 * the caller validates the JSON client-side. Pure + unit-testable.
 */
export function downgradeResponseFormat(body: ChatCompletionRequest): ChatCompletionRequest | null {
  const rf = (body as { response_format?: { type?: string; json_schema?: { schema?: unknown } } }).response_format;
  if (!rf || rf.type !== 'json_schema') return null;
  const clone: ChatCompletionRequest = { ...body, response_format: { type: 'json_object' } };
  const schema = rf.json_schema?.schema;
  if (schema && typeof schema === 'object' && Array.isArray(clone.messages)) {
    clone.messages = [
      ...clone.messages,
      {
        role: 'system',
        content:
          'Respond with a SINGLE JSON object that conforms to this JSON Schema. ' +
          'Output only the JSON — no markdown, no code fences, no prose:\n' +
          JSON.stringify(schema),
      },
    ];
  }
  return clone;
}

/** Synthesize the single `DispatchAttempt` for a `VendorFatalError` (400/422) that
 *  short-circuited the cascade in the vendor dispatcher before it could be recorded
 *  as an attempt. `VendorFatalError` carries the status + message + vendor but NOT
 *  the model id, so the failing model is recovered as the first chain entry owned by
 *  that vendor (earlier entries may have been no-key-skipped) — falling back to the
 *  chain head when none matches. */
function fatalErrorAttempt(err: VendorFatalError, chain: readonly string[]): DispatchAttempt {
  const model = chain.find((m) => vendorForModel(m) === err.vendorId) ?? chain[0] ?? '';
  const vendor = vendorForModel(model);
  return { model, vendor, status: err.status, error: err.message, durationMs: 0, kind: kindForStatus(err.status, err.message) };
}

function attemptsToFailovers(attempts: DispatchAttempt[]): FailoverEvent[] {
  return attempts.map(attemptToFailover);
}

/** One {@link DispatchAttempt} → {@link FailoverEvent}, carrying the structured
 *  `reason`/`upstreamStatus` when present so consumers branch on data, not prose.
 *  Single source for both `attemptsToFailovers` and `exhaustedResponse`'s mapper. */
export function attemptToFailover(a: DispatchAttempt): FailoverEvent {
  return {
    model: a.model,
    vendor: a.vendor,
    code: a.status,
    ...(a.durationMs != null ? { durationMs: a.durationMs } : {}),
    ...(a.kind ? { kind: a.kind } : {}),
    ...(a.reason ? { reason: a.reason } : {}),
    ...(a.upstreamStatus != null ? { upstreamStatus: a.upstreamStatus } : {}),
    ...(a.error ? { detail: a.error.slice(0, 240) } : {}),
  };
}

/** Authoritative gateway trace id. Prefix `llm-` mirrors what consumers already
 *  surface as `correlationId`, so a customer can quote it straight back to a
 *  superadmin for lookup. */
export function newTraceId(): string {
  return `llm-${crypto.randomUUID()}`;
}

/** Roll a set of per-attempt `kind`s up into one classification for the trace.
 *  `skipped` attempts (cooldown / no key) don't count toward the class. */
function classificationFromFailovers(failovers: ReadonlyArray<FailoverEvent>): string {
  const kinds = new Set(
    failovers.map((f) => f.kind).filter((k): k is string => !!k && k !== 'skipped'),
  );
  if (kinds.size === 0) return 'none';
  if (kinds.size === 1) return [...kinds][0]!;
  return 'mixed';
}

// ---------------------------------------------------------------------------
// Plan → proxy factory  (eliminates duplicated isPro/pool/productName wiring)
// ---------------------------------------------------------------------------

// Declared once in the domain; re-exported here so the ~40 modules that import
// it from the gateway keep working.
export type { EffectivePlan } from '../../domain/tenant/effectivePlan';
import type { EffectivePlan } from '../../domain/tenant/effectivePlan';

/**
 * Resolve the (productName, modelPool, vendorCallTimeoutMs) triple for a
 * given (plan, premiumOverride) pair. Single source of truth so the proxy
 * factory, the model-listing endpoint, and the response header logic stay
 * aligned. Per the DRY rule: callers consume this rather than recomputing
 * any of the three branches independently.
 *
 *   premiumOverride=true → top PREMIUM-tier models + extended 60s vendor
 *     timeout + Pro OpenRouter key. Plan/billing irrelevant — superadmin
 *     grant overrides them so comped / beta access works without flipping
 *     the billing plan.
 *
 *   premiumOverride=false → plan-driven routing as before.
 */
export function resolveRouting(
  effectivePlan: EffectivePlan,
  premiumOverride: boolean,
): { productName: ProductName; modelPool: readonly string[]; vendorCallTimeoutMs?: number } {
  if (premiumOverride) {
    return {
      productName: 'builderforceLLMPro',
      modelPool: PREMIUM_PRIORITY_POOL,
      vendorCallTimeoutMs: PREMIUM_VENDOR_CALL_TIMEOUT_MS,
    };
  }
  const productName: ProductName =
    effectivePlan === 'teams' ? 'builderforceLLMTeams'
    : effectivePlan === 'pro' ? 'builderforceLLMPro'
    :                            'builderforceLLM';
  if (effectivePlan === 'free') {
    // Free pool fails fast (15s/attempt) so it reaches the guaranteed paid
    // backstop within the caller's deadline. Paid plans keep the default budget.
    return { productName, modelPool: FREE_MODEL_POOL, vendorCallTimeoutMs: FREE_VENDOR_CALL_TIMEOUT_MS };
  }
  return { productName, modelPool: PRO_MODEL_POOL };
}

/** Map an effective plan to its productName + model pool, then construct the proxy.
 *  When `premiumOverride` is true the routing is forced to the premium pool
 *  + extended vendor timeout regardless of plan. Single entry point so
 *  /v1/chat/completions and /v1/models stay aligned. */
export function llmProxyForPlan(
  env: ProxyEnv,
  effectivePlan: EffectivePlan,
  premiumOverride = false,
  opts?: { backstopModels?: readonly string[]; disablePaidOverflow?: boolean; codingOnly?: boolean; anthropicOAuthToken?: string | null; openaiCodexAuth?: { accessToken: string; accountId: string } | null; xaiOAuthToken?: string | null; tenantVendorKeys?: TenantVendorKeys | null; vendorCallTimeoutMs?: number; byoVendorPriority?: readonly string[]; byoRequired?: boolean; byoDiagnostics?: ByoDiagnostics },
): LlmProxyService {
  const routing = resolveRouting(effectivePlan, premiumOverride);
  const { productName, modelPool } = routing;
  // A caller may override the per-vendor timeout — used to lift the free plan's 15s
  // fast-fail budget for a tenant's CONNECTED BYO account, whose (non-streaming) call
  // is the primary path and worth waiting for (a frontier completion routinely exceeds
  // 15s). Override wins over the plan-resolved value.
  const vendorCallTimeoutMs = opts?.vendorCallTimeoutMs ?? routing.vendorCallTimeoutMs;
  // A CODING run restricts its failover cascade to the curated coding pool, so an
  // exhausted/failed primary escalates to the paid CODING backstop (deepseek-v4-flash)
  // — NOT to a random free non-coder (gemini-flash-lite) or a tool-unreliable vendor.
  // Without this the cascade walks the whole plan pool and "degrades" off the coders.
  const pool = opts?.codingOnly ? codingModelsForPlan(effectivePlan, premiumOverride) : modelPool;
  return new LlmProxyService(env, {
    modelPool: pool,
    preferredPoolSize: PREFERRED_POOL_SIZE,
    productName,
    ...(vendorCallTimeoutMs ? { vendorCallTimeoutMs } : {}),
    ...(opts?.backstopModels ? { backstopModels: opts.backstopModels } : {}),
    ...(opts?.disablePaidOverflow ? { disablePaidOverflow: true } : {}),
    // A coding run walks the WHOLE free coding pool before any paid/metered coder
    // (cost over latency), so the funded direct-Anthropic floor is genuine last-resort.
    // A general (non-coding) run uses the PLAN-AWARE free budget: Free → 2 (latency),
    // Pro/Teams → wider free-tier breadth before escalating to their paid pool.
    ...(opts?.codingOnly
      ? { codingOnly: true, freeBudget: CODING_FREE_ATTEMPT_BUDGET }
      : { freeBudget: freeAttemptBudgetForPlan(effectivePlan) }),
    // A connected tenant subscription token powers any direct-Claude resolution.
    ...(opts?.anthropicOAuthToken ? { anthropicOAuthToken: opts.anthropicOAuthToken } : {}),
    ...(opts?.openaiCodexAuth ? { openaiCodexAuth: opts.openaiCodexAuth } : {}),
    ...(opts?.xaiOAuthToken ? { xaiOAuthToken: opts.xaiOAuthToken } : {}),
    // BYO api-keys (OpenAI/Google/Anthropic) override the operator keys for their
    // vendors and mark those calls tenant-funded (byo).
    ...(opts?.tenantVendorKeys ? { tenantVendorKeys: opts.tenantVendorKeys } : {}),
    // Tenant BYO precedence — leads the connected-flagship seed with the owner's
    // chosen account (e.g. Meta first), matching the cloud-agent pin.
    ...(opts?.byoVendorPriority?.length ? { byoVendorPriority: opts.byoVendorPriority } : {}),
    ...(opts?.byoRequired ? { byoRequired: true } : {}),
    // Diagnostics only — lets a fail-closed BYO 503 name the connected providers and
    // the reason each was unusable instead of asserting a bare "none is usable".
    ...(opts?.byoDiagnostics ? { byoDiagnostics: opts.byoDiagnostics } : {}),
  });
}

export function productNameForPlan(effectivePlan: EffectivePlan, premiumOverride = false): ProductName {
  return resolveRouting(effectivePlan, premiumOverride).productName;
}

export function modelPoolForPlan(effectivePlan: EffectivePlan, premiumOverride = false): readonly string[] {
  return resolveRouting(effectivePlan, premiumOverride).modelPool;
}

/**
 * Curated coding/tool-calling models the given plan can actually reach, best-first
 * — `CODING_MODEL_POOL` intersected with the plan's pool. The single source of
 * truth for "which coding models to offer / default to" on a plan: a free tenant
 * gets only the free coding models, a Pro tenant also gets the premium ones.
 * Consumed by `/llm/v1/models` (the cloud-agent picker) AND `codingDefaultForPlan`
 * (the cloud runtime default) so the picker and the runtime never diverge.
 */
export function codingModelsForPlan(effectivePlan: EffectivePlan, premiumOverride = false): string[] {
  const pool = new Set(modelPoolForPlan(effectivePlan, premiumOverride));
  return CODING_MODEL_POOL.filter((m) => pool.has(m));
}

/** Best coding model the plan can reach (Pro → premium, Free → free coding model),
 *  falling back to the global free default if the plan pool somehow excludes all. */
export function codingDefaultForPlan(effectivePlan: EffectivePlan, premiumOverride = false): string {
  return codingModelsForPlan(effectivePlan, premiumOverride)[0] ?? CODING_DEFAULT_MODEL;
}

/**
 * Is `model` a PREMIUM OpenRouter selection — i.e. an explicit pin on a PAID
 * OpenRouter model that is NOT already in the tenant's curated in-plan pool? This
 * is the "leverage OpenRouter → any paid model" tier: it routes on OUR metered
 * OpenRouter key, so selecting it is gated behind premium access (paid plan + a
 * validated card) and billed at OpenRouter cost + a flat 1¢/request.
 *
 * Excluded (return false):
 *   • empty / no pin — nothing selected;
 *   • non-OpenRouter vendors (`@cf/*`, `direct/*`, `googleai/*`, `evermind/*`,
 *     `cerebras/*`, …) — those are plan-pool or BYO paths, not premium;
 *   • `:free` OpenRouter ids — the free tier;
 *   • ids already in the plan's auto-route pool (the curated PREMIUM coders like
 *     `anthropic/claude-sonnet-5` a paid plan already reaches for free).
 * Everything else that resolves to the OpenRouter vendor is the premium long tail.
 *
 * Pure so the gateway gate, the surcharge decision, and any picker filter share ONE
 * definition of "premium selection".
 */
export function isPremiumModelSelection(
  model: string | undefined | null,
  effectivePlan: EffectivePlan,
  premiumOverride = false,
): boolean {
  const id = typeof model === 'string' ? model.trim() : '';
  if (!id) return false;
  if (vendorForModel(id) !== 'openrouter') return false;
  if (id.endsWith(':free')) return false;
  return !modelPoolForPlan(effectivePlan, premiumOverride).includes(id);
}

/**
 * Decide the model a cloud-agent run should use for a turn, shared by every cloud
 * executor (durable loop + container op) so the "explicit pick = hard pin, else
 * plan's best coding model" rule lives in ONE place.
 *   • PAID plan (Pro/Teams, or a premium override) + explicit real catalog id →
 *     hard pin (`strict`), dispatched as-is.
 *   • FREE plan → model selection is NOT offered (the picker is hidden, see
 *     RunAgentControl) and is ALSO enforced here server-side: any explicit pick
 *     (a user choice OR an agent's pinned base_model) is IGNORED and the run uses
 *     the free plan's managed coding default. Builderforce manages which model
 *     free tenants run on; this is the authoritative gate (the UI hide is cosmetic).
 *   • absent / typo'd / off-catalog → the plan's default coding model, soft (so a
 *     cold model can fail over once before the run locks onto what resolved).
 */
/** Minimal per-model stat shape the learned router ranks on — a structural subset
 *  of `routingTable.ActionModelStat`, declared here so this pure module never imports
 *  the routing-table/DB layer (keeps `rankModelsForAction` I/O-free + unit-testable). */
export interface ActionModelRankStat {
  model: string;
  n: number;
  avgScore: number;
  avgCostMc: number;
}

export interface RankModelsOptions {
  /** Minimum samples a (action_type, model) bucket needs before it can lead. */
  minSamples?: number;
  /** Optional client-computed SSM recall nudge (model → +/- weight) applied to the
   *  learned score BEFORE the sort. Personalization on top of the shared table. */
  bias?: Record<string, number>;
}

export const DEFAULT_MIN_SAMPLES = 8;

/**
 * Learned-routing reorder (PURE — no I/O). Stable-reorders the curated, plan-reachable
 * coding pool so the empirically-best model for this action type leads:
 *   • a model is ELIGIBLE to lead only with `n >= minSamples` samples;
 *   • eligible models sort by `avgScore (+ bias)` desc, ties broken by lower
 *     `avgCostMc`, then by the curated index (stable);
 *   • every model below the sample floor keeps the curated order, appended after;
 *   • when NO model clears the floor, the curated order is returned UNCHANGED
 *     (cold-start safety — routing degrades to today's static order).
 * The optional `bias` only nudges ordering AMONG already-eligible models (a nudge on
 * top of the table, never a way to surface a cold model). Never invents a model: the
 * output is always a permutation of `reachable`.
 */
export function rankModelsForAction(
  reachable: readonly string[],
  stats: ReadonlyArray<ActionModelRankStat> | undefined,
  opts?: RankModelsOptions,
): string[] {
  const minSamples = opts?.minSamples ?? DEFAULT_MIN_SAMPLES;
  const bias = opts?.bias ?? {};
  const statByModel = new Map<string, ActionModelRankStat>();
  for (const s of stats ?? []) statByModel.set(s.model, s);

  const curatedIndex = new Map<string, number>();
  reachable.forEach((m, i) => curatedIndex.set(m, i));

  const eligible: string[] = [];
  const rest: string[] = [];
  for (const m of reachable) {
    const s = statByModel.get(m);
    if (s && s.n >= minSamples) eligible.push(m);
    else rest.push(m);
  }
  if (eligible.length === 0) return [...reachable]; // cold-start: static order unchanged.

  const scoreOf = (m: string): number => (statByModel.get(m)!.avgScore) + (bias[m] ?? 0);
  eligible.sort((a, b) => {
    const d = scoreOf(b) - scoreOf(a);
    if (d !== 0) return d;
    const c = statByModel.get(a)!.avgCostMc - statByModel.get(b)!.avgCostMc;
    if (c !== 0) return c;
    return (curatedIndex.get(a)! - curatedIndex.get(b)!);
  });
  return [...eligible, ...rest];
}

export interface PickCloudModelOptions {
  actionType?: ActionType;
  /** The `byAction[actionType]` slice of the resolved scope's routing blob. */
  actionStats?: ReadonlyArray<ActionModelRankStat>;
  /** Client SSM recall nudge (interactive runs only; absent/ignored headless). */
  bias?: Record<string, number>;
  minSamples?: number;
  /** Estimated tokens the first turn will send (prompt + tools). When set, models
   *  whose catalog `contextWindow` can't hold it are dropped from the FIRST-PASS seed
   *  (they remain in the cascade as failover) so a small-window model isn't SEEDED
   *  into a context it would 413 on — the 97K-into-32K bug. Composes with the SSM
   *  learned ranking: fit FIRST, then rank the fitting set. */
  estimatedTokens?: number;
  /** Gateway vendor ids the tenant can serve from their OWN connected providers
   *  (BYO). A free tenant may pin a model owned by one of these — they pay their
   *  own provider — so the free-plan "can't choose a model" gate is lifted for it. */
  byoVendors?: ReadonlySet<string>;
  /** The tenant's BYO PRECEDENCE as ordered gateway vendor ids (most-preferred first).
   *  When set, the connected-flagship soft seed leads with the owner's chosen account
   *  (e.g. Meta first) instead of catalog-tier order. See {@link byoAutoSeedModels}. */
  byoVendorPriority?: readonly string[];
  /**
   * The tenant may select a PREMIUM model (any paid OpenRouter model outside the plan
   * pool, billed at OpenRouter cost + a flat 1¢/request) — i.e. a paid plan WITH a
   * validated card, per `evaluatePremiumModelAccess`. Defaults to false.
   *
   * A cloud run dispatches through the internal proxy, NOT the gateway HTTP route, so
   * the route's premium gate never sees it. Without this, an agent whose `base_model`
   * is a premium id would run ungated on our metered key. Mirrors the free-plan rule
   * below: an un-entitled premium pin is IGNORED (the run falls back to the plan's
   * coding default) rather than erroring a background run.
   */
  premiumEntitled?: boolean;
}

/** Headroom over the prompt estimate to reserve for the model's OUTPUT tokens +
 *  estimate error, when checking whether a context window fits. */
const CONTEXT_FIT_HEADROOM = 1.25;

/**
 * Rough token estimate for a chat request (~4 chars/token over the serialized
 * messages + tools). For MODEL-FIT selection only, NOT billing — a cheap heuristic
 * that errs slightly high (JSON punctuation), which is the safe direction for a fit
 * check. Pure + unit-testable.
 */
export function estimateRequestTokens(messages: unknown, tools?: unknown): number {
  const chars = JSON.stringify(messages ?? '').length + (tools != null ? JSON.stringify(tools).length : 0);
  return estimateTokensFromChars(chars);
}

/**
 * Drop models whose catalog `contextWindow` can't hold `estimatedTokens` (+ output
 * headroom) — the context-aware FIRST-PASS filter. Unknown-window models pass
 * (assumed large enough, e.g. OpenRouter ids carry no window in our catalog). NEVER
 * returns empty: if NOTHING fits (the request is larger than every window) the full
 * set is returned so the normal cascade + the 413 failover handle the oversized
 * request honestly instead of this silently picking nothing. Pure + unit-testable.
 */
export function modelsFittingContext(models: readonly string[], estimatedTokens?: number): string[] {
  if (!estimatedTokens || estimatedTokens <= 0) return [...models];
  const need = Math.ceil(estimatedTokens * CONTEXT_FIT_HEADROOM);
  const fit = models.filter((m) => {
    const cw = catalogEntry(m)?.contextWindow;
    return cw == null || cw >= need;
  });
  return fit.length > 0 ? fit : [...models];
}

export interface PickCloudModelResult {
  model: string;
  strict: boolean;
  /** The learned reorder of the plan-reachable coding pool (soft-seed branch only) —
   *  surfaced so the caller can explain the choice on the timeline. */
  ranked?: string[];
  /** Samples behind the chosen seed (the leading ranked model), 0 when cold/curated. */
  seedSamples?: number;
  /** True when the SSM bias map was non-empty and could affect ordering. */
  biasApplied?: boolean;
}

export function pickCloudModel(
  explicitRaw: string | undefined,
  effectivePlan: EffectivePlan,
  premiumOverride = false,
  opts?: PickCloudModelOptions,
): PickCloudModelResult {
  // The pin arrives from DURABLE STATE (an agent's `base_model`, a lane default, a
  // compile-run config) that may predate a vendor version bump, so rewrite it through
  // the supersession map before ANY gate reads it. Doing it here rather than at each
  // gate keeps `isKnownModel`, `vendorForModel`, the free-plan BYO check and the pin
  // this function RETURNS (which is then written onto the execution row) all agreeing
  // on one id — a stale id would otherwise fail `isKnownModel` and silently drop the
  // run back to the plan default with no signal that the pin was the problem.
  const explicit = canonicalModelId(explicitRaw) || undefined;
  // An explicit pin is honored (strict) ONLY when it PREEMPTS the connected-BYO seed
  // (shared rule — see explicitModelPreemptsByo): nothing connected, or the pin is on
  // the tenant's OWN account. A non-BYO pin while an account is connected (e.g. a
  // default agent base model of `@cf/qwen`) does NOT shadow it — the connected flagship
  // leads instead. Within the honored branch the free-plan gate still applies: a free
  // tenant may pin ONLY a model their own connected provider serves; paid / premium /
  // override may pin anything.
  const explicitIsByo = !!explicit && !!opts?.byoVendors?.has(vendorForModel(explicit.trim()));
  if (explicitModelPreemptsByo(explicit, opts?.byoVendors)) {
    const canChooseModel = premiumOverride || effectivePlan !== 'free' || explicitIsByo;
    // A PREMIUM pin (paid OpenRouter model off the plan pool) additionally needs the
    // card-validated entitlement — a cloud run never passes the route's premium gate,
    // so it is enforced here or nowhere. Un-entitled → ignore the pin and use the
    // plan's coding default (same shape as the free-plan gate: a background run
    // degrades to a model it may use rather than failing).
    const isPremiumPin = !explicitIsByo && isPremiumModelSelection(explicit, effectivePlan, premiumOverride);
    const premiumBlocked = isPremiumPin && opts?.premiumEntitled !== true;
    // `isKnownModel` normally guards against strict-pinning a typo'd/retired id (which
    // would 503 with no failover). But a PREMIUM id is off our curated catalog BY
    // DEFINITION — it's the paid OpenRouter long tail — so that guard would reject
    // every premium pin and silently drop the run back to the plan default. An
    // ENTITLED premium pin is therefore honoured on its own: it came from the
    // OpenRouter-catalog-driven picker, and dispatch resolves a bare `<org>/<slug>` to
    // the OpenRouter vendor.
    const pinnable = isKnownModel(explicit) || (isPremiumPin && !premiumBlocked);
    if (canChooseModel && !premiumBlocked && pinnable) {
      return { model: (explicit as string).trim(), strict: true };
    }
  }

  // No honored explicit pin: when the tenant has connected their OWN provider(s), lead
  // with the strongest connected frontier flagship as the soft seed so an auto-select
  // cloud run uses the owner's account before the free/paid coding pool.
  // Registration-driven (byoAutoSeedModels orders the connected providers' flagships by
  // the tenant's BYO precedence, tier as tiebreak — a cloud run is always an agentic
  // tool-loop, so Anthropic contributes Opus);
  // the run locks onto whatever this seed resolves on turn 1. Shared with the gateway
  // completion seed so both surfaces agree. Soft (not strict) so a transient provider
  // error still fails over.
  const byoSeed = byoAutoSeedModels(opts?.byoVendors, { agentic: true, vendorPriority: opts?.byoVendorPriority })[0];
  if (byoSeed) return { model: byoSeed, strict: false };

  // Soft-seed branch — the ONLY place learned routing changes anything. Reorder the
  // plan-reachable coding pool by the learned stats (+ optional bias) and seed the
  // leader. With no stats this is the curated order, so the seed equals
  // codingDefaultForPlan(...) — the prior behaviour. The free-plan gate is intact:
  // an explicit pick was already ignored above, and the reorder stays WITHIN the
  // plan's reachable coding pool (free tenants only ever reorder free coding models).
  const reachable = codingModelsForPlan(effectivePlan, premiumOverride);
  // Context-aware first pass: keep only models whose window fits this request, THEN
  // let the SSM learned routing rank the survivors. Small-window models stay in the
  // pool (great first pass for small tasks) but aren't seeded into an oversized one.
  const fitting = modelsFittingContext(reachable, opts?.estimatedTokens);
  const bias = opts?.bias && Object.keys(opts.bias).length > 0 ? opts.bias : undefined;
  const ranked = rankModelsForAction(fitting, opts?.actionStats, { minSamples: opts?.minSamples, bias });
  const seed = ranked[0] ?? reachable[0] ?? CODING_DEFAULT_MODEL;
  const seedSamples = opts?.actionStats?.find((s) => s.model === seed)?.n ?? 0;
  return { model: seed, strict: false, ranked, seedSamples, biasApplied: !!bias };
}

/** Free-tier proxy for IDE-internal callers (chat, dataset gen, agent inference, brain).
 *  Always uses FREE_MODEL_POOL and productName='builderforceLLM'. */
export function ideProxy(env: ProxyEnv): LlmProxyService {
  return new LlmProxyService(env, {
    modelPool: FREE_MODEL_POOL,
    preferredPoolSize: PREFERRED_POOL_SIZE,
    productName: 'builderforceLLM',
    vendorCallTimeoutMs: FREE_VENDOR_CALL_TIMEOUT_MS,
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

/**
 * Build the 503 `model_unavailable` envelope used by strict-pin dispatch
 * when the requested model can't be honoured. The reason string is exposed
 * to the caller so they can decide whether to retry on a different model or
 * surface the error directly.
 */
function strictUnavailableResult(
  model: string,
  reason: 'cooldown' | 'vendor_key_unconfigured' | 'plan_tier' | 'vendor_outage' | 'byo_provider_required',
  byo?: {
    requiredVendor: string;
    connectedVendors: readonly string[];
    configuredProviders: readonly string[];
    unresolvedReasons: Readonly<Record<string, string>>;
  },
): ProxyResult {
  const vendor = vendorForModel(model);
  // For the BYO reason, spell out the gap. `byo_provider_required` alone leaves the
  // operator guessing which of "never connected" / "connected but unusable" they hit.
  const byoSuffix = byo
    ? ` It needs the '${byo.requiredVendor}' provider on your own account.`
      + ` ${byo.connectedVendors.length ? `Usable this request: ${byo.connectedVendors.join(', ')}.` : 'No provider resolved to a usable credential this request.'}`
      + `${byo.configuredProviders.length
        ? ` Connected: ${byo.configuredProviders.map((p) => (byo.unresolvedReasons[p] ? `${p} (unusable: ${byo.unresolvedReasons[p]})` : `${p} (ok)`)).join(', ')}.`
        : ' No provider is connected on this workspace.'}`
    : '';
  const body = JSON.stringify({
    error: `Strict-pin: model '${model}' is unavailable (${reason}).${byoSuffix}`,
    code: 'model_unavailable',
    // Top-level `vendor` + `model` so SDK consumers' per-vendor rollups pick
    // up strict-pin 503s without parsing the model id prefix. `details`
    // retains `requestedModel` for backward compat.
    vendor,
    model,
    details: {
      requestedModel: model,
      reason,
      ...(byo ? {
        requiredVendor: byo.requiredVendor,
        connectedVendors: [...byo.connectedVendors],
        configuredProviders: [...byo.configuredProviders],
        unresolvedReasons: { ...byo.unresolvedReasons },
      } : {}),
    },
  });
  return {
    response: new Response(body, {
      status: 503,
      headers: { 'content-type': 'application/json' },
    }),
    resolvedModel: model,
    resolvedVendor: vendor,
    retries: 0,
    failovers: [],
    outcome: 'strict_unavailable',
    attempts: [],
  };
}

/** Everything a fail-closed BYO 503 needs to explain itself. Built at the one call
 *  site in {@link LlmProxyService.complete}; every field is diagnostics, never routing. */
interface ByoUnavailableContext {
  /** Every model id the gateway CONSIDERED for this request, in the order it would
   *  have walked them (the composed seed). Empty means the seed itself came out empty
   *  — which is itself the finding, and `connectedVendors` says whether that was
   *  "nothing connected" or "connected, but no flagship survived". */
  attempted: readonly string[];
  /** Gateway vendor ids that RESOLVED to a usable credential this call. */
  connectedVendors: readonly string[];
  /** Model ids dropped from the chain because they were on cooldown. */
  cooled: readonly string[];
  /** Providers with a stored credential row — what the UI calls "connected". */
  configuredProviders: readonly string[];
  /** provider → why it produced no usable credential this call. */
  unresolvedReasons: Readonly<Record<string, string>>;
}

/**
 * Fail-closed envelope when BYO is required but no connected credential can serve the
 * request. Deliberately a 503, not a shared-pool fallback.
 *
 * The message NAMES what was tried. The previous flat wording ("no configured provider
 * is currently usable") was, from the operator's seat, false: the Provider-priority UI
 * showed four connected accounts, so the sentence read as the gateway not seeing them,
 * when the real state was "four rows stored, zero resolved to a usable credential" or
 * "resolved fine, but every flagship was filtered out of the chain". Those are different
 * bugs with different fixes, and the old envelope could not tell them apart — it carried
 * no model list, and it finalized with an EMPTY candidate chain, so the cloud loop's
 * ` · chain: …` suffix was blank too. Both are fixed here and at the call site.
 */
function byoUnavailableResult(model: string, ctx: ByoUnavailableContext): ProxyResult {
  const vendor = vendorForModel(model);
  const { attempted, connectedVendors, cooled, configuredProviders, unresolvedReasons } = ctx;
  // Lead with the discriminating fact — "configured but none resolved" vs "resolved but
  // the chain composed empty" — because that is the sentence that tells the operator
  // whether to go repair a credential or go look at model/vendor filtering.
  const headline = connectedVendors.length === 0
    ? (configuredProviders.length > 0
      ? `BYO execution is required. ${configuredProviders.length} provider(s) are connected but NONE resolved to a usable credential this request — reconnect or repair the credential.`
      : 'BYO execution is required, but no provider is connected on this workspace — connect a provider.')
    : `BYO execution is required. ${connectedVendors.length} provider(s) resolved, but every candidate model was filtered out of the chain before dispatch — no request was sent upstream.`;
  const detail: string[] = [];
  if (configuredProviders.length) {
    detail.push(`connected: ${configuredProviders
      .map((p) => (unresolvedReasons[p] ? `${p} (unusable: ${unresolvedReasons[p]})` : `${p} (ok)`))
      .join(', ')}`);
  }
  if (connectedVendors.length) detail.push(`usable vendors: ${connectedVendors.join(', ')}`);
  // The list the operator actually asked for: EVERY model considered, not just the one
  // the envelope happens to be labelled with.
  detail.push(attempted.length
    ? `models tried: ${attempted.join(' → ')}`
    : 'models tried: none — the candidate chain composed empty');
  if (cooled.length) detail.push(`on cooldown: ${cooled.join(', ')}`);
  return {
    response: new Response(JSON.stringify({
      error: `${headline} ${detail.join(' · ')}`,
      code: 'byo_unavailable',
      details: {
        attemptedModels: [...attempted],
        connectedVendors: [...connectedVendors],
        configuredProviders: [...configuredProviders],
        unresolvedReasons: { ...unresolvedReasons },
        cooledModels: [...cooled],
      },
    }), { status: 503, headers: { 'content-type': 'application/json' } }),
    resolvedModel: model,
    resolvedVendor: vendor,
    retries: 0,
    failovers: [],
    outcome: 'byo_unavailable',
    // The chain the gateway WOULD have walked — stamped so `finalize` doesn't overwrite
    // it and every consumer (cloud-run error text, superadmin trace, tool_audit detail)
    // reports the same list instead of an empty one.
    candidateChain: [...attempted],
    attempts: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Collaborators split out of this file (2026-07-26). Re-exported here so the
// ~50 modules that import from 'LlmProxyService' are unaffected — the split is
// about where the code LIVES, not about churning every call site.
//
//   responseFormat — does a model's reply satisfy the requested response_format?
//   poolRouting    — in what order should the pool be tried for this request?
// ─────────────────────────────────────────────────────────────────────────────
export * from './responseFormat';
export * from './poolRouting';
