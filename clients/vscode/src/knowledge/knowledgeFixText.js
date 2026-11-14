/**
 * The words the fix flow's host side shows the person, in ONE place so each goes through
 * `vscode.l10n.t` (all five bundles). Pure modules (`knowledgeShell`, `knowledgeFixPaths`, ...)
 * import these instead of writing English, so they stay testable with a stub `vscode`.
 */
import * as vscode from "vscode";
const t = vscode.l10n.t;
export const fixText = {
    // paths
    outsideFolder: (p) => t("\"{0}\" is outside the folder, so nothing was changed.", p),
    throughLink: (p) => t("\"{0}\" is reached through a link, so nothing was changed.", p),
    isLink: (p) => t("\"{0}\" is a link, so nothing was changed.", p),
    // undo
    undoNoFiles: () => t("Nothing to undo: the fix changed no files."),
    undoMoved: (was, now) => t("The branch moved since the fix ({0} to {1}), so nothing was undone.", was, now),
    undoDiverged: (files) => t("These files changed since the fix, so nothing was undone: {0}.", files),
    undoNothingLeft: () => t("Nothing to undo: none of the fix's files are left to revert."),
    lsTreeFailed: () => t("git ls-tree failed, so nothing was undone."),
    switchBackFailed: (branch, why) => t("The fix was undone, but the branch {0} could not be switched back to: {1}", branch, why),
    unknownFix: () => t("Nothing to undo: this fix is unknown or was already undone."),
    // checks and the session
    checkRunning: () => t("A check is already running for this folder."),
    noSuchCheck: (id) => t("There is no check \"{0}\".", id),
    // shell
    couldNotRun: (label, why) => t("{0} could not run: {1}", label, why),
    timedOut: (label, seconds) => t("{0} did not finish within {1} seconds, so it was stopped.", label, seconds),
    cancelled: (label) => t("{0} was cancelled.", label),
    failedExit: (label, code) => t("{0} failed (exit {1}).", label, code),
    rescanStill: (files) => t("knip still reports: {0}", files),
    // the codemod
    noAutomaticFix: (kind) => t("There is no automatic fix for \"{0}\".", kind),
    noFileOfFolder: () => t("The finding names no file of this folder."),
    noCommit: () => t("This repository has no commit yet, so a fix cannot be undone safely. Make a first commit, then try again."),
    statusUnreadable: () => t("Git status could not be read, so nothing was changed."),
    treeChanges: (files) => t("The work tree has changes ({0}). Commit or stash your changes first, then try again.", files),
    saveFirst: (files) => t("Save or close the editors with unsaved changes first: {0}.", files),
    notUndoneCleanly: (why) => t("The fix could not be undone cleanly: {0} Check the work tree with git status.", why),
    statusUnreadableAfter: () => t("Git status could not be read after the fix."),
    headUnreadable: () => t("The current commit could not be read."),
    notRecorded: (why) => t("The fix could not be recorded for undo, so it was reverted and you are back on your branch: {0}", why),
    notRecordedReverted: (why) => t("The fix could not be recorded for undo, so it was reverted: {0}", why),
    notRecordedStillOnBranch: (branch, why) => t("The fix could not be recorded for undo, so it was reverted, but you are still on {0}: {1}", branch, why),
    notRecordedRevertFailed: (why, revertWhy) => t("The fix could not be recorded for undo, and reverting it failed ({1}): {0} Check the work tree with git status.", why, revertWhy),
    gitFailed: (command, why) => t("git {0} failed{1}", command, why),
    noExportName: () => t("The finding does not name the export to remove. Run the review again, then apply the fix."),
    exportNotFound: (name) => t("No top-level export named \"{0}\" was found, so nothing was changed.", name),
    exportUnsupported: (name) => t("\"{0}\" is exported in a form the fix does not edit, so nothing was changed.", name),
    exportUnparsed: (name) => t("The file could not be parsed cleanly, so \"{0}\" was not removed.", name),
};
//# sourceMappingURL=knowledgeFixText.js.map