import * as vscode from "vscode";

/**
 * WHERE "should I ask before touching the working tree?" is decided — once.
 *
 * This is the same shape of rule as `modelRouting.ts`, and it broke the same way. The
 * `@builderforce` participant read `builderforce.permissionMode` from configuration; the
 * Brain panel had its own Auto-mode toggle, defaulted off in code and persisted in the
 * webview's own storage, and never looked at the setting at all. So switching the setting
 * from `ask` to `acceptEdits` changed one surface and silently left the other asking —
 * two answers to one product question, exactly as the scanner and the participant once
 * disagreed about which model to run.
 *
 * The setting is the user's standing instruction. The panel's toggle is a live override
 * of it, which is why the panel is HANDED this value rather than reading the setting
 * itself (a webview cannot read configuration anyway, and giving it a second route to the
 * answer is how the two drifted apart to begin with).
 */
export type PermissionMode = "ask" | "acceptEdits";

/** The configured mode. `ask` is the safe default: a mutating tool here edits real files. */
export function permissionMode(): PermissionMode {
  return vscode.workspace.getConfiguration("builderforce").get<PermissionMode>("permissionMode") ?? "ask";
}

/** The same decision as a boolean, for the panel's Auto-mode switch. */
export function autoApproveDefault(): boolean {
  return permissionMode() === "acceptEdits";
}

/** The setting's id, for a configuration-change listener that must re-push it. */
export const PERMISSION_MODE_SETTING = "builderforce.permissionMode";
