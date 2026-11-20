/**
 * What every editor run is started with beyond its model pick — its stage models, the
 * pipeline routing (`builderforce.pipeline.*`), its spend cap
 * (`builderforce.maxRunBudgetUsd`) and the project's ship policy (PRD 48, a project
 * setting read from the API). Read per run, so a settings change applies to the
 * next run without a reload. The panel's run host and the native chat participant both
 * start their runs from this ONE reader.
 */

import * as vscode from "vscode";
import { resolveStageModels } from "./modelState";
import { editorRunSettingsFrom, type EditorRunSettings } from "./stageModels";
import { resolveRunShipPolicy } from "./policyGates";
import { logLine } from "./errorReporter";

export { runRequestFields, type EditorRunSettings } from "./stageModels";

export async function editorRunSettings(secrets: vscode.SecretStorage, projectId?: number): Promise<EditorRunSettings> {
  const config = vscode.workspace.getConfiguration("builderforce");
  const [stages, shipPolicy] = await Promise.all([
    resolveStageModels(secrets),
    // The project's ship policy, through the gates' cache and snapshot; the default when unset or unreachable.
    resolveRunShipPolicy(secrets, projectId, (message) => logLine(`BuilderForce ${message}`)),
  ]);
  return {
    ...editorRunSettingsFrom(stages, {
      routing: config.get<string>("pipeline.routing"),
      routeThreshold: config.get<number>("pipeline.routeThreshold"),
      maxRunBudgetUsd: config.get<number>("maxRunBudgetUsd"),
    }),
    shipPolicy,
  };
}
