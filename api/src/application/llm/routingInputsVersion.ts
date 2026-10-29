/**
 * routingInputsVersion — a token that changes when the tenant's MODEL ROUTING inputs do.
 *
 * There is no stored version counter for the tenant's provider/model settings, so this is
 * derived from the cached rows the gateway's credential resolution already reads
 * (`loadTenantProviderRows`): each row's `id` (minted anew on every key write — migration
 * 0953), its auth type and its precedence `priority`, plus the effective plan. A key
 * connected, rotated or removed, a precedence change and a plan change all produce a new
 * token. NOT covered: a connected provider's selected-models list (`provider-model-selection`),
 * which has no row-level stamp — a cache keyed on this token must also carry a short TTL.
 * No decryption; ciphertext never leaves the row read.
 */
import type { Env } from '../../env';
import { sha256Hex } from '../../domain/shared/hash';
import { resolveTenantEffectivePlan } from '../tenant/tenantPlanSnapshot';
import { loadTenantProviderRows } from './tenantProviderRows';

export async function routingInputsVersion(env: Env, tenantId: number): Promise<string> {
  const [rows, plan] = await Promise.all([
    loadTenantProviderRows(env, tenantId).catch(() => []),
    resolveTenantEffectivePlan(env, tenantId).catch(() => 'free'),
  ]);
  const parts = rows.map((r) => `${r.id}:${r.authType ?? ''}:${r.priority ?? ''}`);
  return (await sha256Hex(`${plan}|${parts.join(',')}`)).slice(0, 16);
}
