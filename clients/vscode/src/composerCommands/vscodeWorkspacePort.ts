/**
 * The editor half of the composer commands: the {@link ComposerWorkspacePort} over
 * `vscode.workspace.fs` and a modal warning, and the manifest preview/diff shown before
 * `/manifest init` writes. The ONE place these executors meet `vscode`.
 */
import * as path from "node:path";
import * as vscode from "vscode";
import type { ShowManifest } from "./manifestInit";
import type { ComposerWorkspacePort, WorkspaceFolderRef } from "./workspacePort";

const refOf = (folder: vscode.WorkspaceFolder): WorkspaceFolderRef => ({ name: folder.name, path: folder.uri.fsPath });

const isMissing = (error: unknown): boolean => error instanceof vscode.FileSystemError && error.code === "FileNotFound";

export function vscodeWorkspacePort(): ComposerWorkspacePort {
  const fs = vscode.workspace.fs;
  return {
    folders: () => (vscode.workspace.workspaceFolders ?? []).map(refOf),
    pickFolder: async (placeHolder) => {
      const folder = await vscode.window.showWorkspaceFolderPick({ placeHolder });
      return folder ? refOf(folder) : undefined;
    },
    listDir: async (dir) => {
      try {
        return (await fs.readDirectory(vscode.Uri.file(dir))).map(([name]) => name);
      } catch (error) {
        if (isMissing(error)) return [];
        throw error;
      }
    },
    exists: async (file) => {
      try {
        await fs.stat(vscode.Uri.file(file));
        return true;
      } catch (error) {
        if (isMissing(error)) return false;
        throw error;
      }
    },
    readText: async (file) => {
      try {
        return new TextDecoder().decode(await fs.readFile(vscode.Uri.file(file)));
      } catch (error) {
        if (isMissing(error)) return undefined;
        throw error;
      }
    },
    writeText: async (file, text) => {
      await fs.createDirectory(vscode.Uri.file(path.dirname(file)));
      await fs.writeFile(vscode.Uri.file(file), new TextEncoder().encode(text));
    },
    confirm: async (message, approve) => (await vscode.window.showWarningMessage(message, { modal: true }, approve)) === approve,
  };
}

/** The read-only scheme the proposed manifest is shown under (no "save changes?" prompt when it closes). */
const PREVIEW_SCHEME = "builderforce-manifest";

/**
 * Register the preview's content provider (once, disposed with the extension) and return
 * the {@link ShowManifest} that opens it: a diff beside the current file, else a preview.
 */
export function registerManifestPreview(subscriptions: vscode.Disposable[]): ShowManifest {
  const proposals = new Map<string, string>();
  const changed = new vscode.EventEmitter<vscode.Uri>();
  subscriptions.push(
    changed,
    vscode.workspace.registerTextDocumentContentProvider(PREVIEW_SCHEME, {
      onDidChange: changed.event,
      provideTextDocumentContent: (uri) => proposals.get(uri.toString()) ?? "",
    }),
  );
  return async (proposed, title, currentFile) => {
    const uri = vscode.Uri.from({ scheme: PREVIEW_SCHEME, path: `/${encodeURIComponent(currentFile ?? "detected")}/builderforce.json` });
    proposals.set(uri.toString(), proposed);
    changed.fire(uri);
    if (currentFile) {
      await vscode.commands.executeCommand("vscode.diff", vscode.Uri.file(currentFile), uri, title, { preview: true });
    } else {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: true });
    }
  };
}
