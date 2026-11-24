/**
 * PRD 49 methodology personas. Data, not branches — the role table is
 * `@builderforce/agent-tools` `METHODOLOGY_ROLES` (shared with the editor), given the
 * plugin fields here. Registered through the existing `registerBuiltins` — there is no
 * second registry.
 */
import { METHODOLOGY_ROLES } from "@builderforce/agent-tools";
import type { PersonaPlugin } from "./types.js";

export { ARTIFACT_REL, METHODOLOGY_ORDER, RUN_RECORD_DIR } from "@builderforce/agent-tools";

export const METHODOLOGY_PERSONAS: readonly PersonaPlugin[] = METHODOLOGY_ROLES.map((role) => ({
  ...role,
  capabilities: [...role.capabilities],
  tools: [],
  source: "builtin",
}));

/** Register the four roles on the existing registry. Keyed by `name`. */
export function registerMethodologyPersonas(registry: {
  registerBuiltins(roles: Array<PersonaPlugin>): void;
}): void {
  registry.registerBuiltins([...METHODOLOGY_PERSONAS]);
}
