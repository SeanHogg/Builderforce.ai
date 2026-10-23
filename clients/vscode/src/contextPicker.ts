import * as vscode from "vscode";

/**
 * Let the user attach workspace context to a message: the active editor's
 * selection, an already-open file, or any file chosen from disk. Returns the
 * relative path + text (or null if cancelled) — the webview attaches it through
 * the same upload pipeline as a dropped file, so the model gets the content.
 */
export async function pickWorkspaceContext(): Promise<{ path: string; text: string } | null> {
  // Note: the discriminator is `ctxKind`, not `kind` — `QuickPickItem.kind` is
  // reserved by VS Code (separator vs default), so reusing it collapses to never.
  type Item = vscode.QuickPickItem & { ctxKind: "selection" | "doc" | "browse"; uri?: vscode.Uri };
  const editor = vscode.window.activeTextEditor;
  const items: Item[] = [];
  if (editor && !editor.selection.isEmpty) {
    items.push({
      label: "$(selection) " + vscode.l10n.t("Active selection"),
      description: vscode.workspace.asRelativePath(editor.document.uri),
      ctxKind: "selection",
    });
  }
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.uri.scheme !== "file" || doc.isUntitled) continue;
    items.push({ label: "$(file) " + vscode.workspace.asRelativePath(doc.uri), ctxKind: "doc", uri: doc.uri });
  }
  items.push({ label: "$(search) " + vscode.l10n.t("Choose a file…"), ctxKind: "browse" });

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: vscode.l10n.t("Add context from your workspace"),
  });
  if (!pick) return null;

  if (pick.ctxKind === "selection" && editor) {
    return { path: vscode.workspace.asRelativePath(editor.document.uri), text: editor.document.getText(editor.selection) };
  }
  let uri = pick.uri;
  if (!uri) {
    const chosen = await vscode.window.showOpenDialog({
      canSelectMany: false,
      defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
    });
    uri = chosen?.[0];
  }
  if (!uri) return null;
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    return { path: vscode.workspace.asRelativePath(uri), text: doc.getText() };
  } catch {
    return null;
  }
}
