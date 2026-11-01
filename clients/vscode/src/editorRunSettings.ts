/**
 * What every editor run is started with beyond its model pick — its stage models, the
 * pipeline routing (`builderforce.pipeline.*`) and its spend cap
 * (`builderforce.maxRunBudgetUsd`). Read per run, so a settings change applies to the
 * next run without a reload. The panel's run host and the native chat participant both
 * start their runs from this ONE reader.
 */

import * as vscode from "vscode";
import { resolveStageModels } from "./modelState";
import { editorRunSettingsFrom, type EditorRunSettings } from "./stageModels";

export { runRequestFields, type EditorRunSettings } from "./stageModels";

export async function editorRunSettings(secrets: vscode.SecretStorage): Promise<EditorRunSettings> {
  const config = vscode.workspace.getConfiguration("builderforce");
  return editorRunSettingsFrom(await resolveStageModels(secrets), {
    routing: config.get<string>("pipeline.routing"),
    routeThreshold: config.get<number>("pipeline.routeThreshold"),
    maxRunBudgetUsd: config.get<number>("maxRunBudgetUsd"),
  });
}
