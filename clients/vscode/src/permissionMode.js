import * as vscode from "vscode";
/** The configured mode. `ask` is the safe default: a mutating tool here edits real files. */
export function permissionMode() {
    return vscode.workspace.getConfiguration("builderforce").get("permissionMode") ?? "ask";
}
/** The same decision as a boolean, for the panel's Auto-mode switch. */
export function autoApproveDefault() {
    return permissionMode() === "acceptEdits";
}
/** The setting's id, for a configuration-change listener that must re-push it. */
export const PERMISSION_MODE_SETTING = "builderforce.permissionMode";
//# sourceMappingURL=permissionMode.js.map