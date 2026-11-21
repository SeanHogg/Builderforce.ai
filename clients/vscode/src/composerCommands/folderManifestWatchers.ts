/**
 * The manifest watchers the `/` menu's help refresh listens to (`helpRefresh.ts`): per
 * workspace folder, ONE `RelativePattern(folder, path)` watcher for each place its manifest
 * may be (`MANIFEST_READ_ORDER`: `.builderforce/builderforce.json`, then the legacy root files)
 * — only those exact paths, never a whole-tree `**` glob (every `node_modules` copy) —
 * re-created when a folder is added or removed, and every one disposed with the returned source.
 */
import * as vscode from "vscode";
import type { HelpRefreshDeps } from "./helpRefresh";

type ManifestEvents = HelpRefreshDeps["manifestEvents"];

export function folderManifestWatchers(relativePaths: readonly string[]): ManifestEvents {
  const created = new vscode.EventEmitter<string>();
  const changed = new vscode.EventEmitter<string>();
  const deleted = new vscode.EventEmitter<string>();
  let watchers: vscode.Disposable[] = [];

  const watch = (folder: vscode.WorkspaceFolder, relative: string): vscode.Disposable => {
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, relative));
    const forwards = [
      watcher.onDidCreate((uri) => created.fire(uri.fsPath)),
      watcher.onDidChange((uri) => changed.fire(uri.fsPath)),
      watcher.onDidDelete((uri) => deleted.fire(uri.fsPath)),
    ];
    return { dispose: () => { for (const forward of forwards) forward.dispose(); watcher.dispose(); } };
  };
  const disposeWatchers = (): void => {
    for (const watcher of watchers) watcher.dispose();
    watchers = [];
  };
  const rebuild = (): void => {
    disposeWatchers();
    watchers = (vscode.workspace.workspaceFolders ?? []).flatMap((folder) => relativePaths.map((relative) => watch(folder, relative)));
  };

  rebuild();
  const folderChanges = vscode.workspace.onDidChangeWorkspaceFolders(rebuild);
  return {
    onCreate: (listener) => created.event(listener),
    onChange: (listener) => changed.event(listener),
    onDelete: (listener) => deleted.event(listener),
    dispose: () => {
      folderChanges.dispose();
      disposeWatchers();
      created.dispose();
      changed.dispose();
      deleted.dispose();
    },
  };
}
