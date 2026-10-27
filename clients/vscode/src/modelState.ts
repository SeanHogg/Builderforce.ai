import * as vscode from "vscode";
import { routingModeForSelection, type ChatModelSelection } from "@seanhogg/builderforce-brain-embedded";
import { getProjectEvermindHead } from "./bfApi";
import { getModels, isModelAllowed } from "./gateway";
import { isLocalModelRef } from "./localModels";
import { getSelectedProject } from "./projectState";
import { explicitRoleModelPin, NATIVE_RUN_ROLE, roleModelPin } from "./roleModelPin";
import { stageModels, type StageModels } from "./stageModels";

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
  /** Only an explicit "your keys" pick sends one; Auto sends nothing, so the gateway
   *  applies the person's account `cloudOrder` (the shared {@link routingModeForSelection}). */
  routingMode?: "byo_pool";
};

/** The routing field a selection sends — the rule the web app uses, not a local copy. */
function routingFor(selection: ChatModelSelection): Pick<EffectiveModelChoice, "routingMode"> {
  const routingMode = routingModeForSelection(selection);
  return routingMode ? { routingMode } : {};
}

type ModelPick = { mode: "auto" | "byo_pool" | "model"; model?: string };

/** Undefined means inherit project/config. Once the user chooses, Auto and Pool
 * remain explicit choices rather than collapsing back into that inheritance. */
let selected: ModelPick | undefined;
const emitter = new vscode.EventEmitter<string | undefined>();
export const onModelChange = emitter.event;

/**
 * The pick survives a reload, like the mode it was made under (`builderforce.inferenceMode`,
 * a setting). Kept only in memory, a reload left Specific with nothing picked — every turn
 * failed `no_specific_model` while the `/` menu still named the model.
 */
const PICK_KEY = "builderforce.modelPick";
let pickStore: vscode.Memento | undefined;

function isModelPick(value: unknown): value is ModelPick {
  if (!value || typeof value !== "object") return false;
  const { mode, model } = value as ModelPick;
  return mode === "auto" || mode === "byo_pool" || (mode === "model" && typeof model === "string" && model.length > 0);
}

/** Restore the saved pick and keep every later pick saved — once, at activation. */
export function bindModelPickStore(store: vscode.Memento): void {
  pickStore = store;
  const saved = store.get<unknown>(PICK_KEY);
  if (selected === undefined && isModelPick(saved)) choose(saved);
}

function choose(pick: ModelPick): void {
  selected = pick;
  void pickStore?.update(PICK_KEY, pick);
  emitter.fire(pick.mode === "model" ? pick.model : undefined);
}

export function setSelectedModel(model: string | undefined): void {
  choose(model ? { mode: "model", model } : { mode: "auto" });
}

export function setSelectedModelPool(): void {
  choose({ mode: "byo_pool" });
}

/** The configured fallback model (empty → let the gateway auto-select). */
function defaultModel(): string | undefined {
  return vscode.workspace.getConfiguration("builderforce").get<string>("defaultModel") || undefined;
}

export async function resolveEffectiveModelChoice(secrets: vscode.SecretStorage): Promise<EffectiveModelChoice> {
  if (selected?.mode === "auto") return routingFor({ mode: "auto" });
  if (selected?.mode === "byo_pool") return routingFor({ mode: "byo_pool" });
  if (selected?.mode === "model" && selected.model) {
    const model = await entitled(secrets, selected.model);
    return model ? { model, modelStrict: true, ...routingFor({ mode: "model", model }) } : routingFor({ mode: "auto" });
  }
  const project = getSelectedProject();
  if (project) {
    const head = await getProjectEvermindHead(secrets, project.id).catch(() => undefined);
    // Every editor turn is a CODING turn, so the project's Evermind is the default only
    // while it clears the coding-quality gate (≥90% of the frontier baseline on the
    // coding eval, for the current head). The gateway enforces the same gate when it
    // expands the pin; checking here keeps the chat from advertising a model it won't get.
    if (head?.inferenceEnabled && head.seeded && head.codingGate?.qualified === true) {
      return { model: `${PROJECT_EVERMIND_PIN}${project.id}` };
    }
  }
  // The operator's role pins (ROLE_MODELS / ROLE_MODEL_DEFAULT) are no longer a model
  // pinned to the WHOLE run: they are the run's stage models ({@link resolveStageModels}),
  // so planning, coding and review each ask for their own. A soft pin (the configured
  // default) is not a routing choice: no `routingMode`.
  const model = await entitled(secrets, defaultModel());
  return model ? { model } : {};
}

/** `builderforce.models.*` and `builderforce.pipeline.quickModel`, as written. */
function stageModelSettings(): Parameters<typeof stageModels>[0] {
  const config = vscode.workspace.getConfiguration("builderforce");
  return {
    plan: config.get<string>("models.plan"),
    code: config.get<string>("models.code"),
    review: config.get<string>("models.review"),
    subagent: config.get<string>("models.subagent"),
    quick: config.get<string>("pipeline.quickModel"),
  };
}

/**
 * The run's stage models: the editor's settings over the operator's role pins — the
 * coding stage is the coding-role pin (`NATIVE_RUN_ROLE`) — each dropped when the
 * tenant's plan cannot use it (see {@link entitled}).
 */
export async function resolveStageModels(secrets: vscode.SecretStorage): Promise<StageModels> {
  const resolved = stageModels(stageModelSettings(), {
    plan: roleModelPin("plan"),
    code: roleModelPin(NATIVE_RUN_ROLE),
    verify: roleModelPin("verify"),
    // Never the operator's catch-all default: it would shadow every per-role child pin.
    subagent: explicitRoleModelPin("subagent"),
    quick: explicitRoleModelPin("quick"),
  });
  const out: StageModels = {};
  for (const stage of Object.keys(resolved) as Array<keyof StageModels>) {
    const model = await entitled(secrets, resolved[stage]);
    if (model) out[stage] = model;
  }
  return out;
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
