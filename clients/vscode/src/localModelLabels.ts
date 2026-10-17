/**
 * Localized copy for the on-device model list in the composer's `/` menu — the page
 * engines' catalog (WebGPU `bfi`, WebLLM) that the chat webview downloads and runs.
 * Translated through `vscode.l10n` like every panel string and merged into the panel's
 * label bundle; read back by `promptMenuLabels` in the webview. Its own module so the
 * panel does not grow for it.
 *
 * `{size}`, `{percent}` and `{tokens}` are filled per row by the shared list, so the
 * catalog strings keep them literal. Model and engine names are brands, not copy.
 */

import * as vscode from "vscode";

export function localModelLabels(): Record<string, string> {
  const t = vscode.l10n.t;
  return {
    "app.local.catalogHeading": t("Download to run in this editor window"),
    "app.local.download": t("Download ({size})"),
    "app.local.downloading": t("Downloading… {percent}%"),
    "app.local.cancel": t("Cancel download"),
    "app.local.remove": t("Remove from this device"),
    "app.local.moreActions": t("More actions"),
    "app.local.tools": t("Tools"),
    "app.local.context": t("{tokens} context"),
    "app.local.downloadFailed": t("Download failed — try again."),
    "app.local.reasonWebgpu": t("Needs WebGPU, which this editor or GPU does not offer."),
    "app.local.reasonF16": t("Needs WebGPU 16-bit shaders, which this GPU does not offer."),
    "app.local.reasonBuffer": t("Needs larger GPU buffers than this device allows."),
    "app.local.reasonEngine": t("This engine is not available here yet."),
  };
}
