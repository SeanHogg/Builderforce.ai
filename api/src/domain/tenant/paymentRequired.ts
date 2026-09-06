/**
 * THE 402 "upgrade required" body.
 *
 * The platform had two: `featureGateBody` answered `{ code, feature, requiredPlan,
 * currentPlan, upgrade: true }` and the plan-limit guards answered `{ error,
 * upgradeRequired: true, currentPlan }`, with the creation-session quota, the
 * ingestion cap and the strict-pin gate each spelling a third variant. The
 * frontend's `PlanLimitError` read only `upgradeRequired`, so a feature gate's
 * 402 — which never carried that key — fell through to the generic reading and
 * lost the plan that would actually unlock it.
 *
 * One envelope: every upgrade-shaped 402 carries `upgradeRequired: true` (what
 * the client narrows on), a `code` naming which gate refused, the plan the
 * caller is on and, when a specific plan unlocks it, the plan to upgrade to.
 * Lives in the domain because both the route middleware and the gateway (which
 * cannot import the middleware without a cycle) answer with it.
 *
 * NOT for a purchase (`checkoutRequired`) or a card-on-file refusal
 * (`premiumModelGateBody`): those are 402s an upgrade would not cure, and
 * carrying `upgradeRequired` on them would send a person to the wrong door.
 */
import type { TenantPlan } from '../shared/types';
import type { PlanFeature } from './planFeatures';

export type UpgradeRequiredCode =
  | 'upgrade_required'
  | 'plan_limit_reached'
  | 'CREATION_SESSION_QUOTA'
  | 'ingestion_limit_exceeded'
  | 'strict_pin_not_allowed';

export interface UpgradeRequiredBody {
  error: string;
  code: UpgradeRequiredCode;
  upgradeRequired: true;
  /** The plan the caller is on, when the gate knows it. */
  currentPlan?: TenantPlan | string;
  /** The plan that unlocks what was refused, when one specific plan does. */
  requiredPlan?: TenantPlan;
  /** The gated feature, for a feature gate. */
  feature?: PlanFeature | 'frontierModels';
  /** Quota gates: what was used against what was allowed. */
  usage?: number;
  limit?: number;
}

export function upgradeRequiredBody(input: Omit<UpgradeRequiredBody, 'upgradeRequired'>): UpgradeRequiredBody {
  return { ...input, upgradeRequired: true };
}
