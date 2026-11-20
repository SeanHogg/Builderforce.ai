import * as vscode from "vscode";
import type { ComposerCommandLabels, ComposerCommandProblem } from "@seanhogg/builderforce-brain-embedded/composerCommands";

/**
 * Every sentence the composer commands show, in the editor's language (`vscode.l10n`).
 * The registry holds ids and syntax only; the `/help` descriptions, the parse problems and
 * each command's outcome are worded here, ONE place, so the executors stay free of copy.
 */
export interface ComposerCommandText extends ComposerCommandLabels {
  problem(problem: ComposerCommandProblem): string;
  /** Why a workspace command cannot run with no folder open. */
  noWorkspace: string;
  /** `/x` cannot run here, and why. */
  unavailable(id: string, reason: string): string;
  /** Heads the problems of a command that did not parse. */
  invalid(id: string): string;
  /** A command threw. */
  failed(id: string, error: string): string;

  // /starter-kit
  kitIssues: string;
  /** Which workspace folder a command works on (several are open). */
  pickFolder: string;
  noFolderChosen: string;
  kitNonEmpty(folder: string, fileCount: number): string;
  kitConflicts(folder: string, fileCount: number, conflicts: readonly string[]): string;
  kitWrite: string;
  kitOverwrite: string;
  kitDeclined(folder: string): string;
  kitWritten(kit: string, fileCount: number, folder: string): string;
  services(names: readonly string[]): string;
  resources(names: readonly string[]): string;
  launchHint: string;

  // /manifest init
  manifestDiffTitle: string;
  manifestPreviewTitle: string;
  manifestReplace: string;
  manifestReplaceQuestion: string;
  manifestWrite: string;
  manifestWriteQuestion: string;
  manifestDeclined: string;
  manifestWritten(services: number, resources: number): string;
  notes: string;

  // /launch
  launchDetected: string;
  launchStarted(folder: string): string;
  launchReopened(folder: string): string;
  launchOpenAgain: string;
  launchStopped(folder: string): string;
  launchNotRunning(folder: string): string;
  launchStopChoice: string;
  launchTrustChoice: string;
  launchFailed(error: string): string;

  // The launcher's local certificate (`launcherTrust.ts`)
  trustQuestion: string;
  trustApprove: string;
  trustSkip: string;
  trustUntrusted: string;
  trustDone: string;
  trustFailed(error: string): string;
  trustManual(caCertPath: string): string;
}

