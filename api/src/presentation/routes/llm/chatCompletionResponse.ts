/**
 * The response half of `POST /v1/chat/completions` — the `x-builderforce-*` headers
 * every reply carries, the trace id stamped into an error envelope, and the
 * non-streaming `_builderforce` envelope.
 */
import type { Context } from 'hono';
import type { Env, HonoEnv } from '../../../env';
import { modelPoolForPlan, type llmProxyForPlan } from '../../../application/llm/LlmProxyService';
import { PREMIUM_REQUEST_SURCHARGE_MILLICENTS } from '../../../application/llm/usageLedger';
import { classifyReplyAccount } from '../../../application/llm/replyProvenance';
import {
  formatByoUnresolvedHeader,
  type LlmProvider,
  type TenantLlmCredentials,
} from '../../../application/llm/tenantProviderKeyService';
import { isAgenticToolTurn } from '../../../application/llm/gatewayCompletionProxy';
import { cappedByoProviders, providersConnectedElsewhereCached } from '../../../application/llm/gatewayChatSupport';
import type { TokenCapUsage } from './gatewayGuards';
import type { TenantAccess } from './access';

/** What one `complete()` call on the gateway proxy resolves to. */
export type CompletionResult = Awaited<ReturnType<ReturnType<typeof llmProxyForPlan>['complete']>>;

/** Everything the response headers are derived from. */
export interface CompletionHeaderInput {
  access: TenantAccess;
  result: CompletionResult;
  traceId: string;
  llmProduct: string;
  premiumServed: boolean;
  byoVendors: ReadonlySet<string>;
  tenantCreds: TenantLlmCredentials;
  body: { tools?: unknown };
  caps: TokenCapUsage;
}

/** The `x-builderforce-*` headers for a gateway chat completion (streamed or not). */
export async function buildCompletionHeaders(c: Context<HonoEnv>, input: CompletionHeaderInput): Promise<Headers> {
  const { access, result, traceId, llmProduct, premiumServed, byoVendors, tenantCreds, caps } = input;
  const { usageToday, planDailyLimit, usageMonth, planMonthlyLimit } = caps;
  // Clone upstream headers we care about
  const upstreamHeaders = new Headers();
  const contentType = result.response.headers.get('content-type');
  if (contentType) upstreamHeaders.set('content-type', contentType);
  upstreamHeaders.set('x-builderforce-model', result.resolvedModel);
  // Tell the client this turn billed the premium surcharge, so the chat surface can
  // show "premium · +1¢" provenance next to the model chip instead of guessing.
  if (premiumServed) upstreamHeaders.set('x-builderforce-premium-surcharge', String(PREMIUM_REQUEST_SURCHARGE_MILLICENTS));
  upstreamHeaders.set('x-builderforce-trace-id', traceId);
  upstreamHeaders.set('x-builderforce-vendor', result.resolvedVendor);
  // Which account served this turn (own / shared / shared_byo_unused) — the Brain
  // provenance chip reads this so a SUCCESSFUL turn shows whether the tenant's own
  // connected frontier account ran it, or the shared pool did despite one existing.
  upstreamHeaders.set('x-builderforce-account', classifyReplyAccount(result.byoFunded ?? false, byoVendors.size > 0));
  // A provider the tenant CONNECTED but that couldn't be resolved this call (revoked/
  // expired subscription, an undecryptable key) leaves `byoVendors` empty — the turn
  // degrades to the shared pool looking exactly like "nothing connected". Surface each
  // unresolved provider WITH its reason (`anthropic:revoked`) so the client/triage can
  // say precisely why + what to do, instead of a silent weak-coder run.
  // ALSO cover the tenant-mismatch case: if NOTHING is connected in THIS tenant on an
  // agentic (Brain) turn, check whether the same user connected a frontier provider in
  // ANOTHER workspace (reason `other-workspace`) — cached per user (~1 query per 5 min,
  // never on the common connected path) so it's not a per-request cost.
  let otherWorkspace: LlmProvider[] = [];
  if (byoVendors.size === 0 && tenantCreds.configuredProviders.length === 0 && isAgenticToolTurn(input.body) && access.userId) {
    otherWorkspace = await providersConnectedElsewhereCached(c.env as Env, access.userId, access.tenantId);
  }
  const byoUnresolvedHeader = formatByoUnresolvedHeader(tenantCreds, otherWorkspace);
  if (byoUnresolvedHeader) upstreamHeaders.set('x-builderforce-byo-unresolved', byoUnresolvedHeader);

  // BYO providers that hit a usage/capacity cap this request (see cappedByoProviders).
  const providerCapHeader = cappedByoProviders(result.attempts, byoVendors);
  if (providerCapHeader) upstreamHeaders.set('x-builderforce-provider-cap', providerCapHeader);
  upstreamHeaders.set('x-builderforce-retries', String(result.retries));
  upstreamHeaders.set('x-builderforce-product', llmProduct);
  upstreamHeaders.set('x-builderforce-effective-plan', access.effectivePlan);
  if (access.premiumOverride) upstreamHeaders.set('x-builderforce-premium', 'true');
  // Token-limit headers — let callers pre-emptively throttle before they hit
  // the 429 plan_token_(monthly_)limit_exceeded gates.
  if (planDailyLimit > 0) {
    upstreamHeaders.set('x-builderforce-daily-tokens-used', String(usageToday));
    upstreamHeaders.set('x-builderforce-daily-tokens-limit', String(planDailyLimit));
    upstreamHeaders.set('x-builderforce-daily-tokens-remaining', String(Math.max(planDailyLimit - usageToday, 0)));
  }
  if (planMonthlyLimit > 0) {
    upstreamHeaders.set('x-builderforce-monthly-tokens-used', String(usageMonth));
    upstreamHeaders.set('x-builderforce-monthly-tokens-limit', String(planMonthlyLimit));
    upstreamHeaders.set('x-builderforce-monthly-tokens-remaining', String(Math.max(planMonthlyLimit - usageMonth, 0)));
  }
  return upstreamHeaders;
}

