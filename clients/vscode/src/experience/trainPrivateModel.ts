import * as vscode from "vscode";
import type { TrainOutcome } from "@seanhogg/builderforce-memory-mcp/experience";
import { surfaceError } from "../diagnostics/errorReporter";
import type { ExperienceHostProvider } from "./experienceHost";

/**
 * `builderforce.agents.trainPrivateModel`: teach the configured private Evermind
 * (`builderforce.agents.modelFile`) what the person has taught Synapse — every skill and
 * demonstration it has not learned yet — and say what happened. The recipe and the ledger
 * of what was learned are memory-mcp's `trainExperience`; this only drives it.
 */

/** The one-line outcome shown to the person. */
export function describeOutcome(outcome: TrainOutcome): string {
  switch (outcome.status) {
    case "nothing_new":
      return vscode.l10n.t("Your private model already knows everything you taught Synapse.");
    case "trained":
      return vscode.l10n.t("Your private model learned {0} procedures ({1} passes, loss {2}).", outcome.learned, outcome.passes, outcome.loss.toFixed(3));
    case "no_window":
      return vscode.l10n.t("Nothing could be learned yet: the recordings are too short for the model.");
    case "curated_out":
      return vscode.l10n.t("Nothing new was worth learning.");
  }
}

export async function trainPrivateModel(provider: ExperienceHostProvider, modelFile: string | undefined): Promise<void> {
  if (!modelFile) {
    void vscode.window.showWarningMessage(vscode.l10n.t("Set builderforce.agents.modelFile to your .evermind model file first."));
    return;
  }
  try {
    const message = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t("Training your private model…") },
      async () => {
        const [host, { trainExperience }] = await Promise.all([provider.get(), import("@seanhogg/builderforce-memory-mcp/experience")]);
        const model = await host.loadModel();
        if (!model) return vscode.l10n.t("Could not load the model file {0}.", modelFile);
        return describeOutcome(await trainExperience(host.store, host.engine, model, modelFile));
      },
    );
    void vscode.window.showInformationMessage(message);
  } catch (error) {
    surfaceError(error, "agents:trainPrivateModel", vscode.l10n.t("Training your private model failed: {0}", error instanceof Error ? error.message : String(error)));
  }
}
