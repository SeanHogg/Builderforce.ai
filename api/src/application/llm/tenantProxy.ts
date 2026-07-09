/**
 * tenantProxyForPlan — THE single builder for a tenant-scoped LLM proxy that threads
 * the tenant's connected BYO account.
 *
 * Every TENANT-FACING generative / agentic path (IDE chat, workforce-agent inference,
 * knowledge/PRD/QA/dataset/legal authoring, the workflow LLM node, compile-run, the
 * security-review agent, the Brain addressed-reply, the cloud coding loop) must build
 * its proxy through here so a connected frontier account (Claude subscription/OAuth or
 * a BYO api-key for anthropic/openai/google) is USED before the free/paid tiers — and
 * BYO-served resolutions are $0. Hand-rolling `resolveTenantLlmCredentials` +
 * `llmProxyForPlan` option-spreading per call site is exactly how BYO drift crept in
 * (an agent's default `@cf/qwen` base model shadowing a live Claude subscription); this
 * makes the correct wiring the ONLY wiring.
 *
 * INTERNAL system utilities (chat/session summarisation, task classification, transcript
 * compaction, LLM-as-judge routing/eval, the Evermind distillation teacher, the platform's
 * own legal boilerplate) deliberately keep `ideProxy(env)` — they must NOT spend the
 * owner's frontier quota and are not "the tenant's agent doing work".
 *
 * Returns the proxy AND the resolved `byoVendors` set so the caller can gate any explicit
 * `model:` through {@link byoAwareModel} — a non-BYO explicit model (e.g. an agent's
 * default base model) must not shadow the connected flagship.
 */
import {
  llmProxyForPlan,
  CODING_BACKSTOP_MODELS,
  PREMIUM_VENDOR_CALL_TIMEOUT_MS,
  explicitModelPreemptsByo,
  type LlmProxyService,
  type ChatCompletionRequest,
  type ProxyResult,
} from './LlmProxyService';
import {
  resolveTenantLlmCredentials,
  byoVendorIdSet,
  providersFromCredentials,
  type TenantVendorKeys,
} from './tenantProviderKeyService';
import { recordProxyUsage } from './usageLedger';
import { resolveTenantPlan } from '../../presentation/routes/llmRoutes';
import { buildDatabase } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

export interface TenantProxyOptions {
  /** Restrict failover to the curated coding pool + paid coding backstop (agentic
   *  tool-loops). Mirrors the gateway's agentic branch. */
  codingOnly?: boolean;
  /** Close the funded paid-overflow path (e.g. tenant hit its overflow $ cap). */
  disablePaidOverflow?: boolean;
  /** Pre-resolved plan, when the caller already has it (skips the extra DB read). */
  plan?: { effectivePlan: 'free' | 'pro' | 'teams'; premiumOverride: boolean };
}

export interface TenantProxyResult {
  proxy: LlmProxyService;
  /** Gateway vendor ids the tenant can serve from their OWN connected account. Pass to
   *  {@link byoAwareModel} / `explicitModelPreemptsByo` to gate an explicit model pin. */
  byoVendors: Set<string>;
}

/** True when a resolved BYO api-key set has at least one usable key. */
function hasVendorKeys(v: TenantVendorKeys | null | undefined): boolean {
  return !!v && Object.values(v).some(Boolean);
}

/**
 * Build a tenant-scoped proxy with the tenant's connected BYO account threaded. Plan +
 * credentials are resolved together (best-effort: a failure degrades to the free plan /
 * no BYO, never throws on the hot path). When the caller passes `opts.plan` the extra
 * plan read is skipped.
 */
export async function tenantProxyForPlan(
  env: Env,
  tenantId: number,
  opts?: TenantProxyOptions,
): Promise<TenantProxyResult> {
  const [plan, creds] = await Promise.all([
    opts?.plan
      ? Promise.resolve(opts.plan)
      : resolveTenantPlan(env, tenantId)
          .then((p) => ({ effectivePlan: p.effectivePlan, premiumOverride: p.premiumOverride }))
          .catch(() => ({ effectivePlan: 'free' as const, premiumOverride: false })),
    resolveTenantLlmCredentials(env, tenantId).catch(() => ({
      anthropicOAuthToken: null,
      vendorKeys: {} as TenantVendorKeys,
      configuredProviders: [],
    })),
  ]);

  const byoVendors = byoVendorIdSet(providersFromCredentials(creds));

  const proxy = llmProxyForPlan(env, plan.effectivePlan, plan.premiumOverride, {
    ...(opts?.codingOnly ? { codingOnly: true, backstopModels: CODING_BACKSTOP_MODELS } : {}),
    ...(opts?.disablePaidOverflow ? { disablePaidOverflow: true } : {}),
    ...(creds.anthropicOAuthToken ? { anthropicOAuthToken: creds.anthropicOAuthToken } : {}),
    ...(hasVendorKeys(creds.vendorKeys) ? { tenantVendorKeys: creds.vendorKeys } : {}),
    // A connected BYO account is the PRIMARY path — lift the free plan's 15s fast-fail
    // budget so a (non-streaming) frontier completion on the tenant's own account isn't
    // aborted (`code 0 / no response`) and silently cascaded to the shared pool.
    ...(byoVendors.size > 0 ? { vendorCallTimeoutMs: PREMIUM_VENDOR_CALL_TIMEOUT_MS } : {}),
  });

  return { proxy, byoVendors };
}

