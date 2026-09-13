/**
 * Model roles + arc stage — the two axes that let routing pick a model suited to
 * the WORK instead of one global BYO precedence order for every call.
 *
 * `ModelRole` is the call-purpose axis (plan/code/verify/explore/chat/utility),
 * re-exported from `@builderforce/agent-tools` where it is DEFINED — that package
 * is the shared contract both the cloud engine and the extension host declare
 * `spawn_agent`'s schema against, so the type has exactly one source. Everything
 * in THIS file — the objective each role implies, and the arc-stage nudge on top
 * of it — is api-specific (it exists to feed {@link byoAutoSeedModels} /
 * `pickCloudModel`) and has no business living in a zero-dependency package.
 *
 * `ArcStage` is the project-lifecycle axis (idea/make/run/measure/reach — see
 * [[arc-is-five-stages-expand-folded-into-reach]]). It is deliberately NOT a new
 * axis competing with role: a role changes within one run (a coding session that
 * delegates a read-only lookup is still one "make"-stage session), while arc stage
 * describes the whole run. There is also deliberately no new DB column for it —
 * `frontend/src/lib/canvasPhases.ts` documents that a canvas's phase is a
 * per-session BROWSER choice with "no field anywhere stores it", and this stays
 * consistent with that: arc stage rides the run dispatch payload exactly the way
 * `routingBias` already does (see `parseRoutingBias` / `parseArcStage` in
 * `cloudDispatch.ts`), an ephemeral nudge, never a durable fact.
 */

import { isModelRole, MODEL_ROLES, type ModelRole } from '@builderforce/agent-tools';

export { isModelRole, MODEL_ROLES, type ModelRole };

/** Mirrors `frontend/src/lib/canvasPhases.ts`'s `CanvasPhase` — kept as an
 *  independent literal union (not an import) because that module is frontend-only
 *  and this one must stay importable from the Worker. */
export type ArcStage = 'idea' | 'make' | 'run' | 'measure' | 'reach';

export const ARC_STAGES: readonly ArcStage[] = ['idea', 'make', 'run', 'measure', 'reach'];

const ARC_STAGE_SET = new Set<string>(ARC_STAGES);

export function isArcStage(value: unknown): value is ArcStage {
  return typeof value === 'string' && ARC_STAGE_SET.has(value);
}

/**
 * Each role's base pull toward the tenant's STRONGEST reachable tier (+1) or
 * CHEAPEST reachable tier (-1); 0 is balanced (the tenant's own precedence order,
 * untouched). DATA, not a per-vendor default — {@link rankByObjective} only ever
 * reorders models the tenant actually connected/selected, never invents one.
 */
export const ROLE_OBJECTIVE: Readonly<Record<ModelRole, number>> = {
  code: 1,
  plan: 0.4,
  verify: -0.5,
  explore: -1,
  chat: 0,
  utility: -1,
};

/** A run's arc stage nudges every role's objective the same amount, in the
 *  direction that stage's own question points: Idea and Reach are about volume
 *  and breadth (favour cheap, fast answers); Make is the stage actually shipping
 *  the thing (favour quality); Run/Measure sit closer to neutral. */
const ARC_STAGE_NUDGE: Readonly<Record<ArcStage, number>> = {
  idea: -0.3,
  make: 0.3,
  run: 0,
  measure: -0.2,
  reach: -0.3,
};

/** Combine a role's base objective with an optional arc-stage nudge, clamped to
 *  [-1, 1]. No role → perfectly balanced (0), so an unset role never reorders
 *  anything. Pure + unit-testable. */
export function resolveRoleObjective(role: ModelRole | undefined, arcStage?: ArcStage): number {
  if (!role) return 0;
  const nudge = arcStage ? ARC_STAGE_NUDGE[arcStage] : 0;
  return Math.max(-1, Math.min(1, ROLE_OBJECTIVE[role] + nudge));
}
