/**
 * The editor's answer to the two "nothing can take this turn" verdicts that are NOT a
 * sign-in problem — ONE place for the native surfaces (the `@builderforce` chat
 * participant, notifications), so none of them falls back to the sign-in prompt; the
 * webview's banner offers the same remedies from the same commands.
 *
 *   - `no_local_model` — nothing on this machine can answer and the gateway is out for a
 *     reason signing in would not fix (Local only, or a signed-in person whose cloud route
 *     is unavailable): "Switch to Hybrid" (only while on Local only — on Hybrid the cloud
 *     is out for another reason) and "Download a local model" (the model picker, whose
 *     on-device list downloads one);
 *   - `no_specific_model` — the person runs Specific model and picked none: "Pick a
 *     model" (the same picker).
 *
 * Also registers `builderforce.setInferenceMode` (Command Palette: a QuickPick of the three
 * modes; with an argument, that mode).
 */
import * as vscode from "vscode";
import { INFERENCE_MODES, isInferenceMode } from "@builderforce/local-first";
import { inferenceModeState, onDidChangeInferenceMode, setInferenceMode } from "./inferenceModeSetting";
import { inferenceModeCopy } from "./inferenceModeLabels";

export const SET_INFERENCE_MODE_COMMAND = "builderforce.setInferenceMode";
/** Where a model is picked — and a local one downloaded: the model picker. */
export const PICK_MODEL_COMMAND = "builderforce.pickModel";
/** Where a local model is downloaded: the model picker's on-device list. */
export const DOWNLOAD_LOCAL_MODEL_COMMAND = PICK_MODEL_COMMAND;

/** The verdicts this module answers. */
export type ModelRemedyKind = "no_local_model" | "no_specific_model";

interface Remedy {
  title: string;
  command: string;
  arguments?: unknown[];
}

/** What a person reads for a verdict — never the raw sentinel. */
export function noLocalModelMessage(kind: ModelRemedyKind = "no_local_model"): string {
  return kind === "no_specific_model"
    ? vscode.l10n.t("Specific model is on, but no model is picked. Pick one, or switch to Hybrid.")
    : vscode.l10n.t("No model on this device can answer. Switch to Hybrid, or download a local model.");
}

/** The remedies to offer right now. */
export function noLocalModelRemedies(kind: ModelRemedyKind = "no_local_model"): Remedy[] {
  if (kind === "no_specific_model") return [{ title: vscode.l10n.t("Pick a model"), command: PICK_MODEL_COMMAND }];
  const remedies: Remedy[] = [];
  if (inferenceModeState().mode === "local-only") {
    remedies.push({ title: vscode.l10n.t("Switch to Hybrid"), command: SET_INFERENCE_MODE_COMMAND, arguments: ["hybrid"] });
  }
  remedies.push({ title: vscode.l10n.t("Download a local model"), command: DOWNLOAD_LOCAL_MODEL_COMMAND });
  return remedies;
}

/** In a chat response: the sentence and a button per remedy. */
export function streamNoLocalModel(stream: vscode.ChatResponseStream, kind: ModelRemedyKind = "no_local_model"): void {
  stream.markdown(noLocalModelMessage(kind));
  stream.markdown("\n\n");
  for (const remedy of noLocalModelRemedies(kind)) stream.button(remedy);
}

/**
 * As a notification, for a surface with no chat stream (the codebase rescan a person
 * asked for): the sentence, a button per remedy, and the picked one run.
 */
export async function showNoLocalModelPrompt(kind: ModelRemedyKind = "no_local_model"): Promise<void> {
  const remedies = noLocalModelRemedies(kind);
  const picked = await vscode.window.showWarningMessage(noLocalModelMessage(kind), ...remedies.map((r) => r.title));
  const remedy = remedies.find((r) => r.title === picked);
  if (remedy) await vscode.commands.executeCommand(remedy.command, ...(remedy.arguments ?? []));
}

async function chooseInferenceMode(arg?: unknown): Promise<void> {
  if (isInferenceMode(arg)) return setInferenceMode(arg);
  const current = inferenceModeState().mode;
  const picked = await vscode.window.showQuickPick(
    INFERENCE_MODES.map((mode) => {
      const { name, hint } = inferenceModeCopy(mode);
      return { mode, label: name, detail: hint, picked: mode === current, description: mode === current ? "✓" : undefined };
    }),
    { title: vscode.l10n.t("How should BuilderForce run models?") },
  );
  if (picked) await setInferenceMode(picked.mode);
}

/** Register the mode command; `onChange` re-pushes the mode to open surfaces (the panel's `init`). */
export function registerInferenceModeCommands(context: vscode.ExtensionContext, onChange: () => void): void {
  context.subscriptions.push(vscode.commands.registerCommand(SET_INFERENCE_MODE_COMMAND, chooseInferenceMode));
  context.subscriptions.push(onDidChangeInferenceMode(onChange));
}
