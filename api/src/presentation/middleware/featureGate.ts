import type { Context } from 'hono';
import type { Env, HonoEnv } from '../../env';
import { TenantPlan } from '../../domain/shared/types';
import { resolveIsSuperadmin } from '../../infrastructure/auth/superadminFlag';
import { resolveTenantPlan } from '../routes/llmRoutes';
import {
  evaluateFeatureEntitlement,
  evaluateFrontierAccess,
  type PlanFeature,
  type FeatureEntitlement,
  type FrontierAccess,
} from '../../domain/tenant/planFeatures';
import { listTenantProviderKeys } from '../../application/llm/tenantProviderKeyService';

/**
 * Feature gate — the ONE reusable entry point route handlers use to gate a
 * paid-plan feature. Composes the three sources of truth that were previously
 * re-derived inline at every call site:
 *
 *   • {@link resolveTenantPlan}     — effective plan + tenant premium override
 *   • {@link resolveIsSuperadmin}   — the caller's platform-superadmin flag
 *   • {@link evaluateFeatureEntitlement} — the pure verdict
 *
 * A superadmin (or a comped `premiumOverride` tenant) is entitled to everything, so
 * platform operators never see an "upgrade" wall. On a genuine miss the gate answers
 * **402 Payment Required** (the caller is authenticated + authorized — they just need
 * a higher plan) and names the exact feature + the plan that unlocks it.
 */

/** Map the gateway's string effectivePlan to the plan enum. */
function toTenantPlan(ep: 'free' | 'pro' | 'teams'): TenantPlan {
  if (ep === 'pro') return TenantPlan.PRO;
  if (ep === 'teams') return TenantPlan.TEAMS;
  return TenantPlan.FREE;
}

const PLAN_LABEL: Record<TenantPlan, string> = {
  [TenantPlan.FREE]: 'Free',
  [TenantPlan.PRO]: 'Pro',
  [TenantPlan.TEAMS]: 'Teams',
};

/**
 * Resolve a caller's entitlement to `feature`. `userId` optional — when absent the
 * superadmin dimension is simply skipped (machine callers can't be superadmins).
 */
export async function resolveFeatureEntitlement(
  env: Env,
  tenantId: number,
  userId: string | undefined | null,
  feature: PlanFeature,
): Promise<FeatureEntitlement> {
  const [access, isSuperadmin] = await Promise.all([
    resolveTenantPlan(env, tenantId),
    resolveIsSuperadmin(env, userId),
  ]);
  return evaluateFeatureEntitlement({
    feature,
    effectivePlan: toTenantPlan(access.effectivePlan),
    premiumOverride: access.premiumOverride,
    isSuperadmin,
  });
}

/**
 * Boolean convenience for decision sites that ATTACH a paid feature rather than
 * error on it (e.g. "store the psychometric profile only if entitled"). Superadmin-
 * and premium-override-aware, same as the erroring gate.
 */
export async function tenantHasFeature(
  env: Env,
  tenantId: number,
  userId: string | undefined | null,
  feature: PlanFeature,
): Promise<boolean> {
  return (await resolveFeatureEntitlement(env, tenantId, userId, feature)).entitled;
}

// ---------------------------------------------------------------------------
// Frontier / premium-MODEL access — the DB-touching wrapper over
// {@link evaluateFrontierAccess}. Distinct from the boolean feature gate because
// it adds the BYO dimension: a tenant who connected their OWN frontier account
// (Anthropic subscription OR a BYO api-key) funds frontier calls with their own
// tokens, so the paid-plan wall does not apply. THE one place every "can use a
// frontier model" gate (Evermind teach/distil, premium model pick, model-choice
// unlock) is decided — so no site re-derives `plan || byo || superadmin`.
// ---------------------------------------------------------------------------

/**
 * Resolve a caller's entitlement to FRONTIER models. Composes plan + superadmin +
 * whether the tenant has ANY connected BYO frontier provider (the cheapest existing
 * check — `listTenantProviderKeys` selects only provider+auth_type, no secrets).
 * Best-effort on the BYO read (a failure degrades to "no BYO", never blocks the gate
 * from resolving). `userId` optional — absent → superadmin dimension skipped.
 */
export async function resolveFrontierAccess(
  env: Env,
  tenantId: number,
  userId: string | undefined | null,
): Promise<FrontierAccess> {
  const [access, isSuperadmin, providers] = await Promise.all([
    resolveTenantPlan(env, tenantId),
    resolveIsSuperadmin(env, userId),
    listTenantProviderKeys(env, tenantId).catch(() => []),
  ]);
  return evaluateFrontierAccess({
    effectivePlan: toTenantPlan(access.effectivePlan),
    premiumOverride: access.premiumOverride,
    isSuperadmin,
    hasConnectedByoFrontier: providers.length > 0,
  });
}

/** Boolean convenience — "may this tenant use frontier models?" Superadmin-, premium-
 *  override-, BYO-, and paid-plan-aware. Use at any frontier decision site. */
export async function tenantCanUseFrontierModels(
  env: Env,
  tenantId: number,
  userId: string | undefined | null,
): Promise<boolean> {
  return (await resolveFrontierAccess(env, tenantId, userId)).entitled;
}

/**
 * Route-handler gate for a frontier-model action (teach/distil from a top model,
 * pin a frontier teacher). Returns `null` to proceed, or a **402** naming the two
 * ways to unlock — upgrade OR connect your own account:
 *
 *   const gate = await requireFrontierAccess(c);
 *   if (gate) return gate;
 */
export async function requireFrontierAccess(c: Context<HonoEnv>): Promise<Response | null> {
  const tenantId = c.get('tenantId') as number;
  const userId = c.get('userId') as string | undefined;
  if (await tenantCanUseFrontierModels(c.env, tenantId, userId)) return null;
  return c.json({
    error: 'Upgrade to a paid plan, or connect your own frontier account (Settings ▸ API Keys), to use a frontier model.',
    code: 'upgrade_required' as const,
    feature: 'frontierModels' as const,
    requiredPlan: TenantPlan.PRO,
    upgrade: true as const,
  }, 402);
}

/**
 * The standardized upgrade-required payload. Names the feature and the plan that
 * unlocks it so the client can route to the right upsell instead of guessing.
 */
export function featureGateBody(ent: FeatureEntitlement) {
  return {
    error: `Upgrade to ${PLAN_LABEL[ent.requiredPlan]} to unlock ${ent.label}.`,
    code: 'upgrade_required' as const,
    feature: ent.feature,
    requiredPlan: ent.requiredPlan,
    currentPlan: ent.currentPlan,
    upgrade: true as const,
  };
}

/**
 * Route-handler gate. Returns `null` when the caller may proceed, or a **402**
 * `Response` (the standardized upgrade-required body) to return directly:
 *
 *   const gate = await requireFeature(c, 'psychometricPersona');
 *   if (gate) return gate;
 */
export async function requireFeature(
  c: Context<HonoEnv>,
  feature: PlanFeature,
): Promise<Response | null> {
  const tenantId = c.get('tenantId') as number;
  const userId = c.get('userId') as string | undefined;
  const ent = await resolveFeatureEntitlement(c.env, tenantId, userId, feature);
  if (ent.entitled) return null;
  return c.json(featureGateBody(ent), 402);
}