/**
 * Resolve the `model` to pass to `.complete()` while honouring the connected account:
 * an explicit choice (agent base model, workflow node config, compile-run pin) is kept
 * ONLY when it preempts the BYO seed (nothing connected, or the model is on the tenant's
 * OWN account — see {@link explicitModelPreemptsByo}). Otherwise returns `undefined` so
 * `.complete()` auto-seeds the connected flagship. Single helper so every call site gates
 * its explicit model identically.
 */
export function byoAwareModel(
  explicit: string | undefined | null,
  byoVendors: ReadonlySet<string> | null | undefined,
): string | undefined {
  return explicitModelPreemptsByo(explicit, byoVendors) ? (explicit ?? undefined)?.trim() || undefined : undefined;
}

export interface CompleteForTenantOptions {
  /** Restrict failover to the curated coding pool + paid coding backstop (agentic
   *  tool turns). */
  codingOnly?: boolean;
  /** Meter this call in the usage ledger under this useCase (best-effort, background,
   *  no-ops on a streamed/error result with no usage). Omit to skip metering (e.g. a
   *  streamed route that meters from the stream itself). */
  meterUseCase?: string;
  /** An explicit model to gate against the connected account — an agent's base model,
   *  a workflow node's configured model, a compile-run pin. Defaults to `request.model`.
   *  Honored ONLY when it preempts the BYO seed (nothing connected, or it's on the
   *  tenant's own account); otherwise the connected flagship leads. */
  explicitModel?: string | null;
  traceId?: string;
  userId?: string | null;
}

/**
 * Call the LLM on behalf of a tenant with their connected BYO account applied — THE
 * single implementation of a tenant-facing completion. In ONE place it: resolves the
 * connected account, gates the explicit model (a non-BYO pin can't shadow the connected
 * flagship — see {@link byoAwareModel}), dispatches, and optionally meters usage. Every
 * one-shot tenant-facing AI feature goes through here (directly, or via the
 * {@link TenantAiService} base class); multi-turn tool loops build the proxy once with
 * {@link tenantProxyForPlan} and reuse it across turns.
 */
export async function completeForTenant(
  env: Env,
  tenantId: number,
  request: ChatCompletionRequest,
  opts?: CompleteForTenantOptions,
): Promise<ProxyResult> {
  const { proxy, byoVendors } = await tenantProxyForPlan(env, tenantId, {
    ...(opts?.codingOnly ? { codingOnly: true } : {}),
  });
  const model = byoAwareModel(opts?.explicitModel ?? request.model, byoVendors);
  const result = await proxy.complete({ ...request, model }, undefined, opts?.traceId);
  if (opts?.meterUseCase) {
    void recordProxyUsage(buildDatabase(env), env, {
      tenantId,
      userId: opts.userId ?? null,
      useCase: opts.meterUseCase,
      result,
    });
  }
  return result;
}

/**
 * Base class for a tenant-facing AI service. Subclass this instead of hand-rolling
 * `ideProxy` + credential resolution + option spreading + usage metering per feature —
 * the connected-account logic lives ONCE (in {@link completeForTenant}), so no service
 * can drift (the class of bug where an agent's default `@cf/qwen` base model shadowed a
 * connected Claude subscription). INTERNAL system utilities (chat/session summarisation,
 * task classification, transcript compaction, LLM-as-judge routing) deliberately do NOT
 * extend this — they call `ideProxy(env)` directly so they never spend the owner's quota.
 */
export abstract class TenantAiService {
  protected constructor(protected readonly aiEnv: Env) {}

  /** Complete `request` on behalf of `tenantId` with the tenant's connected BYO account
   *  applied, the explicit model gated, and usage metered — the one call every subclass
   *  uses to reach the LLM. */
  protected completeForTenant(
    tenantId: number,
    request: ChatCompletionRequest,
    opts?: CompleteForTenantOptions,
  ): Promise<ProxyResult> {
    return completeForTenant(this.aiEnv, tenantId, request, opts);
  }
}
