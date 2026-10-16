/**
 * What a call is FOR, as a number the ordering can use: +1 pulls toward the strongest
 * model, -1 toward the cheapest, 0 leaves the tenant's own order alone.
 *
 * The objectives encode the product rule: ANALYSIS runs on the tenant's chosen order
 * (whoever the tenant put first plans), CODE is written by the strongest model on
 * offer, and cheap roles (explore, utility) lead with the cheapest. An arc stage nudges
 * every role the same way its question points.
 */

import type { ModelRole } from '@builderforce/agent-tools';
import type { ArcStage } from '@builderforce/workload';

const ROLE_OBJECTIVE: Readonly<Record<ModelRole, number>> = {
  code: 1,
  plan: 0,
  chat: 0,
  verify: -0.5,
  explore: -1,
  utility: -1,
};

/** Idea and Reach are breadth and volume (cheaper), Make ships the thing (stronger),
 *  Run/Measure sit near neutral. */
const ARC_STAGE_NUDGE: Readonly<Record<ArcStage, number>> = {
  idea: -0.3,
  make: 0.3,
  run: 0,
  measure: -0.2,
  reach: -0.3,
};

/** The BALANCED band: an objective this close to 0 leaves the tenant's order alone
 *  rather than reordering on a barely-there preference. */
export const BALANCED_OBJECTIVE_THRESHOLD = 0.15;

/** A role's objective plus an optional arc-stage nudge, clamped to [-1, 1]. No role ->
 *  0, so an unset role never reorders anything. Pure. */
export function resolveRoleObjective(role: ModelRole | undefined, arcStage?: ArcStage): number {
  if (!role) return 0;
  const nudge = arcStage ? ARC_STAGE_NUDGE[arcStage] : 0;
  return Math.max(-1, Math.min(1, ROLE_OBJECTIVE[role] + nudge));
}

/** Is this objective BALANCED — the tenant's own order stands? Pure. */
export function isBalancedObjective(objective: number): boolean {
  return Math.abs(objective) < BALANCED_OBJECTIVE_THRESHOLD;
}

/** Is this objective COST-FIRST — the cheapest capable model should lead? Pure. */
export function isCostFirstObjective(objective: number): boolean {
  return objective <= -BALANCED_OBJECTIVE_THRESHOLD;
}

/**
 * Does learned evidence get a say? Only where the SYSTEM is choosing — a role that
 * pulls toward the strongest or cheapest model. A balanced role runs on the order the
 * tenant set; a model's track record does not override a choice made on purpose. Pure.
 */
export function roleUsesLearnedRanking(role: ModelRole | undefined, arcStage?: ArcStage): boolean {
  return !isBalancedObjective(resolveRoleObjective(role, arcStage));
}
