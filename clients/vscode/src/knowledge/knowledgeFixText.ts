/**
 * The words the fix flow's host side shows the person, in ONE place so each goes through
 * `vscode.l10n.t` (all five bundles). Pure modules (`knowledgeShell`, `knowledgeFixPaths`, ...)
 * import these instead of writing English, so they stay testable with a stub `vscode`.
 */

import * as vscode from "vscode";

const t = vscode.l10n.t;

export const fixText = {
  // paths
  outsideFolder: (p: string): string => t("\"{0}\" is outside the folder, so nothing was changed.", p),
  throughLink: (p: string): string => t("\"{0}\" is reached through a link, so nothing was changed.", p),
  isLink: (p: string): string => t("\"{0}\" is a link, so nothing was changed.", p),
  // undo
  undoNoFiles: (): string => t("Nothing to undo: the fix changed no files."),
  undoMoved: (was: string, now: string): string => t("The branch moved since the fix ({0} to {1}), so nothing was undone.", was, now),
  undoDiverged: (files: string): string => t("These files changed since the fix, so nothing was undone: {0}.", files),
  undoNothingLeft: (): string => t("Nothing to undo: none of the fix's files are left to revert."),
  lsTreeFailed: (): string => t("git ls-tree failed, so nothing was undone."),
  switchBackFailed: (branch: string, why: string): string => t("The fix was undone, but the branch {0} could not be switched back to: {1}", branch, why),
  unknownFix: (): string => t("Nothing to undo: this fix is unknown or was already undone."),
  // checks and the session
  checkRunning: (): string => t("A check is already running for this folder."),
  noSuchCheck: (id: string): string => t("There is no check \"{0}\".", id),
  // shell
  couldNotRun: (label: string, why: string): string => t("{0} could not run: {1}", label, why),
  timedOut: (label: string, seconds: number): string => t("{0} did not finish within {1} seconds, so it was stopped.", label, seconds),
  cancelled: (label: string): string => t("{0} was cancelled.", label),
  failedExit: (label: string, code: string): string => t("{0} failed (exit {1}).", label, code),
  rescanStill: (files: string): string => t("knip still reports: {0}", files),
  // the codemod
  noAutomaticFix: (kind: string): string => t("There is no automatic fix for \"{0}\".", kind),
  noFileOfFolder: (): string => t("The finding names no file of this folder."),
  noCommit: (): string => t("This repository has no commit yet, so a fix cannot be undone safely. Make a first commit, then try again."),
  statusUnreadable: (): string => t("Git status could not be read, so nothing was changed."),
  treeChanges: (files: string): string => t("The work tree has changes ({0}). Commit or stash your changes first, then try again.", files),
  saveFirst: (files: string): string => t("Save or close the editors with unsaved changes first: {0}.", files),
  notUndoneCleanly: (why: string): string => t("The fix could not be undone cleanly: {0} Check the work tree with git status.", why),
  statusUnreadableAfter: (): string => t("Git status could not be read after the fix."),
  headUnreadable: (): string => t("The current commit could not be read."),
  notRecorded: (why: string): string => t("The fix could not be recorded for undo, so it was reverted and you are back on your branch: {0}", why),
  notRecordedReverted: (why: string): string => t("The fix could not be recorded for undo, so it was reverted: {0}", why),
  notRecordedStillOnBranch: (branch: string, why: string): string => t("The fix could not be recorded for undo, so it was reverted, but you are still on {0}: {1}", branch, why),
  notRecordedRevertFailed: (why: string, revertWhy: string): string => t("The fix could not be recorded for undo, and reverting it failed ({1}): {0} Check the work tree with git status.", why, revertWhy),
  gitFailed: (command: string, why: string): string => t("git {0} failed{1}", command, why),
  fixNote: (): string => t("knip removes every unused export in each of these files, not only the one the finding names."),
} as const;
