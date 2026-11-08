/**
 * Localized copy for the run list's "Interrupted" rows (`InterruptedRuns.tsx`) and the
 * continuation turn Resume sends through the composer. Translated through `vscode.l10n`
 * like every panel string and merged into the panel's label bundle under `ir.*`; the
 * webview reads it with `makeT`, keeping the English default for any key it lacks.
 * `{when}` is a TEMPLATE the renderer fills, so it stays literal here.
 */

import * as vscode from "vscode";

export function interruptedRunsLabels(): Record<string, string> {
  const t = vscode.l10n.t;
  return {
    "ir.title": t("Interrupted runs"),
    "ir.at": t("Interrupted {when}"),
    "ir.openChat": t("Open chat"),
    "ir.resume": t("Resume"),
    "ir.dismiss": t("Dismiss"),
    "ir.failed": t("Couldn't resume"),
    "ir.busy": t("This chat is running"),
    "ir.continue": t("Continue the task that was interrupted when the editor closed."),
  };
}
