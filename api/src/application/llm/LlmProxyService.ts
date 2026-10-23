/**
 * builderforceLLM — multi-vendor LLM proxy. THE FACADE.
 *
 * Routes chat completions through the vendor registry (`./vendors/`) so the
 * Free pool and Pro pool can cascade across OpenRouter / Cerebras / Ollama
 * without changes to callers.
 *
 * Single entry point:
 *   - `complete(body)` — chat completion. Routing is shape-driven: presence of
 *     `tools`, `response_format`, image content blocks, etc., influences the
 *     candidate chain inside the pool. Callers do not pass routing intents.
 *
 * This file is deliberately thin: the class, the plan → proxy factories, and
 * `readProxyChoice`. Every step lives in its own module and is re-exported here so
 * the ~50 importers of 'LlmProxyService' are unaffected:
 *
 *   proxyTypes         — public request / result / option types
 *   proxyConfig        — resolved per-instance config + the shared runtime bundle
 *   proxyFunding       — BYO / subscription funding, cooldown scope, vendor env
 *   proxyDispatcher    — vendor dispatch (JSON + stream), backstop, cooldown writes
 *   proxySeed          — seed composition, cooldown prefetch, candidate chain
 *   proxyCompletion    — the `complete()` use case
 *   proxyAllCooled     — the empty-chain branch (probes, backstop, BYO 503)
 *   proxyStrictPin     — strict single-model pins
 *   proxyEnvelopes     — failure envelopes (429 / 503 / fatal 4xx / BYO 503)
 *   proxyFailover      — status predicates, attempt → failover, trace id
 *   proxyFinalize      — the single seam every result leaves through
 *   proxyResponseCache — the exact-match cache step
 *   proxyStatus        — `/v1/models` pool status
 *   proxyPlanRouting   — plan → product / pool / timeout
 *   pickCloudModel     — cloud-agent model selection
 *   requestFit         — exclusions, context fit, token estimate
 */

import {
  CODING_FREE_ATTEMPT_BUDGET,
  FREE_MODEL_POOL,
  FREE_VENDOR_CALL_TIMEOUT_MS,
  PREFERRED_POOL_SIZE,
  freeAttemptBudgetForPlan,
} from './modelPool';
import {
  DEFAULT_MIN_SAMPLES,
  rankModelsForAction,
  type ActionModelRankStat,
  type RankModelsOptions,
} from '@builderforce/learned-routing';
import type { TenantVendorKeys } from './tenantProviderKeyService';
import type { OpenRouterConnection } from './openRouterConnectionService';
import type { VendorEgress } from './vendors';
import type { EffectivePlan } from '../../domain/tenant/effectivePlan';
import { resolveProxyConfig, type ProxyRuntime } from './proxyConfig';
import { ProxyFunding } from './proxyFunding';
import { ProxyDispatcher } from './proxyDispatcher';
import { finalizeProxyResult } from './proxyFinalize';
import { completeChat, type CompleteOptions } from './proxyCompletion';
import { proxyModelStatus, type ProxyModelStatus } from './proxyStatus';
import { codingModelsForPlan, resolveRouting } from './proxyPlanRouting';
import type {
  ByoDiagnostics,
  ChatCompletionRequest,
  LlmProxyOptions,
  ProductName,
  ProxyChoice,
  ProxyChoiceMessage,
  ProxyEnv,
  ProxyResult,
} from './proxyTypes';

export * from './modelPool';
export type {
  ByoDiagnostics,
  ChatCompletionRequest,
  ChatMessage,
  FailoverEvent,
  LlmProxyOptions,
  LlmUsage,
  ProductName,
  ProxyChoice,
  ProxyChoiceMessage,
  ProxyEnv,
  ProxyResult,
} from './proxyTypes';
export type { CompleteOptions } from './proxyCompletion';
export type { ProxyModelStatus } from './proxyStatus';
export {
  attemptToFailover,
  downgradeResponseFormat,
  isModelUnavailableStatus,
  isRequestErrorStatus,
  newTraceId,
} from './proxyFailover';
export {
  codingDefaultForPlan,
  codingModelsForPlan,
  isPremiumModelSelection,
  modelPoolForPlan,
  productNameForPlan,
  resolveRouting,
} from './proxyPlanRouting';
export {
  applyExcludedModels,
  estimateRequestTokens,
  fundedFloorHintDemoted,
  modelsFittingContext,
} from './requestFit';
export { pickCloudModel, type PickCloudModelOptions, type PickCloudModelResult } from './pickCloudModel';
// Declared once in the domain; re-exported here so the ~40 modules that import
// it from the gateway keep working.
export type { EffectivePlan } from '../../domain/tenant/effectivePlan';

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

export class LlmProxyService {
  private readonly rt: ProxyRuntime;

