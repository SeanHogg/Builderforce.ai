/**
 * The gateway's completion-proxy composition — which proxy serves a
 * `/v1/chat/completions` or `/v1/messages` turn, and whether the tenant can fund
 * one at all without the operator's pool key.
 *
 * Carved out of `presentation/routes/llmRoutes.ts`: these are routing rules, not
 * HTTP concerns, and both completion surfaces share them.
 */
import type { Env } from '../../env';
import {
  llmProxyForPlan,
  CODING_BACKSTOP_MODELS,
  type ChatCompletionRequest,
  type ByoDiagnostics,
} from './LlmProxyService';
import type { VendorEgress } from './vendors';
import type { ByoRoutingOptions } from './tenantProxy';
import type { TenantVendorKeys } from './tenantProviderKeyService';
import type { TenantAccess } from './gatewayAccess';

/** A completion whose body carries `tools` IS an agentic tool-loop (the VS Code
 *  Brain chat, on-prem hosts, any tool-calling SDK caller) — as opposed to a plain
 *  chat completion. This is the discriminator for the coding capability floor. */
export function isAgenticToolTurn(body: { tools?: unknown }): boolean {
  const tools = (body as { tools?: unknown[] }).tools;
  return Array.isArray(tools) && tools.length > 0;
}

/**
 * Can this tenant fund a completion WITHOUT the operator's pool key?
 *
 * The pre-flight "LLM proxy not configured" 503 asks whether the request can be served
 * at all — not whether WE can serve it. A tenant on their own credential does not touch
 * our pool, so turning them away for a missing `OPENROUTER_API_KEY` refuses a request
 * that would have succeeded, and blames our configuration for it.
 *
 * OpenRouter CONNECTIONS were already exempt; every DIRECT provider (a connected Kimi
 * Code / OpenAI / Meta / Moonshot / xAI key, or a Claude / Codex / SuperGrok
 * subscription) is the same case and was simply missed — which is how a tenant whose
 * only connected account is Kimi could be told the proxy is unconfigured while holding
 * a perfectly good key.
 *
 * Deliberately a capability check, not a routing decision: `byoRequired` + the strict
 * pin still decide WHICH account serves the turn, and a cascade that cannot reach the
 * pinned vendor still fails with its own real reason instead of this blanket 503.
 */
export function tenantCanSelfFund(creds: {
  vendorKeys?: TenantVendorKeys | null;
  anthropicOAuthToken?: string | null;
  openaiCodexAuth?: unknown;
  xaiOAuthToken?: string | null;
  openRouterConnections?: readonly { hasKey: boolean }[];
}): boolean {
  return Object.values(creds.vendorKeys ?? {}).some(Boolean)
    || creds.anthropicOAuthToken != null
    || creds.openaiCodexAuth != null
    || creds.xaiOAuthToken != null
    || (creds.openRouterConnections?.some((connection) => connection.hasKey) ?? false);
}

/** The per-request credentials + routing options {@link proxyForCompletion} layers on. */
export interface CompletionProxyOptions {
  disablePaidOverflow: boolean;
  anthropicOAuthToken?: string | null;
  openaiCodexAuth?: { accessToken: string; accountId: string } | null;
  xaiOAuthToken?: string | null;
  tenantVendorKeys?: TenantVendorKeys | null;
  hostEgress?: VendorEgress | null;
  byoRouting?: ByoRoutingOptions;
  byoRequired?: boolean;
  allowGatewayAuto?: boolean;
  freeFirst?: boolean;
  byoDiagnostics?: ByoDiagnostics;
}

/**
 * Build the gateway completion proxy, applying the agentic capability floor when
 * the turn carries tools. `codingOnly` keeps the failover cascade inside the
 * curated coder pool and `CODING_BACKSTOP_MODELS` floors an exhausted cascade onto
 * a PAID coder — never the general `gemini-flash-lite` guaranteed backstop, which
 * "loops on search and ships no edits" for tool loops. That is the same
 * "free coders first → funded paid floor" ladder the cloud coding agent uses, so
 * an auto-select agentic turn (e.g. the Brain chat) never degrades onto a lite
 * non-coder that narrates edits it never makes. `disablePaidOverflow` still caps
 * paid spend. A plain (non-tool) chat completion keeps the plan-aware general pool
 * (cost over capability) unchanged. Shared by /v1/chat/completions and the
 * /v1/messages our-models branch so both honour the identical ladder.
 */
export function proxyForCompletion(
  env: Env,
  access: Pick<TenantAccess, 'tenantId' | 'effectivePlan' | 'premiumOverride'>,
  body: ChatCompletionRequest,
  opts: CompletionProxyOptions,
): ReturnType<typeof llmProxyForPlan> {
  return llmProxyForPlan(env, access.effectivePlan, access.premiumOverride, {
    tenantId: access.tenantId,
    disablePaidOverflow: opts.disablePaidOverflow,
    ...(opts.hostEgress ? { hostEgress: opts.hostEgress } : {}),
    ...(isAgenticToolTurn(body as { tools?: unknown }) ? { codingOnly: true, backstopModels: CODING_BACKSTOP_MODELS } : {}),
    ...(opts.anthropicOAuthToken ? { anthropicOAuthToken: opts.anthropicOAuthToken } : {}),
    ...(opts.openaiCodexAuth ? { openaiCodexAuth: opts.openaiCodexAuth } : {}),
    ...(opts.xaiOAuthToken ? { xaiOAuthToken: opts.xaiOAuthToken } : {}),
    ...(opts.tenantVendorKeys ? { tenantVendorKeys: opts.tenantVendorKeys } : {}),
    // The routing ORDER (precedence, known-broken accounts, OpenRouter connections, each
    // provider's selected models) — one derivation shared with every tenant proxy.
    ...(opts.byoRouting ?? {}),
    ...(opts.byoRequired ? { byoRequired: true } : {}),
    ...(opts.allowGatewayAuto ? { allowGatewayAuto: true } : {}),
    ...(opts.freeFirst ? { freeFirst: true } : {}),
    // Diagnostics only — so a fail-closed BYO 503 names the connected providers and
    // why each was unusable, matching `x-builderforce-byo-unresolved`.
    ...(opts.byoDiagnostics ? { byoDiagnostics: opts.byoDiagnostics } : {}),
  });
}
