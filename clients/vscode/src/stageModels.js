/**
 * The editor's STAGE MODELS and run settings — which model each stage of a run asks
 * for, how runs are routed between the full pipeline and a quick pass, and the per-run
 * spend cap. Pure: `modelState.resolveStageModels` reads the settings and the operator
 * env, `editorRunSettings.ts` hands the result to a run.
 *
 * Sources, in order: the VS Code settings `builderforce.models.{plan,code,review,subagent}`
 * (and `builderforce.pipeline.quickModel`) → the operator's `ROLE_MODELS` env → unset,
 * where the gateway orders the tenant's models by the call's role. A stage model is a
 * DEFAULT beneath the run's own choice (`@builderforce/run-policy` `phaseModels`): the
 * user's explicit pick, the project's Evermind head or `builderforce.defaultModel` still
 * hold the whole run; the review model is the one stage that overrides them.
 */
const id = (raw) => (typeof raw === "string" && raw.trim() ? raw.trim() : undefined);
/** Settings over env pins, stage by stage. */
export function stageModels(settings, envPins = {}) {
    const out = {};
    const set = (stage, value) => {
        if (value)
            out[stage] = value;
    };
    set("plan", id(settings.plan) ?? id(envPins.plan));
    set("code", id(settings.code) ?? id(envPins.code));
    set("verify", id(settings.review) ?? id(envPins.verify));
    set("subagent", id(settings.subagent) ?? id(envPins.subagent));
    set("quick", id(settings.quick) ?? id(envPins.quick));
    return out;
}
/** The run settings from the resolved stage models and the raw settings. */
export function editorRunSettingsFrom(stages, raw) {
    const phaseModels = {
        ...(stages.plan ? { plan: stages.plan } : {}),
        ...(stages.code ? { code: stages.code } : {}),
        ...(stages.verify ? { verify: stages.verify } : {}),
    };
    const threshold = typeof raw.routeThreshold === "number" && Number.isFinite(raw.routeThreshold)
        ? Math.min(1, Math.max(0, raw.routeThreshold))
        : undefined;
    const budget = typeof raw.maxRunBudgetUsd === "number" && Number.isFinite(raw.maxRunBudgetUsd) && raw.maxRunBudgetUsd > 0
        ? raw.maxRunBudgetUsd
        : undefined;
    return {
        ...(Object.keys(phaseModels).length ? { phaseModels } : {}),
        pipeline: {
            routing: raw.routing === "always" ? "always" : "auto",
            ...(threshold !== undefined ? { threshold } : {}),
            ...(stages.quick ? { quickModel: stages.quick } : {}),
        },
        ...(budget !== undefined ? { maxRunBudgetUsd: budget } : {}),
        ...(stages.subagent ? { subagentModel: stages.subagent } : {}),
    };
}
/** The fields of {@link EditorRunSettings} a run request carries. A sub-agent keeps its
 *  owner's routing out (it is never routed) and takes its model from `modelForChildRun`,
 *  so only the cap reaches it — and the cap is the TREE's, not a fresh one: the child
 *  accrues into its owner's total (brain-embedded `runStore/runSpendBudget.ts`, keyed by the
 *  lineage), so an owner and all its sub-agents together stay under one cap. */
export function runRequestFields(settings, opts) {
    if (!settings)
        return {};
    return {
        ...(!opts.child && settings.phaseModels ? { phaseModels: settings.phaseModels } : {}),
        ...(!opts.child && settings.pipeline ? { pipeline: settings.pipeline } : {}),
        ...(settings.maxRunBudgetUsd ? { maxRunBudgetUsd: settings.maxRunBudgetUsd } : {}),
    };
}
//# sourceMappingURL=stageModels.js.map