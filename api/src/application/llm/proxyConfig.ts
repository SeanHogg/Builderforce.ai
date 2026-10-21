/**
 * The resolved, immutable configuration of one `LlmProxyService` instance, plus the
 * runtime bundle (config + funding + dispatcher + finalize) its collaborators share.
 *
 * `resolveProxyConfig` is the constructor body of the old monolith: every option
 * default lives here, once, so the seed composer, the dispatcher, the strict-pin path
 * and `finalize` all read the SAME resolved values.
 */

import { FREE_ATTEMPT_BUDGET, FREE_MODEL_POOL, GUARANTEED_BACKSTOP_MODEL, PREFERRED_POOL_SIZE } from './modelPool';
import { connectionModelRefs, type OpenRouterConnection } from './openRouterConnectionService';
import type { TenantVendorKeys } from './tenantProviderKeyService';
import type { VendorEgress } from './vendors';
import type { ByoDiagnostics, LlmProxyOptions, ProductName, ProxyEnv, ProxyResult } from './proxyTypes';
import type { ProxyFunding } from './proxyFunding';
import type { ProxyDispatcher } from './proxyDispatcher';

export interface ProxyConfig {
  readonly env: ProxyEnv;
  readonly modelPool: readonly string[];
  readonly preferredPoolSize: number;
  readonly productName: ProductName;
  readonly isPro: boolean;
  readonly vendorCallTimeoutMs: number | undefined;
  readonly backstopModels: readonly string[];
  readonly disablePaidOverflow: boolean;
  readonly codingOnly: boolean;
  readonly freeBudget: number;
  readonly anthropicOAuthToken: string | null;
  readonly openaiCodexAuth: { accessToken: string; accountId: string } | null;
  readonly xaiOAuthToken: string | null;
  readonly tenantVendorKeys: TenantVendorKeys;
  readonly hostEgress: VendorEgress | null;
  readonly byoVendorPriority: readonly string[];
  readonly byoAlertedVendors: readonly string[];
  readonly byoProviderPriorities: readonly { vendor: string; priority: number | null }[];
  readonly openRouterConnections: readonly OpenRouterConnection[];
  readonly openRouterModelKeys: Readonly<Record<string, string>>;
  readonly openRouterConnectionModels: ReadonlySet<string>;
  readonly byoSelectedModels: Readonly<Record<string, readonly string[]>>;
  readonly byoRequired: boolean;
  readonly allowGatewayAuto: boolean;
  readonly freeFirst: boolean;
  readonly byoDiagnostics: ByoDiagnostics;
}

export function resolveProxyConfig(env: ProxyEnv, options?: LlmProxyOptions): ProxyConfig {
  const modelPool = options?.modelPool ?? FREE_MODEL_POOL;
  const productName = options?.productName ?? 'builderforceLLM';
  const openRouterConnections = options?.openRouterConnections ?? [];
  return {
    env,
    modelPool,
    preferredPoolSize: Math.min(options?.preferredPoolSize ?? PREFERRED_POOL_SIZE, modelPool.length),
    productName,
    isPro: productName === 'builderforceLLMPro' || productName === 'builderforceLLMTeams',
    vendorCallTimeoutMs: options?.vendorCallTimeoutMs,
    backstopModels: options?.backstopModels?.length ? options.backstopModels : [GUARANTEED_BACKSTOP_MODEL],
    disablePaidOverflow: options?.disablePaidOverflow ?? false,
    codingOnly: options?.codingOnly ?? false,
    freeBudget: options?.freeBudget && options.freeBudget > 0 ? options.freeBudget : FREE_ATTEMPT_BUDGET,
    anthropicOAuthToken: options?.anthropicOAuthToken ?? null,
    openaiCodexAuth: options?.openaiCodexAuth ?? null,
    xaiOAuthToken: options?.xaiOAuthToken ?? null,
    tenantVendorKeys: options?.tenantVendorKeys ?? {},
    hostEgress: options?.hostEgress ?? null,
    byoVendorPriority: options?.byoVendorPriority ?? [],
    byoAlertedVendors: options?.byoAlertedVendors ?? [],
    byoProviderPriorities: options?.byoProviderPriorities ?? [],
    openRouterConnections,
    openRouterModelKeys: options?.openRouterModelKeys ?? {},
    openRouterConnectionModels: new Set(connectionModelRefs(openRouterConnections)),
    byoSelectedModels: options?.byoSelectedModels ?? {},
    byoRequired: options?.byoRequired ?? false,
    allowGatewayAuto: options?.allowGatewayAuto ?? false,
    freeFirst: options?.freeFirst ?? false,
    byoDiagnostics: options?.byoDiagnostics ?? {},
  };
}

/** Stamp request-level diagnostics onto a result — see `finalizeProxyResult`. */
export type ProxyFinalize = (
  result: ProxyResult,
  traceId: string,
  startedAt: number,
  candidateChain: readonly string[],
  outcomeOverride?: string,
) => ProxyResult;

/** Everything one proxy instance's request path needs, bundled once per instance. */
export interface ProxyRuntime {
  readonly cfg: ProxyConfig;
  readonly funding: ProxyFunding;
  readonly dispatcher: ProxyDispatcher;
  readonly finalize: ProxyFinalize;
}
