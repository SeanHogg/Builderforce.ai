/**
 * Multi-model role routing for native Brain runs.
 *
 * Operator config (`ROLE_MODELS` / `ROLE_MODEL_DEFAULT` on the env bag) maps a
 * call-purpose role onto a catalog model id. The resolver lives in
 * `@builderforce/learned-routing`; this module is the vscode seam that reads the
 * bag and overlays the pin onto a parent/child pick.
 *
 * Explicit user model selection (`modelStrict`) still wins. Undefined pin =
 * unchanged — we never invent a model id.
 *
 * The env bag is `process.env` (same contract as the package docs). The editor's own
 * settings (`builderforce.models.*`) sit ABOVE it — see `stageModels.ts`.
 */

import { roleLeansCheap } from "@builderforce/agent-tools";
import { parseRoleModelConfig, resolveModelForRole } from "@builderforce/learned-routing";

/** Native editor turns are coding turns (same default as spawn_agent). */
export const NATIVE_RUN_ROLE = "code";

/** Catalog model id for a role, or undefined when the operator has not pinned one. */
export function roleModelPin(
  role: string | undefined | null,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return resolveModelForRole(role, parseRoleModelConfig(env));
}

/**
 * A role's model ONLY when `ROLE_MODELS` names that role — never `ROLE_MODEL_DEFAULT`.
 * For the stages that must not inherit the operator's catch-all (`subagent`, `quick`):
 * a default there would shadow every per-role child pin and every code model.
 */
export function explicitRoleModelPin(role: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const { byRole } = parseRoleModelConfig(env);
  return byRole ? resolveModelForRole(role, { byRole }) : undefined;
}

/**
 * The catalog model a child run should send.
 *
 * A strict parent pick (the user's explicit model) is copied as-is. Otherwise the
 * editor's sub-agent stage model (`builderforce.models.subagent`, carried on the parent
 * as `subagentModel`) wins, then a role pin, else the parent's model (which may itself be
 * undefined — gateway auto) — except for a role that leads with the cheaper models
 * (`verify`, `explore`, `utility`): that child is left to the gateway, which routes its
 * role cost-first, instead of checking or reading on the coder's model.
 */
export function modelForChildRun(
  parent: { model?: string; modelStrict?: boolean; subagentModel?: string },
  role: string | undefined | null,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (parent.modelStrict) return parent.model;
  return parent.subagentModel || roleModelPin(role, env) || (roleLeansCheap(role) ? undefined : parent.model);
}
