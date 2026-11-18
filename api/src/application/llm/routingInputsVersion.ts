/**
 * routingInputsVersion — THE token that changes when the tenant's MODEL ROUTING inputs do.
 * Every read-through cache whose answer is a routing decision keys on it (the judge-cost
 * estimate, `GET /llm/byo-order`); there is no second per-tenant routing version.
 *
 * Two halves:
 *   • DERIVED — from the cached rows the gateway's credential resolution already reads
 *     (`loadTenantProviderRows`): each row's `id` (minted anew on every key write — migration
 *     0953), its auth type and its precedence `priority`, plus the effective plan. A key
 *     connected, rotated or removed, a precedence change and a plan change all produce a new
 *     token. A connected provider's SELECTED-models list (`provider-model-selection`, migration
 *     1165) has no row-level stamp, so it is folded in from its own cached read
 *     (`listProviderModelSelections`, invalidated by every selection write): the models' order
 *     is part of the token, since position 0 leads and the rest are failover.
 *   • BUMPED — for the inputs with no row of their own to derive from: an OpenRouter
 *     connection written or re-ranked, a provider/connection auth alert recorded, low
 *     account headroom recorded. Those writers call {@link bumpRoutingInputsVersion}.
 * No decryption; ciphertext never leaves the row read.
 */
import type { Env } from '../../env';
import { sha256Hex } from '../../domain/shared/hash';
import { bumpCacheVersionSafe, getCacheVersion, type CacheEnv } from '../../infrastructure/cache/readThroughCache';
import { reportedFallback } from '../observability/caughtErrorReporter';
import { resolveTenantPlan } from '../tenant/tenantPlanSnapshot';
import { listProviderModelSelections, type ProviderModelSelections } from './providerModelSelection';
import { loadTenantProviderRows, type TenantProviderRow } from './tenantProviderRows';

const SOURCE = 'application/llm/routingInputsVersion.ts';

/** The bumped half's version key. */
export function routingInputsVersionKey(tenantId: number): string {
  return `routing-inputs-version:tenant:${tenantId}`;
}

/**
 * A routing input with no row to derive from changed (see the module doc): orphan every
 * cache keyed on this tenant's token. Never throws — call from write paths, AFTER the
 * write, so a reader that mints the new token can only ever see the new state.
 */
export async function bumpRoutingInputsVersion(env: CacheEnv, tenantId: number): Promise<void> {
  await bumpCacheVersionSafe(env, routingInputsVersionKey(tenantId), 'bumpRoutingInputsVersion', { tenantId });
}

export async function routingInputsVersion(env: Env, tenantId: number): Promise<string> {
  const [rows, plan, selections, bumped] = await Promise.all([
    loadTenantProviderRows(env, tenantId).catch(reportedFallback<TenantProviderRow[]>([], { source: SOURCE, operation: 'providerRows', context: { tenantId } })),
    // `tenantProxyForPlan` routes by BOTH the effective plan and the premium override; an
    // unreadable plan degrades exactly as it does there (free, no override).
    resolveTenantPlan(env, tenantId).catch(reportedFallback({ effectivePlan: 'free', premiumOverride: false }, { source: SOURCE, operation: 'tenantPlan', context: { tenantId } })),
    listProviderModelSelections(env, tenantId).catch(reportedFallback<ProviderModelSelections>({}, { source: SOURCE, operation: 'providerModelSelections', context: { tenantId } })),
    getCacheVersion(env, routingInputsVersionKey(tenantId)).catch(reportedFallback('', { source: SOURCE, operation: 'bumpedVersion', context: { tenantId } })),
  ]);
  const parts = rows.map((r) => `${r.id}:${r.authType ?? ''}:${r.priority ?? ''}`);
  const picked = Object.entries(selections)
    .filter(([, models]) => models && models.length > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([provider, models]) => `${provider}=${models!.join('+')}`);
  const planPart = `${plan.effectivePlan}:${plan.premiumOverride ? 'premium' : '-'}`;
  return (await sha256Hex(`${planPart}|${parts.join(',')}|${picked.join(',')}|${bumped}`)).slice(0, 16);
}
