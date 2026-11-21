import * as vscode from "vscode";
import type { ComposerCommandLabels, ComposerCommandProblem } from "@seanhogg/builderforce-brain-embedded/composerCommands";
import type { DetectionNote } from "@builderforce/app-detect";
import type { KitIssue } from "@builderforce/ide-templates/kits";
import { detectionNoteText, kitIssueText } from "./noteLabels";

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
  /** One `composeKit` issue, worded from its code + params (`noteLabels.ts`). */
  kitIssue(issue: KitIssue): string;
  /**
   * Detection's notes and warnings as reply lines: a "Notes:" heading, then each note worded
   * from its code + params (`noteLabels.ts`); nothing when there are none. The ONE rendering
   * `/manifest init` and `/launch` (no `builderforce.json`) share.
   */
  noteLines(notes: readonly DetectionNote[]): string[];
  /** Nothing was written: these paths are symbolic links or lead outside the workspace folder (`writeContainment.ts`). */
  writeRefused(paths: readonly string[]): string;
  /** Why a write was refused partway (`kitStopped`'s reason for a `WriteRefusedError`). */
  writeRefusedReason: string;
  /** A starter-kit write failed partway: the file, why, and every file already written. */
  kitStopped(file: string, reason: string, written: readonly string[]): string;
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

  // /launch
  /** Why `/launch` is unavailable in a remote extension host (`vscode.env.remoteName`). */
  launchRemote(remoteName: string): string;
  /** A `/launch` environment choice when several folders are open: which folders' manifests declare it. */
  launchEnvironmentIn(environment: string, folders: readonly string[]): string;
  launchDetected: string;
  /** The launcher started and opened: in VS Code's integrated browser, or (`external`) the system browser. */
  launchStarted(folder: string, external: boolean): string;
  launchReopened(folder: string, external: boolean): string;
  /** Why `/launch` opened the system browser instead of VS Code's integrated browser. */
  launchEditorUnavailable: string;
  launchEditorUntrusted: string;
  launchEditorFailed(error: string): string;
  /** The reply's actions: reopen in VS Code's integrated browser, or open in the system browser. */
  launchOpenInEditor: string;
  launchOpenExternal: string;
  launchExternalChoice: string;
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
  /** The trust command did not finish in time (a confirmation nobody answered, or a hung tool). */
  trustTimedOut(seconds: number): string;
  trustManual(caCertPath: string): string;
}

export function composerCommandText(): ComposerCommandText {
  const t = vscode.l10n.t;
  const descriptions: Record<string, string> = {
    help: t("List every command, or one command in full."),
    "starter-kit": t("Write a starter app (frontend, backend and extras) with its builderforce.json into this workspace folder."),
    manifest: t("Detect this app and write its builderforce.json after showing you the diff."),
    launch: t("Run this workspace's app with the local launcher in VS Code's built-in browser. /launch external opens it in your browser; /launch stop stops it."),
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
    kitIssue: kitIssueText,
    noteLines: (notes) => (notes.length > 0 ? [t("Notes:"), ...notes.map(detectionNoteText)] : []),
    writeRefused: (paths) => t("Nothing was written: these paths are symbolic links or lead outside the workspace folder: {0}", paths.join(", ")),
    writeRefusedReason: t("it is a symbolic link or leads outside the workspace folder"),
    kitStopped: (file, reason, written) =>
      t("Writing the starter kit stopped at {0}: {1}. Files already written: {2}", file, reason, written.length > 0 ? written.join(", ") : t("none")),
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

    launchRemote: (remoteName) => t("The local launcher opens your app in this computer's browser, but this window's extension host runs remotely ({0}). Open the folder in a local window to use /launch.", remoteName),
    launchEnvironmentIn: (environment, folders) => t("{0} — declared by {1}", environment, folders.join(", ")),
    launchDetected: t("This folder has no builderforce.json, so the launcher runs a detected manifest. Save it with /manifest init."),
    launchStarted: (folder, external) => (external
      ? t("The launcher for {0} is running and opened in your browser.", folder)
      : t("The launcher for {0} is running and opened in VS Code's built-in browser.", folder)),
    launchReopened: (folder, external) => (external
      ? t("The launcher for {0} was already running; it was opened in your browser again.", folder)
      : t("The launcher for {0} was already running; it was opened in VS Code's built-in browser again.", folder)),
    launchEditorUnavailable: t("VS Code's built-in browser isn't available in this version, so it opened in your browser."),
    launchEditorUntrusted: t("The launcher's certificate isn't trusted, so it opened in your browser instead of VS Code's built-in browser."),
    launchEditorFailed: (error) => t("VS Code's built-in browser could not open it ({0}), so it opened in your browser.", error),
    launchOpenInEditor: t("Open in VS Code"),
    launchOpenExternal: t("Open in external browser"),
    launchExternalChoice: t("Open the launcher in your external browser"),
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
    trustTimedOut: (seconds) => t("The certificate tool did not finish within {0} seconds, so the launcher's local certificate was not trusted. If your system asked you to confirm, answer it, then type /launch trust.", seconds),
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
