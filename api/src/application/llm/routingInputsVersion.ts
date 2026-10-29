/**
 * routingInputsVersion — a token that changes when the tenant's MODEL ROUTING inputs do.
 *
 * There is no stored version counter for the tenant's provider/model settings, so this is
 * derived from the cached rows the gateway's credential resolution already reads
 * (`loadTenantProviderRows`): each row's `id` (minted anew on every key write — migration
 * 0953), its auth type and its precedence `priority`, plus the effective plan. A key
 * connected, rotated or removed, a precedence change and a plan change all produce a new
 * token. A connected provider's SELECTED-models list (`provider-model-selection`, migration
 * 1165) has no row-level stamp, so it is folded in from its own cached read
 * (`listProviderModelSelections`, invalidated by every selection write): the models' order is
 * part of the token, since position 0 leads and the rest are failover.
 * No decryption; ciphertext never leaves the row read.
 */
import type { Env } from '../../env';
import { sha256Hex } from '../../domain/shared/hash';
import { reportedFallback } from '../observability/caughtErrorReporter';
import { resolveTenantPlan } from '../tenant/tenantPlanSnapshot';
import { listProviderModelSelections, type ProviderModelSelections } from './providerModelSelection';
import { loadTenantProviderRows, type TenantProviderRow } from './tenantProviderRows';

const SOURCE = 'application/llm/routingInputsVersion.ts';

export async function routingInputsVersion(env: Env, tenantId: number): Promise<string> {
  const [rows, plan, selections] = await Promise.all([
    loadTenantProviderRows(env, tenantId).catch(reportedFallback<TenantProviderRow[]>([], { source: SOURCE, operation: 'providerRows', context: { tenantId } })),
    // `tenantProxyForPlan` routes by BOTH the effective plan and the premium override; an
    // unreadable plan degrades exactly as it does there (free, no override).
    resolveTenantPlan(env, tenantId).catch(reportedFallback({ effectivePlan: 'free', premiumOverride: false }, { source: SOURCE, operation: 'tenantPlan', context: { tenantId } })),
    listProviderModelSelections(env, tenantId).catch(reportedFallback<ProviderModelSelections>({}, { source: SOURCE, operation: 'providerModelSelections', context: { tenantId } })),
  ]);
  const parts = rows.map((r) => `${r.id}:${r.authType ?? ''}:${r.priority ?? ''}`);
  const picked = Object.entries(selections)
    .filter(([, models]) => models && models.length > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([provider, models]) => `${provider}=${models!.join('+')}`);
  const planPart = `${plan.effectivePlan}:${plan.premiumOverride ? 'premium' : '-'}`;
  return (await sha256Hex(`${planPart}|${parts.join(',')}|${picked.join(',')}`)).slice(0, 16);
}
