/**
 * `GET /llm/byo-order[?role=<ModelRole>][&projectId=][&arcStage=][&agentic=1|0]` — the
 * tenant's connected-account (BYO) models in the order the gateway would try them for a
 * `byo_pool` call of that role. NO role is a call of its own, not a coding turn: exactly
 * as the completion route reads a body without one, the order is the tenant's precedence
 * (no role ladder, no learned role evidence).
 *
 * WHY THE SERVER ANSWERS. The VS Code client calls some accounts itself (Kimi Code, whose
 * edge refuses our egress). It used to try those first on every turn, whatever the tenant's
 * precedence and whatever the role — a coding turn led with Kimi while Sonnet sat connected.
 * The order is a ROUTING decision (precedence, the role's model ladder, health, learned
 * evidence), so the server owns it and the client reads it here.
 *
 * SAME FUNCTION, SAME INPUTS AS THE GATEWAY. The order comes from {@link orderByoSeeds}, the
 * function the gateway's completion seed (`proxySeed.composeCompletionSeed`) leads a
 * `byo_pool` turn with, fed what the completion route feeds it: the tenant's credentials
 * (`resolveTenantLlmCredentials`), the same demotions (`loadByoDemotedVendors`), the learned
 * role evidence at the same finest scope (`roleRoutingStats` with the turn's project and arc
 * stage), the arc stage on the objective and the price book (`pricesForCall`), and whether
 * the turn is an agentic tool loop (which flagship heads a vendor's group). It never explores
 * (exploration is a per-call random draw).
 *
 * THE ONE INTENDED DIFFERENCE — latency. The gateway's code/verify order applies the latency
 * guard against the isolate's own p50 snapshot (`latencySnapshot()`), which is per-isolate
 * and per-moment; a cached, shared answer cannot reproduce it. This answer passes a NEUTRAL
 * latency input (no samples → no candidate is demoted for being slow).
 *
 * EVERY seed entry is listed, in order — an OpenRouter connection ref included, with
 * `provider: null` (it is not a provider account the client can call). Dropping it would
 * change the head: a client that leads with the first account it can call would lead with
 * Kimi while the tenant's #1 is an OpenRouter connection. `healthy: false` marks a model
 * whose vendor the gateway is demoting right now — an alerted or low-headroom account, or a
 * vendor on a 5xx streak.
 */

import { isModelRole, type ModelRole } from '@builderforce/agent-tools';
import type { ActionModelRankStat } from '@builderforce/learned-routing';
import type { CatalogView } from '@builderforce/model-catalog';
import type { LatencyGuardInput } from '@builderforce/model-router';
import { isArcStage, type ArcStage } from '@builderforce/workload';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { loadByoDemotedVendors, orderByoSeeds } from './byoSeedOrder';
import { REGISTRY_CATALOG_VIEW, pricesForCall, registryCatalogView } from './catalogView';
import { providerForVendor, type LlmProvider } from './llmProviderCatalog';
import { routingInputsVersion } from './routingInputsVersion';
import { roleRoutingStats } from './routingTable';
import { byoVendorIdsFromCredentials, resolveTenantLlmCredentials, type TenantLlmCredentials } from './tenantProviderKeyService';
import { vendorForModel } from './vendors';

export interface ByoRoleOrderModel {
  /** The routed model ref, e.g. `direct/kimi-code/k3` or `openrouter/<org>/<slug>`. */
  ref: string;
  /** The gateway vendor that dispatches it. */
  vendor: string;
  /** The BYO provider account it runs on; null for a ref no provider owns (an OpenRouter connection). */
  provider: LlmProvider | null;
  /** False while the gateway is demoting this vendor (alerted, low headroom, 5xx streak). */
  healthy: boolean;
}

export interface ByoRoleOrder {
  /** The role the order is for; null for a call that named none (the tenant's precedence). */
  role: ModelRole | null;
  models: ByoRoleOrderModel[];
}

/** What the order is asked for — the gateway inputs a client can name. */
export interface ByoRoleOrderQuery {
  /** Absent = the call named no role — the gateway's `role: undefined`, not `code`. */
  role?: ModelRole;
  /** The project the turn is attributed to, already validated as the tenant's. */
  projectId?: number;
  arcStage?: ArcStage;
  /** An agentic tool-loop turn (default) — which flagship heads a vendor's group. */
  agentic: boolean;
}

/** The cached answer: the order plus whether a BYO provider is configured — the input the
 *  route's funding-order read needs (`resolveFundingOrder`), without a second credential read. */
export interface ByoRoleOrderAnswer extends ByoRoleOrder {
  byoConfigured: boolean;
}

/**
 * The query a request asked for, from its raw parameters. An absent or unknown role stays
 * ABSENT — the completion route validates a body's role the same way (`isModelRole`, else
 * none); an arc stage that is not one is dropped; `agentic` is `0` only when said so. Every
 * value comes from a closed set, so the cache key stays bounded. `projectId` is validated
 * against the tenant by the caller (it needs a read). Pure.
 */
