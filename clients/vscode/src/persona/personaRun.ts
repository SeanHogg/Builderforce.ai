/**
 * Start a methodology role (PRD 49 §2.3). The gate is file existence.
 * A blocked gate posts the message and makes no model call.
 */
import { checkGate, METHODOLOGY_PERSONAS, type GateResult } from "./methodologyGatePort";

export interface PersonaRunMessage {
  kind: "gate-blocked" | "gate-passed" | "error" | "started";
  text: string;
  role?: string;
}

export interface PersonaRunDeps {
  exists(path: string): boolean;
  invokeModel?(request: string): Promise<void>;
  post(message: PersonaRunMessage): void;
}

export function gateBlockedText(result: GateResult): string {
  const producers = result.missing.map((artifact) => result.producers[artifact] ?? "the role that writes it");
  return `**${result.role}** needs ${result.missing.join(" and ")} first. Run ${[...new Set(producers)].join(" and ")}, or turn Role off.`;
}

export function gatePassedText(next: string): string {
  return `Gate passed. Continue as **${next}** on the same request?`;
}

/** Returns false when the gate blocked the run. The model is not called. */
export function startPersonaRun(
  roleName: string,
  methodologyDir: string,
  request: string,
  deps: PersonaRunDeps,
): boolean {
  const role = METHODOLOGY_PERSONAS.find((entry) => entry.name === roleName);
  if (!role) {
    deps.post({ kind: "error", text: `Unknown role ${roleName}.` });
    return false;
  }
  let result: GateResult;
  try {
    result = checkGate(role, methodologyDir, deps.exists);
  } catch (error) {
    deps.post({ kind: "error", text: error instanceof Error ? error.message : String(error) });
    return false;
  }
  if (!result.passed) {
    deps.post({ kind: "gate-blocked", role: roleName, text: gateBlockedText(result) });
    return false;
  }
  const next = role.methodology?.next;
  if (next) deps.post({ kind: "gate-passed", role: next, text: gatePassedText(next) });
  if (deps.invokeModel) void deps.invokeModel(request);
  else deps.post({ kind: "started", role: roleName, text: request });
  return true;
}
