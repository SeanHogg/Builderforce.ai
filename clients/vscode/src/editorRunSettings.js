/**
 * What every editor run is started with beyond its model pick — its stage models, the
 * pipeline routing (`builderforce.pipeline.*`) and its spend cap
 * (`builderforce.maxRunBudgetUsd`). Read per run, so a settings change applies to the
 * next run without a reload. The panel's run host and the native chat participant both
 * start their runs from this ONE reader.
 */
import * as vscode from "vscode";
import { resolveStageModels } from "./modelState";
import { editorRunSettingsFrom } from "./stageModels";
export { runRequestFields } from "./stageModels";
export async function editorRunSettings(secrets) {
    const config = vscode.workspace.getConfiguration("builderforce");
    return editorRunSettingsFrom(await resolveStageModels(secrets), {
        routing: config.get("pipeline.routing"),
        routeThreshold: config.get("pipeline.routeThreshold"),
        maxRunBudgetUsd: config.get("maxRunBudgetUsd"),
    });
}
//# sourceMappingURL=editorRunSettings.js.map