  constructor(env: ProxyEnv, options?: LlmProxyOptions) {
    const cfg = resolveProxyConfig(env, options);
    const funding = new ProxyFunding(cfg);
    this.rt = {
      cfg,
      funding,
      dispatcher: new ProxyDispatcher(cfg, funding),
      finalize: (result, traceId, startedAt, chain, outcome) =>
        finalizeProxyResult(cfg, funding, result, traceId, startedAt, chain, outcome),
    };
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
  complete(
    body: ChatCompletionRequest,
    requestHeaders?: Record<string, string>,
    traceId?: string,
    signal?: AbortSignal,
    opts?: CompleteOptions,
  ): Promise<ProxyResult> {
    return completeChat(this.rt, body, requestHeaders, traceId, signal, opts);
  }

  /** Per-model status with cooldown + key-bound info — used by /v1/models. */
  status(): Promise<ProxyModelStatus[]> {
    return proxyModelStatus(this.rt);
  }
}

// ---------------------------------------------------------------------------
// Plan → proxy factory  (eliminates duplicated isPro/pool/productName wiring)
// ---------------------------------------------------------------------------

/** Map an effective plan to its productName + model pool, then construct the proxy.
 *  When `premiumOverride` is true the routing is forced to the premium pool
 *  + extended vendor timeout regardless of plan. Single entry point so
 *  /v1/chat/completions and /v1/models stay aligned. */
export function llmProxyForPlan(
  env: ProxyEnv,
  effectivePlan: EffectivePlan,
  premiumOverride = false,
  opts?: { tenantId?: number | null; backstopModels?: readonly string[]; disablePaidOverflow?: boolean; codingOnly?: boolean; anthropicOAuthToken?: string | null; openaiCodexAuth?: { accessToken: string; accountId: string } | null; xaiOAuthToken?: string | null; tenantVendorKeys?: TenantVendorKeys | null; hostEgress?: VendorEgress | null; vendorCallTimeoutMs?: number; byoVendorPriority?: readonly string[]; byoAlertedVendors?: readonly string[]; byoProviderPriorities?: readonly { vendor: string; priority: number | null }[]; openRouterConnections?: readonly OpenRouterConnection[]; openRouterModelKeys?: Readonly<Record<string, string>>; byoSelectedModels?: Readonly<Record<string, readonly string[]>>; byoRequired?: boolean; allowGatewayAuto?: boolean; freeFirst?: boolean; byoDiagnostics?: ByoDiagnostics },
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
    // The tenant the call is billed to — buckets per-tenant cost-lever rollouts.
    ...(opts?.tenantId != null ? { tenantId: opts.tenantId } : {}),
    modelPool: pool,
    preferredPoolSize: PREFERRED_POOL_SIZE,
    productName,
    ...(vendorCallTimeoutMs ? { vendorCallTimeoutMs } : {}),
    ...(opts?.backstopModels ? { backstopModels: opts.backstopModels } : {}),
    ...(opts?.disablePaidOverflow ? { disablePaidOverflow: true } : {}),
    ...(opts?.allowGatewayAuto ? { allowGatewayAuto: true } : {}),
    ...(opts?.freeFirst ? { freeFirst: true } : {}),
    ...(opts?.hostEgress ? { hostEgress: opts.hostEgress } : {}),
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
    // Tenant accounts we KNOW are broken right now — demoted out of the lead position.
    ...(opts?.byoAlertedVendors?.length ? { byoAlertedVendors: opts.byoAlertedVendors } : {}),
    ...(opts?.byoProviderPriorities?.length ? { byoProviderPriorities: opts.byoProviderPriorities } : {}),
    ...(opts?.openRouterConnections?.length ? { openRouterConnections: opts.openRouterConnections } : {}),
    ...(opts?.openRouterModelKeys && Object.keys(opts.openRouterModelKeys).length
      ? { openRouterModelKeys: opts.openRouterModelKeys }
      : {}),
    // Each provider's selected models (1165) — replaces that vendor's flagship in the seed.
    ...(opts?.byoSelectedModels && Object.keys(opts.byoSelectedModels).length
      ? { byoSelectedModels: opts.byoSelectedModels }
      : {}),
    ...(opts?.byoRequired ? { byoRequired: true } : {}),
    // Diagnostics only — lets a fail-closed BYO 503 name the connected providers and
    // the reason each was unusable instead of asserting a bare "none is usable".
    ...(opts?.byoDiagnostics ? { byoDiagnostics: opts.byoDiagnostics } : {}),
  });
}

/**
 * The learned re-ranker moved to `@builderforce/learned-routing` so the on-prem /
 * IDE host can seed from the SAME ranking without importing this Worker-side
 * application service. Re-exported here because `pickCloudModel` (./pickCloudModel) is its main
 * caller and the api's existing importers look for it at this address.
 */
export {
  DEFAULT_MIN_SAMPLES,
  rankModelsForAction,
  type ActionModelRankStat,
  type RankModelsOptions,
};

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
