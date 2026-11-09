/**
 * Localized copy for the run list's "Interrupted" rows (`InterruptedRuns.tsx`) and the
 * continuation turn Resume sends through the composer. Translated through `vscode.l10n`
 * like every panel string and merged into the panel's label bundle under `ir.*`; the
 * webview reads it with `makeT`, keeping the English default for any key it lacks.
 * `{when}` is a TEMPLATE the renderer fills, so it stays literal here. The `ir.continue*` keys are the headings of the
 * continuation turn (`interruptedResumeTurn.ts`); the run's ask, plan, files and steps it carries are data.
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
    "ir.continueAsk": t("The original request, verbatim:"),
    "ir.continuePlan": t("The plan when it stopped:"),
    "ir.continueFiles": t("Files changed so far:"),
    "ir.continueSteps": t("The last steps before it stopped:"),
    "ir.continueChildren": t("Sub-agents:"),
    "ir.continueScope": t("Continue only this chat's task above. Check what is already done before redoing it, and do not pick up any other session's work."),
  };
}