export function composerCommandText(): ComposerCommandText {
  const t = vscode.l10n.t;
  const descriptions: Record<string, string> = {
    help: t("List every command, or one command in full."),
    "starter-kit": t("Write a starter app (frontend, backend and extras) with its builderforce.json into this workspace folder."),
    manifest: t("Detect this app and write its builderforce.json after showing you the diff."),
    launch: t("Run this workspace's app in your browser with the local launcher. /launch stop stops it."),
  };
  return {
    describe: (id) => descriptions[id] ?? id,
    problem: (problem) => {
      switch (problem.code) {
        case "missing-arg": return t("Missing <{0}>", problem.name);
        case "missing-flag": return t("Missing --{0}", problem.name);
        case "missing-value": return t("--{0} needs a value", problem.name);
        case "bad-choice": return t("\"{0}\" is not a valid {1} (one of: {2})", problem.value, problem.name, problem.choices.join(", "));
        case "unknown-flag": return t("Unknown option --{0}", problem.name);
        case "duplicate-flag": return t("--{0} was given twice", problem.name);
        case "extra-arg": return t("Unexpected \"{0}\"", problem.value);
      }
    },
    noWorkspace: t("Open a folder first: this command works on the workspace folder."),
    unavailable: (id, reason) => t("/{0} cannot run here: {1}", id, reason),
    invalid: (id) => t("/{0} was not run:", id),
    failed: (id, error) => t("/{0} failed: {1}", id, error),

    kitIssues: t("The starter kit could not be composed, so nothing was written:"),
    pickFolder: t("Choose the workspace folder for this command"),
    noFolderChosen: t("No folder was chosen, so nothing was done."),
    kitNonEmpty: (folder, fileCount) => t("{0} is not empty. Write the starter kit's {1} files into it? No existing file is overwritten.", folder, fileCount),
    kitConflicts: (folder, fileCount, conflicts) =>
      t("{0} is not empty. The starter kit writes {1} files, and these already exist and would be overwritten: {2}", folder, fileCount, conflicts.join(", ")),
    kitWrite: t("Write files"),
    kitOverwrite: t("Overwrite and write"),
    kitDeclined: (folder) => t("The starter kit was not written: writing into {0} was not approved.", folder),
    kitWritten: (kit, fileCount, folder) => t("Wrote the {0} starter kit: {1} files into {2}.", kit, fileCount, folder),
    services: (names) => t("Services: {0}", names.length > 0 ? names.join(", ") : t("none")),
    resources: (names) => t("Resources: {0}", names.length > 0 ? names.join(", ") : t("none")),
    launchHint: t("Type /launch to run it in your browser."),

    manifestDiffTitle: t("builderforce.json: current ↔ detected"),
    manifestPreviewTitle: t("builderforce.json (detected)"),
    manifestReplace: t("Replace"),
    manifestReplaceQuestion: t("Replace builderforce.json with the detected manifest shown in the diff?"),
    manifestWrite: t("Write"),
    manifestWriteQuestion: t("Write the detected builderforce.json shown in the preview?"),
    manifestDeclined: t("builderforce.json was not written."),
    manifestWritten: (services, resources) => t("Wrote builderforce.json ({0} services, {1} resources).", services, resources),
    notes: t("Notes:"),

    launchDetected: t("This folder has no builderforce.json, so the launcher runs a detected manifest. Save it with /manifest init."),
    launchStarted: (folder) => t("The launcher for {0} is running and opened in your browser.", folder),
    launchReopened: (folder) => t("The launcher for {0} was already running; it was opened in your browser again.", folder),
    launchOpenAgain: t("Open again"),
    launchStopped: (folder) => t("Stopped the launcher for {0}.", folder),
    launchNotRunning: (folder) => t("No launcher is running for {0}.", folder),
    launchStopChoice: t("Stop the running launcher"),
    launchTrustChoice: t("Trust the launcher's local certificate"),
    launchFailed: (error) => t("The launcher could not start: {0}", error),

    trustQuestion: t("The launcher shows your app over HTTPS. To let your browser trust it, BuilderForce adds a local certificate to YOUR user certificate store. That certificate can only vouch for localhost addresses. Your system may ask you to confirm."),
    trustApprove: t("Trust and launch"),
    trustSkip: t("Launch without trusting"),
    trustUntrusted: t("The launcher's local certificate is not trusted, so your browser will show a security warning for the preview. Type /launch trust to trust it."),
    trustDone: t("The launcher's local certificate is now trusted."),
    trustFailed: (error) => t("The launcher's local certificate could not be trusted: {0}", error),
    trustManual: (caCertPath) => t("Add this certificate to your system or browser certificate store to remove the browser warning: {0}", caCertPath),
  };
}

/**
 * The `/` menu's Actions-tab copy for the webview's label bundle, under the `app.<field>`
 * keys `promptMenuLabels` reads (`webview/src/chat/chatLabels.ts` → brain-ui `promptOptionsLabelsFrom`).
 * `{name}` is filled in by brain-ui, not by l10n.
 */
export function composerCommandWebviewLabels(): Record<string, string> {
  const t = vscode.l10n.t;
  return {
    "app.actionsTab": t("Actions"),
    "app.actionsEmpty": t("No commands are available here"),
    "app.commandUnavailable": t("Unavailable"),
    "app.noSuchCommand": t("No such command: /{name}"),
  };
}
