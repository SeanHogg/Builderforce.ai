/**
 * Start a methodology role (PRD 49 §2.3, sequence 3.1). The gate is file existence,
 * checked by the ONE gate in `@builderforce/agent-tools` (`checkGate`, shared with the
 * runtime's persona registry). A blocked gate posts the message and makes no model call.
 * Pure: the host supplies `exists`, the model call, the post and the localized copy.
 */
import {
  checkGate,
  METHODOLOGY_ROLES,
  type ArtifactId,
  type ChatPersonaState,
  type GateResult,
  type MethodologyRole,
  type WriteScopeEntry,
} from "@builderforce/agent-tools";
import { messageOf } from "../shared/messageOf";

/** The composer send a passed gate's button replays: the role rides as an argument, never a text prefix. */
export interface PersonaSend {
  text: string;
  role: string;
}

export interface PersonaRunMessage {
  kind: "gate-blocked" | "gate-passed" | "error";
  text: string;
  role?: string;
  /** On `gate-passed`: what the Continue button sends. */
  send?: PersonaSend;
}

/** What the tool layer's `writeAllowed` is handed for this run. */
export interface RoleWriteScope {
  roleName: string;
  scope: readonly WriteScopeEntry[] | undefined;
}

/** The copy, from the host's localized chat labels. */
export interface PersonaRunLabels {
  gateBlocked(result: GateResult): string;
  gatePassed(next: string): string;
  unknownRole(name: string): string;
}

export interface PersonaRunDeps {
  /** The resolved registry. Defaults to the four built-ins. */
  roles?: readonly MethodologyRole[];
  exists(path: string): boolean;
  invokeModel(request: string, writeScope: RoleWriteScope): Promise<void>;
  post(message: PersonaRunMessage): void;
  labels: PersonaRunLabels;
}

export interface PersonaRunOutcome {
  started: boolean;
  /** The chat's state after the check, for `saveChatPersona`. */
  state: ChatPersonaState;
}

/** Every gated role's missing artifacts. Throws when `exists` does (the caller keeps the old hints). */
function hintsOf(roles: readonly MethodologyRole[], methodologyDir: string, exists: (path: string) => boolean): Record<string, ArtifactId[]> {
  const hints: Record<string, ArtifactId[]> = {};
  for (const role of roles) {
    if (role.methodology) hints[role.name] = checkGate(role, methodologyDir, exists, roles).missing;
  }
  return hints;
}

/**
 * Runs the gate for `roleName` and, when it passes, the model. An unknown role is refused.
 * A throw from `exists` posts the error and leaves the previous hints unchanged.
 */
export function startPersonaRun(
  roleName: string,
  methodologyDir: string,
  request: string,
  current: ChatPersonaState,
  deps: PersonaRunDeps,
): PersonaRunOutcome {
  const roles = deps.roles ?? METHODOLOGY_ROLES;
  const role = roles.find((entry) => entry.name === roleName);
  if (!role) {
    deps.post({ kind: "error", text: deps.labels.unknownRole(roleName) });
    return { started: false, state: current };
  }
  const state: ChatPersonaState = { ...current, role: roleName, lastRequest: request };
  let result: GateResult;
  try {
    state.hints = hintsOf(roles, methodologyDir, deps.exists);
    result = checkGate(role, methodologyDir, deps.exists, roles);
  } catch (error) {
    deps.post({ kind: "error", text: messageOf(error) });
    return { started: false, state: { ...state, hints: current.hints } };
  }
  if (!result.passed) {
    deps.post({ kind: "gate-blocked", role: roleName, text: deps.labels.gateBlocked(result) });
    return { started: false, state };
  }
  const next = role.methodology?.next;
  if (next) deps.post({ kind: "gate-passed", role: next, text: deps.labels.gatePassed(next), send: { text: request, role: next } });
  deps.invokeModel(request, { roleName, scope: role.methodology?.writeScope }).catch((error: unknown) =>
    deps.post({ kind: "error", role: roleName, text: messageOf(error) }),
  );
  return { started: true, state };
}
