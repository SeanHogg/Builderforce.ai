import * as vscode from "vscode";
import { routingModeForSelection } from "@seanhogg/builderforce-brain-embedded";
import { getProjectEvermindHead } from "./bfApi";
import { getModels, isModelAllowed } from "./gateway";
import { isLocalModelRef } from "./localModels";
import { getSelectedProject } from "./projectState";
import { explicitRoleModelPin, NATIVE_RUN_ROLE, roleModelPin } from "./roleModelPin";
import { stageModels } from "./stageModels";
/**
 * The gateway pin (`project_evermind:<projectId>`) that expands to a project's
 * CURRENT Evermind head at call time. Sending the pin — rather than a resolved
 * `evermind/<ref>` — means each completion follows the project's latest learned
 * version (pull-on-boundary), even inside a long-lived chat session. Mirrors
 * `PROJECT_EVERMIND_MODEL_PREFIX` on the gateway (api/.../projectEvermind.ts).
 */
const PROJECT_EVERMIND_PIN = "project_evermind:";
/** The routing field a selection sends — the rule the web app uses, not a local copy. */
function routingFor(selection) {
    const routingMode = routingModeForSelection(selection);
    return routingMode ? { routingMode } : {};
}
/** Undefined means inherit project/config. Once the user chooses, Auto and Pool
 * remain explicit choices rather than collapsing back into that inheritance. */
let selected;
const emitter = new vscode.EventEmitter();
export const onModelChange = emitter.event;
/**
 * The pick survives a reload, like the mode it was made under (`builderforce.inferenceMode`,
 * a setting). Kept only in memory, a reload left Specific with nothing picked — every turn
 * failed `no_specific_model` while the `/` menu still named the model.
 */
const PICK_KEY = "builderforce.modelPick";
let pickStore;
function isModelPick(value) {
    if (!value || typeof value !== "object")
        return false;
    const { mode, model } = value;
    return mode === "auto" || mode === "byo_pool" || (mode === "model" && typeof model === "string" && model.length > 0);
}
/** Restore the saved pick and keep every later pick saved — once, at activation. */
export function bindModelPickStore(store) {
    pickStore = store;
    const saved = store.get(PICK_KEY);
    if (selected === undefined && isModelPick(saved))
        choose(saved);
}
function choose(pick) {
    selected = pick;
    void pickStore?.update(PICK_KEY, pick);
    emitter.fire(pick.mode === "model" ? pick.model : undefined);
}
export function setSelectedModel(model) {
    choose(model ? { mode: "model", model } : { mode: "auto" });
}
export function setSelectedModelPool() {
    choose({ mode: "byo_pool" });
}
/** The configured fallback model (empty → let the gateway auto-select). */
function defaultModel() {
    return vscode.workspace.getConfiguration("builderforce").get("defaultModel") || undefined;
}
/** The routing choice an explicit pick makes — the ONE sync mapping, shared by the resolver
 *  and {@link pickedChoice}. `model` overrides the pick's own (the entitled one). */
function choiceOfPick(pick, model = pick?.model) {
    if (pick?.mode === "auto")
        return routingFor({ mode: "auto" });
    if (pick?.mode === "byo_pool")
        return routingFor({ mode: "byo_pool" });
    if (pick?.mode === "model" && model)
        return { model, modelStrict: true, ...routingFor({ mode: "model", model }) };
    return undefined;
}
/**
 * The saved explicit pick as a choice, read from memory with NO network — what a caller
 * that cannot wait on {@link resolveEffectiveModelChoice} (entitlement and the project's
 * Evermind head are reads) shows meanwhile, so a late resolution never reports another
 * model than the one picked. Entitlement is not checked (the late frame corrects a pick
 * the plan cannot use). Nothing picked ⇒ `{}` (inherit; the resolved choice follows).
 */
export function pickedChoice() {
    return choiceOfPick(selected) ?? {};
}
export async function resolveEffectiveModelChoice(secrets) {
    if (selected?.mode === "model" && selected.model) {
        const model = await entitled(secrets, selected.model);
        return (model ? choiceOfPick(selected, model) : undefined) ?? routingFor({ mode: "auto" });
    }
    const explicit = choiceOfPick(selected);
    if (explicit)
        return explicit;
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
function stageModelSettings() {
    const config = vscode.workspace.getConfiguration("builderforce");
    return {
        plan: config.get("models.plan"),
        code: config.get("models.code"),
        review: config.get("models.review"),
        subagent: config.get("models.subagent"),
        quick: config.get("pipeline.quickModel"),
    };
}
/**
 * The run's stage models: the editor's settings over the operator's role pins — the
 * coding stage is the coding-role pin (`NATIVE_RUN_ROLE`) — each dropped when the
 * tenant's plan cannot use it (see {@link entitled}).
 */
export async function resolveStageModels(secrets) {
    const resolved = stageModels(stageModelSettings(), {
        plan: roleModelPin("plan"),
        code: roleModelPin(NATIVE_RUN_ROLE),
        verify: roleModelPin("verify"),
        // Never the operator's catch-all default: it would shadow every per-role child pin.
        subagent: explicitRoleModelPin("subagent"),
        quick: explicitRoleModelPin("quick"),
    });
    const out = {};
    for (const stage of Object.keys(resolved)) {
        const model = await entitled(secrets, resolved[stage]);
        if (model)
            out[stage] = model;
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
async function entitled(secrets, model) {
    if (!model)
        return undefined;
    // An on-device model is not in the tenant's catalog and never will be: it is served by
    // a runtime on this machine, bills nothing, and needs no plan. Entitlement is a
    // statement about what the GATEWAY will serve, so applying it here would drop a
    // perfectly good local pin the moment the user signed in — the exact failure this
    // function exists to prevent, inverted.
    if (isLocalModelRef(model))
        return model;
    const choices = await getModels(secrets).catch(() => undefined);
    if (!choices)
        return model;
    return isModelAllowed(choices, model) ? model : undefined;
}
//# sourceMappingURL=modelState.js.map