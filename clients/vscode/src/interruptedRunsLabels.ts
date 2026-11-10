/**
 * Localized copy for the run list's "Interrupted" rows (`InterruptedRuns.tsx`) and the
 * continuation turn Resume sends through the composer. Translated through `vscode.l10n`
 * like every panel string and merged into the panel's label bundle under `ir.*`; the
 * webview reads it with `makeT`, keeping the English default for any key it lacks.
 * `{when}`, `{count}`, `{died}`, `{ticket}`, `{owner}` and `{state}` are TEMPLATES the renderer fills, so they stay
 * literal here. The `ir.continue*` keys are the headings of the continuation turn (`interruptedResumeTurn.ts`); the
 * `ir.child*` keys word what became of the run's sub-agents in it. The run's ask, plan, files and steps, and a child's
 * handle, label, owner, ticket, brief and report, are data.
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
    "ir.chatPending": t("Another run is resuming in this chat"),
    "ir.continue": t("Continue the task that was interrupted when the editor closed."),
    "ir.continueAsk": t("The original request, verbatim:"),
    "ir.continuePlan": t("The plan when it stopped:"),
    "ir.continueFiles": t("Files changed so far:"),
    "ir.continueSteps": t("The last steps before it stopped:"),
    "ir.continueChildren": t("Sub-agents:"),
    "ir.continueScope": t("Continue only this chat's task above. Check what is already done before redoing it, and do not pick up any other session's work."),
    "ir.childrenStarted": t("Sub-agents your interrupted run had started: {count}."),
    "ir.childrenDied": t("{died} of them died with the editor and are NOT running now."),
    "ir.childTicket": t("ticket {ticket}"),
    "ir.childStartedBy": t("started by {owner}"),
    "ir.childInterrupted": t("interrupted — not resumed; re-spawn or do it yourself"),
    "ir.childBrief": t("Its brief was:"),
    "ir.childReturned": t("{state} — its report was already returned to you by wait_agents."),
    "ir.childReport": t("{state} — its report:"),
    "ir.childNoReport": t("{state}, no report kept."),
    "ir.childState.running": t("running"),
    "ir.childState.done": t("done"),
    "ir.childState.failed": t("failed"),
    "ir.childState.stopped": t("stopped"),
  };
}
