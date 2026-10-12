import * as vscode from "vscode";
import { confirmDestructiveDelete } from "./confirmDeletion";

/**
 * The editor's binding of {@link confirmDestructiveDelete}: a modal warning through
 * `vscode.window`, worded through `vscode.l10n`. Every delete in the extension (chats,
 * tasks) confirms through this one call.
 */
export function confirmDeleteInEditor(subject: string, executing: boolean): Promise<boolean> {
  return confirmDestructiveDelete({
    subject,
    executing,
    ui: {
      showWarningMessage: (message, options, ...items) => vscode.window.showWarningMessage(message, options, ...items),
    },
    t: (message, ...args) => vscode.l10n.t(message, ...args),
  });
}
