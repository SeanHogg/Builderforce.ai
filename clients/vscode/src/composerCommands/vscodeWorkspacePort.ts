/**
 * The editor half of the composer commands: the {@link ComposerWorkspacePort} over
 * `vscode.workspace.fs` and a modal warning, and the manifest preview/diff shown before
 * `/manifest init` writes. The ONE place these executors meet `vscode`.
 */
import { lstat, stat } from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import type { ShowManifest } from "./manifestInit";
import { MANIFEST_FILE } from "./manifestLocation";
import { isMissingPath, refusedWrites, WriteRefusedError } from "./writeContainment";
import { TargetExistsError, type ComposerWorkspacePort, type WorkspaceFolderRef } from "./workspacePort";

const refOf = (folder: vscode.WorkspaceFolder): WorkspaceFolderRef => ({ name: folder.name, path: folder.uri.fsPath });

const isMissing = (error: unknown): boolean => error instanceof vscode.FileSystemError && error.code === "FileNotFound";

export function vscodeWorkspacePort(): ComposerWorkspacePort {
  const fs = vscode.workspace.fs;
  const folders = (): WorkspaceFolderRef[] => (vscode.workspace.workspaceFolders ?? []).map(refOf);
  const checkWrites = (files: readonly string[]) => refusedWrites(files, folders().map((folder) => folder.path));
  return {
    folders,
    remoteName: () => vscode.env.remoteName,
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
    // `lstat`, not `stat`: a symbolic link — dangling or not — is an entry that exists (and a write refuses it).
    exists: async (file) => {
      try {
        await lstat(file);
        return true;
      } catch (error) {
        if (isMissingPath(error)) return false;
        throw error;
      }
    },
    // `stat`, not `lstat`: a link to a page or a folder is that page or folder.
    stat: async (file) => {
      try {
        const entry = await stat(file);
        return entry.isDirectory() ? "directory" : entry.isFile() ? "file" : undefined;
      } catch (error) {
        if (isMissingPath(error)) return undefined;
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
    checkWrites,
    writeText: async (file, text) => {
      const refused = await checkWrites([file]);
      if (refused.length > 0) throw new WriteRefusedError(refused);
      await fs.createDirectory(vscode.Uri.file(path.dirname(file)));
      await fs.writeFile(vscode.Uri.file(file), new TextEncoder().encode(text));
    },
    move: async (from, to) => {
      const refused = await checkWrites([from, to]);
      if (refused.length > 0) throw new WriteRefusedError(refused);
      await fs.createDirectory(vscode.Uri.file(path.dirname(to)));
      // `overwrite: false`: an existing target rejects (FileExists), never replaced.
      try {
        await fs.rename(vscode.Uri.file(from), vscode.Uri.file(to), { overwrite: false });
      } catch (error) {
        if (error instanceof vscode.FileSystemError && error.code === "FileExists") throw new TargetExistsError(to);
        throw error;
      }
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
    const uri = vscode.Uri.from({ scheme: PREVIEW_SCHEME, path: `/${encodeURIComponent(currentFile ?? "detected")}/${MANIFEST_FILE}` });
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
