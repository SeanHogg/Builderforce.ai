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
 * No vscode settings surface exists for these keys, so the bag is `process.env`
 * (same contract as the package docs).
 */

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
 * The catalog model a child run should send.
 *
 * A strict parent pick (the user's explicit model) is copied as-is. Otherwise a
 * role pin wins when present, else the parent's model (which may itself be
 * undefined — gateway auto).
 */
export function modelForChildRun(
  parent: { model?: string; modelStrict?: boolean },
  role: string | undefined | null,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (parent.modelStrict) return parent.model;
  return roleModelPin(role, env) ?? parent.model;
}
