import * as vscode from "vscode";
import { getProjectEvermindHead } from "./bfApi";
import { getModels, isModelAllowed } from "./gateway";
import { isLocalModelRef } from "./localModels";
import { getSelectedProject } from "./projectState";

/**
 * The gateway pin (`project_evermind:<projectId>`) that expands to a project's
 * CURRENT Evermind head at call time. Sending the pin — rather than a resolved
 * `evermind/<ref>` — means each completion follows the project's latest learned
 * version (pull-on-boundary), even inside a long-lived chat session. Mirrors
 * `PROJECT_EVERMIND_MODEL_PREFIX` on the gateway (api/.../projectEvermind.ts).
 */
const PROJECT_EVERMIND_PIN = "project_evermind:";

export type EffectiveModelChoice = {
  model?: string;
  modelStrict?: boolean;
  routingMode: "auto" | "byo_pool";
};

/** Undefined means inherit project/config. Once the user chooses, Auto and Pool
 * remain explicit choices rather than collapsing back into that inheritance. */
let selected: { mode: "auto" | "byo_pool" | "model"; model?: string } | undefined;
const emitter = new vscode.EventEmitter<string | undefined>();
export const onModelChange = emitter.event;

export function setSelectedModel(model: string | undefined): void {
  selected = model ? { mode: "model", model } : { mode: "auto" };
  emitter.fire(model);
}

export function setSelectedModelPool(): void {
  selected = { mode: "byo_pool" };
  emitter.fire(undefined);
}

/** The configured fallback model (empty → let the gateway auto-select). */
function defaultModel(): string | undefined {
  return vscode.workspace.getConfiguration("builderforce").get<string>("defaultModel") || undefined;
}

export async function resolveEffectiveModelChoice(secrets: vscode.SecretStorage): Promise<EffectiveModelChoice> {
  if (selected?.mode === "auto") return { routingMode: "auto" };
  if (selected?.mode === "byo_pool") return { routingMode: "byo_pool" };
  if (selected?.mode === "model" && selected.model) {
    const model = await entitled(secrets, selected.model);
    return model ? { model, modelStrict: true, routingMode: "auto" } : { routingMode: "auto" };
  }
  const project = getSelectedProject();
  if (project) {
    const head = await getProjectEvermindHead(secrets, project.id).catch(() => undefined);
    // Every editor turn is a CODING turn, so the project's Evermind is the default only
    // while it clears the coding-quality gate (≥90% of the frontier baseline on the
    // coding eval, for the current head). The gateway enforces the same gate when it
    // expands the pin; checking here keeps the chat from advertising a model it won't get.
    if (head?.inferenceEnabled && head.seeded && head.codingGate?.qualified === true) {
      return { model: `${PROJECT_EVERMIND_PIN}${project.id}`, routingMode: "auto" };
    }
  }
  const model = await entitled(secrets, defaultModel());
  return { ...(model ? { model } : {}), routingMode: "auto" };
}

/**
 * Drop a pin the tenant's plan can't actually use, falling back to gateway
 * auto-select.
 *
 * A pin outlives the entitlement that justified it: a hand-edited
 * `builderforce.defaultModel`, a pick made while on Pro, or a trial that lapsed.
 * The gateway then refuses EVERY turn with a 402 ("Premium models … require a
 * validated card on file") — a chat that is simply broken, naming a model the
 * user never knowingly selected. Falling back to auto keeps a free-plan user on
 * the free BuilderForce models (which their allowance covers) instead.
 *
 * Best-effort: if entitlements can't be read (offline, signed out) the pin is
 * honoured unchanged, so this can never take away a model that does work.
 */
async function entitled(
  secrets: vscode.SecretStorage,
  model: string | undefined,
): Promise<string | undefined> {
  if (!model) return undefined;
  // An on-device model is not in the tenant's catalog and never will be: it is served by
  // a runtime on this machine, bills nothing, and needs no plan. Entitlement is a
  // statement about what the GATEWAY will serve, so applying it here would drop a
  // perfectly good local pin the moment the user signed in — the exact failure this
  // function exists to prevent, inverted.
  if (isLocalModelRef(model)) return model;
  const choices = await getModels(secrets).catch(() => undefined);
  if (!choices) return model;
  return isModelAllowed(choices, model) ? model : undefined;
}
