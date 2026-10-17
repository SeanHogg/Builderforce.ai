/**
 * Localized copy for the on-device model list in the composer's `/` menu — the page
 * engines' catalog (WebGPU `bfi`, WebLLM) that the chat webview downloads and runs.
 * Translated through `vscode.l10n` like every panel string and merged into the panel's
 * label bundle, each under `app.<field>` of brain-ui's `LocalModelLabels` — the ONE key
 * table the webview reads back through `localModelLabelsFrom` (`promptMenuLabels`). Its
 * own module so the panel does not grow for it.
 *
 * Typed as `LocalModelLabels`, so a field the shared list gains is a compile error here
 * rather than a silently English row in the editor. `{size}`, `{percent}` and `{tokens}`
 * are filled per row by the shared list, so the catalog strings keep them literal. Model
 * and engine names are brands, not copy.
 */

import * as vscode from "vscode";
import type { LocalModelLabels } from "@seanhogg/builderforce-brain-ui";

/** The bundle key a list field travels under — read back by the webview's `chatLabels.ts`. */
const localModelBundleKey = (field: keyof LocalModelLabels): string => `app.${field}`;

export function localModelLabels(): Record<string, string> {
  const t = vscode.l10n.t;
  const copy: LocalModelLabels = {
    localCatalogHeading: t("Download to run in this editor window"),
    localDownload: t("Download ({size})"),
    localDownloading: t("Downloading… {percent}%"),
    localCancel: t("Cancel download"),
    localRemove: t("Remove from this device"),
    localMoreActions: t("More actions"),
    localTools: t("Tools"),
    localContext: t("{tokens} context"),
    localDownloadFailed: t("Download failed — try again."),
    localReasonWebgpu: t("Needs WebGPU, which this editor or GPU does not offer."),
    localReasonF16: t("Needs WebGPU 16-bit shaders, which this GPU does not offer."),
    localReasonBuffer: t("Needs larger GPU buffers than this device allows."),
    localReasonEngine: t("This engine is not available here yet."),
  };
  return Object.fromEntries(
    (Object.keys(copy) as Array<keyof LocalModelLabels>).map((field) => [localModelBundleKey(field), copy[field]]),
  );
}