/**
 * Surface the trace id inside the error envelope too, so a consumer hitting a failure
 * can quote `error.details.correlationId` straight back for a superadmin lookup. Full
 * diagnostics stay builder-side. Mutates `upstream`; returns the error message for the
 * trace row (null on success).
 *
 * `error` is an object for vendor envelopes but a STRING for our own strict-pin
 * envelope (`model_unavailable`), whose details sit at the top level — assigning onto
 * the string threw and turned every intended 503 into a 500.
 */
export function stampTraceIdOnError(upstream: Record<string, unknown>, traceId: string): string | null {
  const rawErr = (upstream as { error?: unknown }).error;
  const upstreamErr = rawErr && typeof rawErr === 'object'
    ? rawErr as { message?: unknown; details?: Record<string, unknown> }
    : null;
  const traceErrorMessage = upstreamErr ? String(upstreamErr.message ?? '') : typeof rawErr === 'string' ? rawErr : null;
  if (upstreamErr) {
    upstreamErr.details = { ...(upstreamErr.details ?? {}), correlationId: traceId, traceId };
  } else if (typeof rawErr === 'string') {
    const top = upstream as { details?: Record<string, unknown> };
    top.details = { ...(top.details ?? {}), correlationId: traceId, traceId };
  }
  return traceErrorMessage;
}

/** The non-streaming response body: the upstream JSON plus the `_builderforce` block. */
export function buildCompletionEnvelope(
  c: Context<HonoEnv>,
  input: {
    upstream: Record<string, unknown>;
    access: TenantAccess;
    result: CompletionResult;
    traceId: string;
    llmProduct: string;
    platformSurcharge: boolean;
    callerUseCase: string | null;
    callerMetadata: Record<string, unknown> | null;
    caps: TokenCapUsage;
  },
) {
  const { upstream, access, result, traceId, llmProduct, platformSurcharge, callerUseCase, callerMetadata } = input;
  const { usageToday, planDailyLimit, usageMonth, planMonthlyLimit } = input.caps;
  return {
    ...upstream,
    _builderforce: {
      traceId,
      resolvedModel:  result.resolvedModel,
      resolvedVendor: result.resolvedVendor,
      retries:        result.retries,
      // Per-attempt breakdown (model + vendor + code) when the cascade
      // retried before this success. Empty when the first model answered.
      // Lets callers see which vendor recovered the request and detect
      // single-vendor concentration patterns over time.
      ...(result.failovers.length > 0 ? { failovers: result.failovers } : {}),
      pool:          modelPoolForPlan(access.effectivePlan, access.premiumOverride).length,
      product:       llmProduct,
      effectivePlan: access.effectivePlan,
      ...(access.premiumOverride ? { premium: true } : {}),
      // A premium (any-paid-OpenRouter) turn: billed at OpenRouter cost + this flat
      // per-request surcharge. Surfaced so the caller can attribute the extra cent.
      ...(platformSurcharge ? { premiumSurchargeMillicents: PREMIUM_REQUEST_SURCHARGE_MILLICENTS } : {}),
      ...(result.schemaRetries != null ? { schemaRetries: result.schemaRetries } : {}),
      ...(result.schemaDowngraded ? { schemaDowngraded: true } : {}),
      ...(callerUseCase     ? { useCase:    callerUseCase  } : {}),
      ...(callerMetadata    ? { metadata:   callerMetadata as Record<string, string> } : {}),
      ...(c.req.header('x-request-id') ? { requestId: c.req.header('x-request-id') } : {}),
      ...(planDailyLimit > 0 ? {
        dailyTokens: {
          used:      usageToday,
          limit:     planDailyLimit,
          remaining: Math.max(planDailyLimit - usageToday, 0),
        },
      } : {}),
      ...(planMonthlyLimit > 0 ? {
        monthlyTokens: {
          used:      usageMonth,
          limit:     planMonthlyLimit,
          remaining: Math.max(planMonthlyLimit - usageMonth, 0),
        },
      } : {}),
    },
  };
}
