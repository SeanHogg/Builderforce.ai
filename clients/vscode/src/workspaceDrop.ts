import * as vscode from "vscode";
import { onWorkspaceDropped } from "./bfApi";
import { SELECTED_TENANT_KEY } from "./projectState";

/**
 * What follows when the selected workspace is dropped because the person is no longer a
 * member of it (the `/api` re-scope refused, or the gateway answered `workspace_not_member`;
 * both go through `dropWorkspaceSelection`): forget the saved selection so it does not come
 * back on the next reload, refresh the views that reflect the workspace, and say so.
 */
export function watchDroppedWorkspace(context: vscode.ExtensionContext, refreshViews: () => void): vscode.Disposable {
  const off = onWorkspaceDropped(() => {
    void context.globalState.update(SELECTED_TENANT_KEY, undefined);
    refreshViews();
    void vscode.window.showWarningMessage(
      vscode.l10n.t("The workspace you selected is no longer available to you, so BuilderForce switched back to your default workspace."),
    );
  });
  return new vscode.Disposable(off);
}
