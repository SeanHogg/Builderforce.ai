/**
 * `GET /llm/byo-order?role=<ModelRole>` — the tenant's connected-account (BYO) models in
 * the order the gateway would try them for a `byo_pool` call of that role.
 *
 * WHY THE SERVER ANSWERS. The VS Code client calls some accounts itself (Kimi Code, whose
 * edge refuses our egress). It used to try those first on every turn, whatever the tenant's
 * precedence and whatever the role — a coding turn led with Kimi while Sonnet sat connected.
 * The order is a ROUTING decision (precedence, the role's model ladder, health, learned
 * evidence), so the server owns it and the client reads it here.
 *
 * SAME FUNCTION AS THE GATEWAY. The order comes from {@link orderByoSeeds}, the function the
 * gateway's completion seed (`proxySeed.composeCompletionSeed`) leads a `byo_pool` turn
 * with, fed the same inputs: the tenant's credentials (`resolveTenantLlmCredentials`), the
 * same demotions (`loadByoDemotedVendors`) and the same learned role evidence
 * (`roleRoutingStats`, tenant scope). It answers for an agentic tool-loop turn — what the
 * editor sends — and never explores (exploration is a per-call random draw).
 *
 * Only models a BYO PROVIDER owns are listed: an OpenRouter connection ref is not an
 * account the client can call, so it is left out (the relative order of the rest is
 * unchanged). `healthy: false` marks a model whose vendor the gateway is demoting right
 * now — an alerted or low-headroom account, or a vendor on a 5xx streak.
 */

import { isModelRole, type ModelRole } from '@builderforce/agent-tools';
import type { ActionModelRankStat } from '@builderforce/learned-routing';
import type { CatalogView } from '@builderforce/model-catalog';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { getCacheVersion, getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { byoRoleOrderCacheKey, byoRoleOrderVersionKey } from './byoRoleOrderCache';
import { loadByoDemotedVendors, orderByoSeeds } from './byoSeedOrder';
import { REGISTRY_CATALOG_VIEW, pricesForCall, registryCatalogView } from './catalogView';
import { providerForVendor, type LlmProvider } from './llmProviderCatalog';
import { roleRoutingStats } from './routingTable';
import { byoVendorIdsFromCredentials, resolveTenantLlmCredentials, type TenantLlmCredentials } from './tenantProviderKeyService';
import { vendorForModel } from './vendors';

export interface ByoRoleOrderModel {
  /** The routed model ref, e.g. `direct/kimi-code/k3`. */
  ref: string;
  /** The gateway vendor that dispatches it. */
  vendor: string;
  /** The BYO provider account it runs on. */
  provider: LlmProvider;
  /** False while the gateway is demoting this vendor (alerted, low headroom, 5xx streak). */
  healthy: boolean;
}

export interface ByoRoleOrder {
  role: ModelRole;
  models: ByoRoleOrderModel[];
}

/** The role a request asked for; absent or unknown → `code`. Pure. */
export function parseByoOrderRole(raw: unknown): ModelRole {
  return isModelRole(raw) ? raw : 'code';
}

/** The order for one role from already-resolved inputs. Pure. */
export function byoRoleOrderFor(
  creds: TenantLlmCredentials,
  role: ModelRole,
  demotedVendors: ReadonlySet<string>,
  stats?: ReadonlyArray<ActionModelRankStat>,
  view: CatalogView = REGISTRY_CATALOG_VIEW,
): ByoRoleOrder {
  const { ordered } = orderByoSeeds({
    connectedByo: byoVendorIdsFromCredentials(creds),
    vendorPriority: creds.vendorPriority,
    providerPriorities: creds.providerPriorities ?? [],
    openRouterConnections: creds.openRouterConnections ?? [],
    selectedModels: creds.byoSelectedModels ?? {},
  }, {
    agentic: true,
    role,
    demotedVendors,
    ...(stats ? { stats } : {}),
  }, view);
  const models = ordered.flatMap((ref): ByoRoleOrderModel[] => {
    const vendor = vendorForModel(ref);
    const provider = providerForVendor(vendor);
    return provider ? [{ ref, vendor, provider, healthy: !demotedVendors.has(vendor) }] : [];
  });
  return { role, models };
}

/** Short: vendor health and learned evidence move without a write that could bump it. */
const BYO_ROLE_ORDER_TTL_SECONDS = 60;

/**
 * The tenant's order for one role, read-through cached per tenant × role behind the
 * tenant's version token (`byoRoleOrderCache.ts`, bumped by every write that changes it).
 * Throws when the credentials cannot be read — the route answers 5xx rather than an empty
 * order the client would read as "nothing connected".
 */
export async function loadByoRoleOrder(env: Env, db: Db, tenantId: number, role: ModelRole): Promise<ByoRoleOrder> {
  const version = await getCacheVersion(env, byoRoleOrderVersionKey(tenantId));
  return getOrSetCached(env, byoRoleOrderCacheKey(tenantId, role, version), async () => {
    const creds = await resolveTenantLlmCredentials(env, tenantId);
    const connected = byoVendorIdsFromCredentials(creds);
    // Prices only for a cost-first role (verify / explore / utility) — exactly when the
    // gateway's completion route loads them (`pricesForCall`).
    const [demotedVendors, stats, prices] = await Promise.all([
      loadByoDemotedVendors(env, connected, creds.alertedVendors ?? []),
      roleRoutingStats(env, db, { tenantId, role }),
      pricesForCall(env, role, undefined),
    ]);
    return byoRoleOrderFor(creds, role, demotedVendors, stats, registryCatalogView(prices));
  }, { kvTtlSeconds: BYO_ROLE_ORDER_TTL_SECONDS, l1TtlMs: 15_000 });
}
