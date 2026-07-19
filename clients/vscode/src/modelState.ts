import * as vscode from "vscode";
import { getProjectEvermindHead } from "./bfApi";
import { getModels, isModelAllowed } from "./gateway";
import { getSelectedProject } from "./projectState";

/**
 * The gateway pin (`project_evermind:<projectId>`) that expands to a project's
 * CURRENT Evermind head at call time. Sending the pin — rather than a resolved
 * `evermind/<ref>` — means each completion follows the project's latest learned
 * version (pull-on-boundary), even inside a long-lived chat session. Mirrors
 * `PROJECT_EVERMIND_MODEL_PREFIX` on the gateway (api/.../projectEvermind.ts).
 */
const PROJECT_EVERMIND_PIN = "project_evermind:";

/** The selected model, shared across all chat panels (single source of truth). */
let selected: string | undefined;
const emitter = new vscode.EventEmitter<string | undefined>();
export const onModelChange = emitter.event;

export function setSelectedModel(model: string | undefined): void {
  selected = model;
  emitter.fire(model);
}

/** The configured fallback model (empty → let the gateway auto-select). */
function defaultModel(): string | undefined {
  return vscode.workspace.getConfiguration("builderforce").get<string>("defaultModel") || undefined;
}

/**
 * Resolve the model for a chat turn across BOTH editor chat surfaces (the native
 * `@builderforce` participant and the Brain webview), mirroring the cloud/on-prem
 * dispatch precedence (payload pin > agent base > project Evermind > default):
 *   1. an explicit manual pick always wins;
 *   2. otherwise, when the active project opted into running on its Evermind
 *      (`inferenceEnabled` + seeded — the SAME gate the cloud/on-prem dispatcher
 *      honors), send the `project_evermind:<id>` pin so the gateway serves the
 *      project's CURRENT learned model, auto-following each learning bump;
 *   3. otherwise the configured default (or gateway auto).
 * Best-effort: any failure resolving the head falls back to the default, so chat
 * always works.
 */
export async function resolveEffectiveModel(secrets: vscode.SecretStorage): Promise<string | undefined> {
  if (selected) return entitled(secrets, selected);
  const project = getSelectedProject();
  if (project) {
    const head = await getProjectEvermindHead(secrets, project.id).catch(() => undefined);
    if (head?.inferenceEnabled && head.seeded) return `${PROJECT_EVERMIND_PIN}${project.id}`;
  }
  return entitled(secrets, defaultModel());
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
  const choices = await getModels(secrets).catch(() => undefined);
  if (!choices) return model;
  return isModelAllowed(choices, model) ? model : undefined;
}
