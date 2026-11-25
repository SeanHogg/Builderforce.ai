import * as vscode from "vscode";
import type { ComposerCommandLabels, ComposerCommandProblem } from "@seanhogg/builderforce-brain-embedded/composerCommands";
import type { DetectionNote } from "@builderforce/app-detect";
import type { KitIssue } from "@builderforce/ide-templates/kits";
import { detectionNoteText, kitIssueText } from "./noteLabels";
import { MANIFEST_PATH, WORKSPACE_DIR } from "./manifestLocation";

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
  /** The folder holds a legacy root manifest `file`: the kit's `canonical` supersedes it (delete it, or cancel and move it). */
  kitSupersedesLegacy(file: string, canonical: string): string;
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
  /** `/manifest init` stops: the folder's manifest is a legacy root `file`; move it to `canonical` first. */
  manifestInitMoveFirst(file: string, canonical: string): string;

  // /manifest move (`manifestMove.ts`)
  /** The `/help` label of the `move` choice. */
  manifestMoveChoice: string;
  /** The reply action that runs `/manifest move`. */
  manifestMoveAction: string;
  /** The folder's manifest is a legacy root `file`: deprecated, it belongs at `canonical`. */
  manifestLegacy(file: string, canonical: string): string;
  /** Nothing to move: none of these root files exists in the folder. */
  manifestMoveNone(folder: string, files: readonly string[]): string;
  /** Refused: `canonical` already exists, so the root `file` is not moved over it. */
  manifestMoveExists(file: string, canonical: string): string;
  manifestMoveQuestion(file: string, canonical: string, folder: string): string;
  manifestMove: string;
  manifestMoveDeclined: string;
  manifestMoved(file: string, canonical: string): string;
  // The stale `$schema` older versions wrote (`manifestSchema.ts`), removed by /manifest move.
  /** `/launch`: the manifest `file` carries `"$schema": url`, which does not load, so VS Code reports a problem. */
  manifestStaleSchema(file: string, url: string): string;
  /** The reply action that removes it (`/manifest move`). */
  manifestSchemaRemoveAction: string;
  /** Appended to the move question when the moved file loses it. */
  manifestSchemaDropNote(url: string): string;
  manifestSchemaRemoveQuestion(file: string, url: string, folder: string): string;
  manifestSchemaRemove: string;
  manifestSchemaKept: string;
  /** Not removed: `file` changed after it was read, and that edit is never overwritten. */
  manifestSchemaChanged(file: string): string;
  manifestSchemaRemoved(file: string): string;

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
  /** The integrated browser is there but the certificate is untrusted: `/launch trust`, then open in VS Code. */
  launchTrustAndOpenInEditor: string;
  launchExternalChoice: string;
  launchStopped(folder: string): string;
  launchNotRunning(folder: string): string;
  launchStopChoice: string;
  launchTrustChoice: string;
  launchFailed(error: string): string;
  /** `/launch <path>` named a file that is not an HTML page. */
  launchNotHtml(file: string): string;
  /** The action that launches that file's folder instead. */
  launchFolderAction: string;
  launchNoSuchPath(path: string): string;
  /** A drive-relative or root-relative path: say to use a full one. */
  launchNeedsFullPath(path: string): string;
  /** `/launch <folder>`: no manifest, no index page, and detection found nothing runnable. */
  launchNothingToRun(folder: string): string;
  /** `/launch <dir>` named a directory that must never be served. */
  launchRootRefused(directory: string): string;
  launchHomeRefused(directory: string): string;
  /** The directory is outside every workspace folder: the person approves serving all of it first. */
  launchOutsideQuestion(directory: string): string;
  launchOutsideApprove: string;
  launchOutsideDeclined(directory: string): string;
  /** The launcher refused the page (`LaunchPageErrorCode`), worded. */
  launchPageProblem(code: string, page: string): string;

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
    "starter-kit": t("Write a starter app (frontend, backend and extras) and its manifest, {0}, into this workspace folder.", MANIFEST_PATH),
    manifest: t("Detect this app and write its manifest, {0}, after showing you the diff. /manifest move moves a root builderforce.json there.", MANIFEST_PATH),
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
    kitSupersedesLegacy: (file, canonical) =>
      t("{0} at the folder root will no longer be read: the starter kit's {1} supersedes it. Delete it once the kit is written, or cancel and run /manifest move to keep it as the manifest.", file, canonical),
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
    manifestInitMoveFirst: (file, canonical) =>
      t("This folder's manifest is {0} at the folder root, so nothing was detected or written. Move it to {1} with /manifest move, then run /manifest init again.", file, canonical),

    manifestMoveChoice: t("Move a root manifest into {0}/", WORKSPACE_DIR),
    manifestMoveAction: t("Move it into {0}/", WORKSPACE_DIR),
    manifestLegacy: (file, canonical) =>
      t("This folder's manifest is {0} at the folder root, which is deprecated: it belongs at {1}. Type /manifest move to move it.", file, canonical),
    manifestMoveNone: (folder, files) => t("{0} has no root manifest to move ({1}).", folder, files.join(", ")),
    manifestMoveExists: (file, canonical) =>
      t("{0} already exists, so {1} was not moved and nothing was overwritten. Compare the two and delete the one you don't need.", canonical, file),
    manifestMoveQuestion: (file, canonical, folder) => t("Move {0} to {1} in {2}? No file is overwritten.", file, canonical, folder),
    manifestMove: t("Move"),
    manifestMoveDeclined: t("The manifest was not moved."),
    manifestMoved: (file, canonical) => t("Moved {0} to {1}.", file, canonical),
    manifestStaleSchema: (file, url) =>
      t("{0} sets $schema to {1}, which does not load yet, so VS Code reports a problem in it. The extension validates the manifest without it: type /manifest move to remove it.", file, url),
    manifestSchemaRemoveAction: t("Remove its $schema"),
    manifestSchemaDropNote: (url) => t("Its $schema ({0}) is removed: the extension validates the manifest without it.", url),
    manifestSchemaRemoveQuestion: (file, url, folder) =>
      t("Remove $schema ({1}) from {0} in {2}? That URL does not load yet; the extension validates the manifest without it. Nothing else in the file changes.", file, url, folder),
    manifestSchemaRemove: t("Remove"),
    manifestSchemaKept: t("The manifest was not changed."),
    manifestSchemaChanged: (file) => t("{0} was edited while you were asked, so $schema was not removed and the edit was kept. Run /manifest move again.", file),
    manifestSchemaRemoved: (file) => t("Removed $schema from {0}.", file),

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
    launchTrustAndOpenInEditor: t("Trust certificate and open in VS Code"),
    launchExternalChoice: t("Open the launcher in your external browser"),
    launchStopped: (folder) => t("Stopped the launcher for {0}.", folder),
    launchNotRunning: (folder) => t("No launcher is running for {0}.", folder),
    launchStopChoice: t("Stop the running launcher"),
    launchTrustChoice: t("Trust the launcher's local certificate"),
    launchFailed: (error) => t("The launcher could not start: {0}", error),
    launchNotHtml: (file) => t("{0} is not an HTML page. Only HTML pages can be launched; launch its folder instead.", file),
    launchFolderAction: t("Launch its folder"),
    launchNoSuchPath: (target) => t("There is no file or folder at {0}.", target),
    launchNeedsFullPath: (target) => t("{0} is not a full path. Give the whole path, starting with the drive letter.", target),
    launchNothingToRun: (folder) => t("{0} has no index.html or index.htm and no builderforce.json, so there is nothing to launch.", folder),
    launchRootRefused: (directory) => t("{0} is the root of a drive, so it cannot be launched: every file on it would be served.", directory),
    launchHomeRefused: (directory) => t("{0} is your home folder, so it cannot be launched: everything in it would be served.", directory),
    launchOutsideQuestion: (directory) => t("{0} is outside your workspace folders. Launching it serves every file in that folder to the page. Launch it?", directory),
    launchOutsideApprove: t("Launch"),
    launchOutsideDeclined: (directory) => t("Nothing was launched: {0} stays unserved.", directory),
    launchPageProblem: (code, page) => {
      switch (code) {
        case "not-relative": return t("The page {0} must be a path inside the folder, starting with /.", page);
        case "not-top-level": return t("The page {0} must be a file directly inside the launched folder.", page);
        case "not-html": return t("The page {0} is not an HTML page (.html or .htm).", page);
        case "missing": return t("The page {0} does not exist in the folder.", page);
        case "directory": return t("The page {0} is a folder, not an HTML file.", page);
        default: return t("The page {0} is a link that leads outside the folder.", page);
      }
    },

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
