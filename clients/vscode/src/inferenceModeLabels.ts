/**
 * THE editor's copy for where models run — ONE definition for every surface: the
 * webview's mode control (the `/` menu's Model tab), its first-run question and the chat
 * banner's `no_local_model` / `no_specific_model` remedies (merged into the panel's label
 * bundle under `app.<field>`, the keys the webview reads back through `promptMenuLabels`
 * / `chatErrorLabels`), and the native Command Palette QuickPick (`noLocalModelPrompt.ts`
 * reads {@link inferenceModeCopy}). Its own module so the panel does not grow.
 *
 * Typed as brain-ui's `InferenceModeLabels`, so a field the shared control gains is a
 * compile error here rather than a silently English row. Type-only import: the extension
 * host never bundles brain-ui's React.
 */
import * as vscode from "vscode";
import type { InferenceMode } from "@builderforce/local-first";
import type { InferenceModeLabels } from "@seanhogg/builderforce-brain-ui";

function modeCopy(): InferenceModeLabels {
  const t = vscode.l10n.t;
  return {
    inferenceMode: t("Run models"),
    inferenceModeHybrid: t("Hybrid"),
    inferenceModeHybridHint: t("This device first, then BuilderForce cloud when it needs to"),
    inferenceModeLocalOnly: t("Local only"),
    inferenceModeLocalOnlyHint: t("Only models on this device — nothing is sent to the cloud"),
    inferenceModeSpecific: t("Specific model"),
    inferenceModeSpecificHint: t("The model you pick always runs — cloud, your connected accounts or one local model"),
    inferenceModeRecommended: t("Recommended"),
    inferenceModeAskTitle: t("How should BuilderForce run models?"),
    inferenceModeAskBody: t("You can change this any time in the / menu, under Model."),
  };
}

/** A mode's name and one-line description — the QuickPick reads the same strings as the control. */
export function inferenceModeCopy(mode: InferenceMode): { name: string; hint: string } {
  const copy = modeCopy();
  switch (mode) {
    case "hybrid":
      return { name: copy.inferenceModeHybrid, hint: copy.inferenceModeHybridHint };
    case "local-only":
      return { name: copy.inferenceModeLocalOnly, hint: copy.inferenceModeLocalOnlyHint };
    case "specific":
      return { name: copy.inferenceModeSpecific, hint: copy.inferenceModeSpecificHint };
  }
}

export function inferenceModeLabels(): Record<string, string> {
  const t = vscode.l10n.t;
  const copy = modeCopy();
  return {
    ...Object.fromEntries((Object.keys(copy) as Array<keyof InferenceModeLabels>).map((field) => [`app.${field}`, copy[field]])),
    "app.noLocalModel": t("No model on this device can answer. Switch to Hybrid, or download a local model."),
    "app.switchToHybrid": t("Switch to Hybrid"),
    "app.downloadLocalModel": t("Download a local model"),
    "app.noSpecificModel": t("Specific model is on, but no model is picked. Pick one, or switch to Hybrid."),
    "app.pickModel": t("Pick a model"),
    // The on-device engine failures (`local_engine_failed`): crashed, went away mid-answer,
    // or keeps crashing on one model — the last offers "Pick a model" + "Manage on-device models".
    "app.engineCrashed": t("The on-device model crashed. Send again to restart it."),
    "app.engineDetached": t("The on-device model stopped before it finished. Send again to retry."),
    "app.modelKeepsCrashing": t("This model keeps crashing on this device. Remove it, or try another model."),
    "app.manageLocalModels": t("Manage on-device models"),
    // A refusal by the person's own platform policy (`platform_refused`): the mode, the
    // sync switch, or another `builderforce.platform.*` switch — never the raw code.
    "app.platformRefusedMode": t("Local only keeps this run on this device, so it could not reach BuilderForce. Switch to Hybrid in the / menu under Model to let it."),
    "app.platformRefusedSync": t("Account sync is off, so this could not be saved to your account. Turn on builderforce.platform.synchronize in Settings, or keep working locally."),
    "app.platformRefusedSetting": t("One of your builderforce.platform.* settings turned off what this run needed. Change it in Settings, or pick another model in the / menu."),
    // The webview's Hybrid fallback notice — the participant's catalog string, its `{0}`
    // handed back as brain-ui's `{model}` token so one translation serves both surfaces.
    "app.modelFallback": t("Your pick {0} failed; answered with Auto.", "{model}"),
  };
}
