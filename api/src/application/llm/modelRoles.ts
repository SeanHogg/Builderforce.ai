/**
 * Model roles + arc stage — the two axes that let routing pick a model suited to the
 * WORK instead of one BYO precedence order for every call.
 *
 * `ModelRole` (plan/code/verify/explore/chat/utility) is the call-purpose axis, DEFINED
 * in `@builderforce/agent-tools` so every surface declaring `spawn_agent` shares one
 * vocabulary. What a role MEANS for routing — its objective — is api-specific and lives
 * here, feeding `orderForRole` (modelPool.ts).
 *
 * The objectives encode the product rule: ANALYSIS runs on the tenant's own chosen
 * order (planning is balanced — whoever the tenant put first plans), and CODE is
 * written by the strongest model the tenant has connected. Cheap roles (explore,
 * utility) lead with the cheapest connected model. Resolution only ever reorders what
 * the tenant actually connected; no role names a vendor.
 *
 * `ArcStage` is the project-lifecycle axis (idea/make/run/measure/reach). It rides a
 * run's dispatch payload as an ephemeral nudge exactly like `routingBias` — a canvas
 * phase is a per-browser choice that no durable field stores (see
 * `frontend/src/lib/canvasPhases.ts`), so it gets no column either.
 */

import { isModelRole, type ModelRole } from '@builderforce/agent-tools';
import { rankModelsForAction, type ActionModelRankStat } from '@builderforce/learned-routing';
import { isBalancedObjective, orderForRole } from './modelPool';

export { isModelRole, type ModelRole };

/** Mirrors `frontend/src/lib/canvasPhases.ts`'s `CanvasPhase` — an independent
 *  literal union because that module is frontend-only and this one runs in the Worker. */
export type ArcStage = 'idea' | 'make' | 'run' | 'measure' | 'reach';

const ARC_STAGE_SET = new Set<string>(['idea', 'make', 'run', 'measure', 'reach']);

export function isArcStage(value: unknown): value is ArcStage {
  return typeof value === 'string' && ARC_STAGE_SET.has(value);
}

/** Pull toward the tenant's STRONGEST connected tier (+1) or CHEAPEST (-1); 0 keeps
 *  the tenant's own precedence untouched. */
const ROLE_OBJECTIVE: Readonly<Record<ModelRole, number>> = {
  code: 1,
  plan: 0,
  chat: 0,
  verify: -0.5,
  explore: -1,
  utility: -1,
};

/** A run's arc stage nudges every role the same way its question points: Idea and
 *  Reach are breadth and volume (cheaper), Make is the stage shipping the thing
 *  (stronger), Run/Measure sit near neutral. */
const ARC_STAGE_NUDGE: Readonly<Record<ArcStage, number>> = {
  idea: -0.3,
  make: 0.3,
  run: 0,
  measure: -0.2,
  reach: -0.3,
};

/** A role's objective plus an optional arc-stage nudge, clamped to [-1, 1]. No role →
 *  0, so an unset role never reorders anything. Pure. */
export function resolveRoleObjective(role: ModelRole | undefined, arcStage?: ArcStage): number {
  if (!role) return 0;
  const nudge = arcStage ? ARC_STAGE_NUDGE[arcStage] : 0;
  return Math.max(-1, Math.min(1, ROLE_OBJECTIVE[role] + nudge));
}

/**
 * Does learned evidence get a say in this call's order? Only where the SYSTEM is
 * choosing — a role that pulls toward the strongest or cheapest model. A balanced role
 * (planning, chat) runs on the order the tenant set, and a model's track record does not
 * override a choice the tenant made on purpose. Pure.
 */
export function roleUsesLearnedRanking(role: ModelRole | undefined, arcStage?: ArcStage): boolean {
  return !isBalancedObjective(resolveRoleObjective(role, arcStage));
}

export interface RankConnectedOptions {
  role?: ModelRole;
  arcStage?: ArcStage;
  /** Vendors known to be failing — never lead, whatever tier or history says. */
  demotedVendors?: ReadonlySet<string>;
  /** Learned per-model stats for this call (per role on the gateway, per action type
   *  on a cloud run). Absent or cold → the role's tier order stands. */
  stats?: ReadonlyArray<ActionModelRankStat>;
  minSamples?: number;
  /** Client SSM recall nudge on top of the learned score. */
  bias?: Record<string, number>;
}

/**
 * THE order of a tenant's connected models for one call — shared by the gateway
 * completion seed and the cloud-run pick, so a chat turn and a cloud run with the same
 * role and the same evidence lead with the same model.
 *
 * 1. The role orders by tier ({@link orderForRole}): code → strongest, explore → cheapest,
 *    plan/chat → the tenant's order untouched.
 * 2. Where the role lets the system choose ({@link roleUsesLearnedRanking}), models with
 *    enough evidence re-rank by what they actually delivered; the tier order stays the
 *    tie-break and the order for everything still cold.
 * 3. Vendor HEALTH is the outermost key, re-applied last, so a good history cannot lift
 *    a vendor that is failing right now back to the lead.
 *
 * Never adds, drops or invents a model. Pure.
 */
export function rankConnectedForRole(models: readonly string[], opts: RankConnectedOptions = {}): string[] {
  const byRole = orderForRole(models, resolveRoleObjective(opts.role, opts.arcStage), opts.demotedVendors);
  if (!roleUsesLearnedRanking(opts.role, opts.arcStage)) return byRole;
  const bias = opts.bias && Object.keys(opts.bias).length > 0 ? opts.bias : undefined;
  const learned = rankModelsForAction(byRole, opts.stats, { minSamples: opts.minSamples, ...(bias ? { bias } : {}) });
  return orderForRole(learned, 0, opts.demotedVendors);
}
