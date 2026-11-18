/**
 * THE order of a tenant's connected-account (BYO) seed models for one call.
 *
 * Two readers, one function, so they cannot drift:
 *   • the gateway completion seed (`proxySeed.composeCompletionSeed`), which leads a
 *     `byo_pool` / auto-select turn with the result;
 *   • `GET /llm/byo-order` (`byoRoleOrder.ts`), which hands the same order to the VS Code
 *     client so the accounts it calls itself are tried in the order the gateway would try
 *     them.
 *
 * The steps:
 *   1. each connected vendor's seed group (`byoAutoSeedModels`: its selection, else its
 *      flagships), sorted by the tenant's precedence, then the CODE ladder, then tier;
 *   2. merged with the OpenRouter connections by their SHARED persisted rank — "cheap
 *      coders, then my Claude account, then Frontier" is one list, not two;
 *   3. ordered for what the call is FOR (`rankConnectedForRole`): the role's model ladder
 *      for plan / review / code, cheapest-first for verify / explore / utility, the tenant's
 *      order for chat — with vendor HEALTH re-applied as the outermost key.
 *
 * Pure: the caller resolves credentials, demotions and evidence.
 */

import type { ModelRole } from '@builderforce/agent-tools';
import type { ActionModelRankStat, RoutingExploration } from '@builderforce/learned-routing';
import type { CatalogView } from '@builderforce/model-catalog';
import type { ArcStage } from '@builderforce/workload';
import { byoAutoSeedModels } from './modelPool';
import { rankConnectedForRole } from './modelRoles';
import { connectionModelRefs, type OpenRouterConnection } from './openRouterConnectionService';
import { vendorForModel } from './vendors';
import { loadDemotedVendors, type VendorHealthEnv } from './vendors/vendorHealth';

/** What the tenant connected and how they ranked it — read off their credentials. */
export interface ByoSeedAccounts {
  /** Gateway vendor ids the tenant serves from their own account this call. */
  connectedByo: ReadonlySet<string>;
  /** The tenant's precedence as ordered vendor ids (`byoVendorPriorityOrder`). */
  vendorPriority: readonly string[];
  /** Provider ranks in the shared precedence space, to interleave with connections. */
  providerPriorities: readonly { vendor: string; priority: number | null }[];
  openRouterConnections: readonly OpenRouterConnection[];
  /** Each vendor's selected models (1165), keyed by dispatch vendor. */
  selectedModels: Readonly<Record<string, readonly string[]>>;
}

/** What this call is, and what is known about the vendors right now. */
export interface ByoSeedCall {
  /** An agentic tool-loop turn — which flagship heads a vendor's group. */
  agentic: boolean;
  role?: ModelRole;
  arcStage?: ArcStage;
  /** Vendors failing right now (5xx streak ∪ the tenant's alerted accounts). */
  demotedVendors: ReadonlySet<string>;
  stats?: ReadonlyArray<ActionModelRankStat>;
  explore?: RoutingExploration;
}

export interface ByoSeedOrder {
  /** Before the role order: the tenant's precedence merged with the connections. */
  merged: string[];
  /** THE order the gateway seeds with. */
  ordered: string[];
}

export function orderByoSeeds(accounts: ByoSeedAccounts, call: ByoSeedCall, view: CatalogView): ByoSeedOrder {
  const providerSeeds = byoAutoSeedModels(accounts.connectedByo, {
    agentic: call.agentic,
    vendorPriority: accounts.vendorPriority,
    ...(call.demotedVendors.size ? { demotedVendors: call.demotedVendors } : {}),
    // A provider the tenant chose models for contributes that ordered list, not its flagships.
    ...(Object.keys(accounts.selectedModels).length ? { selectedModels: accounts.selectedModels } : {}),
  });
  // Grouped per vendor: a vendor with several seeds keeps them all, in its own order.
  const providerSeedsByVendor = new Map<string, string[]>();
  for (const model of providerSeeds) {
    const vendor = vendorForModel(model);
    providerSeedsByVendor.set(vendor, [...(providerSeedsByVendor.get(vendor) ?? []), model]);
  }
  const rankedSeeds: Array<{ priority: number | null; tie: number; models: string[] }> = [
    ...accounts.providerPriorities.map((entry, tie) => ({
      priority: entry.priority,
      tie,
      models: providerSeedsByVendor.get(entry.vendor) ?? [],
    })),
    ...accounts.openRouterConnections.map((connection, tie) => ({
      priority: connection.priority,
      tie: accounts.providerPriorities.length + tie,
      models: connectionModelRefs([connection]),
    })),
  ];
  rankedSeeds.sort((a, b) => {
    const ar = a.priority ?? Number.POSITIVE_INFINITY;
    const br = b.priority ?? Number.POSITIVE_INFINITY;
    return ar === br ? a.tie - b.tie : ar - br;
  });
  const rankedModels = rankedSeeds.flatMap((entry) => entry.models);
  const merged = [...new Set([
    ...rankedModels,
    ...providerSeeds.filter((model) => !rankedModels.includes(model)),
  ])];
  // Order for what this call is FOR, with health re-applied as the outermost key: the
  // rank merge above re-sorts by persisted priority alone, which is how a vendor
  // `byoAutoSeedModels` had demoted for faulting got pulled back to the lead whenever the
  // tenant ranked it first.
  const ordered = rankConnectedForRole(merged, {
    ...(call.role ? { role: call.role } : {}),
    ...(call.arcStage ? { arcStage: call.arcStage } : {}),
    demotedVendors: call.demotedVendors,
    ...(call.stats ? { stats: call.stats } : {}),
    ...(call.explore ? { explore: call.explore } : {}),
  }, view);
  return { merged, ordered };
}

/**
 * The connected vendors to demote out of the lead, from two independent sources:
 *   • `loadDemotedVendors` — a 5xx streak against the VENDOR, keyspace global. It cannot
 *     speak for one owner's account, which is why it alone left a tenant whose account
 *     returned 401 leading the seed on every request.
 *   • `alertedVendors` — a 401/403/out-of-budget (or low headroom) recorded for THIS
 *     TENANT's account (`providerAuthAlerts`, `providerHeadroom`), resolved with the
 *     tenant's credentials.
 * No reads when nothing is connected.
 */
export async function loadByoDemotedVendors(
  env: VendorHealthEnv,
  connectedByo: ReadonlySet<string>,
  alertedVendors: readonly string[],
): Promise<Set<string>> {
  const streakDemoted = await loadDemotedVendors(env, connectedByo);
  return alertedVendors.length ? new Set([...streakDemoted, ...alertedVendors]) : streakDemoted;
}