export function parseByoOrderQuery(raw: { role?: unknown; arcStage?: unknown; agentic?: unknown }): Omit<ByoRoleOrderQuery, 'projectId'> {
  return {
    ...(isModelRole(raw.role) ? { role: raw.role } : {}),
    ...(isArcStage(raw.arcStage) ? { arcStage: raw.arcStage } : {}),
    agentic: raw.agentic !== '0',
  };
}

/** The neutral latency input — see the module doc for why the guard is not reproduced. */
const NEUTRAL_LATENCY: LatencyGuardInput = Object.freeze({});

/** What one order is computed from, already resolved. */
export interface ByoRoleOrderCall {
  /** Absent = no role: the tenant's precedence, as the gateway orders a role-less call. */
  role?: ModelRole;
  arcStage?: ArcStage;
  /** Default true — the editor's turns are agentic tool loops. */
  agentic?: boolean;
  demotedVendors: ReadonlySet<string>;
  stats?: ReadonlyArray<ActionModelRankStat>;
}

/** The order for one call from already-resolved inputs. Pure. */
export function byoRoleOrderFor(
  creds: TenantLlmCredentials,
  call: ByoRoleOrderCall,
  view: CatalogView = REGISTRY_CATALOG_VIEW,
): ByoRoleOrder {
  const { ordered } = orderByoSeeds({
    connectedByo: byoVendorIdsFromCredentials(creds),
    vendorPriority: creds.vendorPriority,
    providerPriorities: creds.providerPriorities ?? [],
    openRouterConnections: creds.openRouterConnections ?? [],
    selectedModels: creds.byoSelectedModels ?? {},
  }, {
    agentic: call.agentic ?? true,
    ...(call.role ? { role: call.role } : {}),
    ...(call.arcStage ? { arcStage: call.arcStage } : {}),
    demotedVendors: call.demotedVendors,
    ...(call.stats ? { stats: call.stats } : {}),
    latency: NEUTRAL_LATENCY,
  }, view);
  const models = ordered.map((ref): ByoRoleOrderModel => {
    const vendor = vendorForModel(ref);
    return { ref, vendor, provider: providerForVendor(vendor) ?? null, healthy: !call.demotedVendors.has(vendor) };
  });
  return { role: call.role ?? null, models };
}

/** Short: vendor health and learned evidence move without a write that could bump it. */
const BYO_ROLE_ORDER_TTL_SECONDS = 60;

/** One entry per tenant × routing token × query; every part comes from a closed set or a
 *  tenant-validated project id. A role-less query has its own slot (`r-`), never `code`'s. */
export function byoRoleOrderCacheKey(tenantId: number, query: ByoRoleOrderQuery, version: string): string {
  return `byo-role-order:${tenantId}:r${query.role ?? '-'}:p${query.projectId ?? '-'}:s${query.arcStage ?? '-'}:a${query.agentic ? 1 : 0}:v:${version}`;
}

/**
 * The tenant's order for one query, read-through cached behind THE routing token
 * (`routingInputsVersion`: derived from the provider rows and model selections, bumped by
 * the connection, alert and headroom writers). Throws when the credentials cannot be read —
 * the route answers 5xx rather than an empty order the client would read as "nothing
 * connected".
 */
export async function loadByoRoleOrder(env: Env, db: Db, tenantId: number, query: ByoRoleOrderQuery): Promise<ByoRoleOrderAnswer> {
  const version = await routingInputsVersion(env, tenantId);
  return getOrSetCached(env, byoRoleOrderCacheKey(tenantId, query, version), async () => {
    const creds = await resolveTenantLlmCredentials(env, tenantId);
    const connected = byoVendorIdsFromCredentials(creds);
    // Exactly the completion route's reads: evidence at the finest scope (project → tenant
    // → global) for the role and arc stage — and none at all for a role-less call, which
    // the route never reads stats for — and prices only for a cost-first call.
    const role = query.role;
    const [demotedVendors, stats, prices] = await Promise.all([
      loadByoDemotedVendors(env, connected, creds.alertedVendors ?? []),
      role
        ? roleRoutingStats(env, db, {
            tenantId,
            projectId: query.projectId ?? null,
            role,
            ...(query.arcStage ? { arcStage: query.arcStage } : {}),
          })
        : undefined,
      pricesForCall(env, role ?? null, query.arcStage),
    ]);
    const order = byoRoleOrderFor(creds, {
      ...(role ? { role } : {}),
      ...(query.arcStage ? { arcStage: query.arcStage } : {}),
      agentic: query.agentic,
      demotedVendors,
      ...(stats ? { stats } : {}),
    }, registryCatalogView(prices));
    return { ...order, byoConfigured: creds.configuredProviders.length > 0 };
  }, { kvTtlSeconds: BYO_ROLE_ORDER_TTL_SECONDS, l1TtlMs: 15_000 });
}
