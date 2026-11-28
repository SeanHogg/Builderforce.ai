/**
 * The editor's ONE workspace change feed (`WatchPort`, agent-tools `watch-port`): a single
 * `FileSystemWatcher` over every workspace folder, fanned out to whoever subscribed — the
 * definition index (every event, `markSymbolFileChanged`) and the Workspace MCP's code index
 * (`vscodeWatchPort()`, per root). There is no second VS Code watcher.
 *
 * Each event re-parses exactly the file it names on the next lookup, so the definition index
 * never needs a per-query tree walk (the 10-minute full walk in `workspaceSymbols.ts` is only
 * the backstop for what a watcher cannot report). The watcher reports EVERYTHING
 * (`node_modules`, build output, the indexes' own `.builderforce/` files); each consumer drops
 * what it would never visit, so those events cost nothing.
 */

import * as path from "path";
import type * as vscode from "vscode";
import { markSymbolFileChanged } from "@builderforce/agent-tools/node-symbols";
import type { WatchPort } from "@builderforce/agent-tools/watch-port";

interface Listener {
  /** Only events under this folder; undefined = every event. */
  root: string | undefined;
  onChange(absPaths: string[]): void;
}

const listeners = new Set<Listener>();

function under(root: string, abs: string): boolean {
  const rel = path.relative(root, abs);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function dispatch(uri: vscode.Uri): void {
  const abs = uri.fsPath;
  for (const listener of [...listeners]) {
    if (listener.root === undefined || under(listener.root, abs)) listener.onChange([abs]);
  }
}

/** The editor's change feed for a root, over the one shared watcher ({@link watchWorkspaceSymbols}). */
export function vscodeWatchPort(): WatchPort {
  return {
    subscribe(root, onChange) {
      const listener: Listener = { root: path.resolve(root), onChange };
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** Open the one watcher and feed the definition index from it; dispose with the extension. */
export function watchWorkspaceSymbols(workspace: Pick<typeof vscode.workspace, "createFileSystemWatcher">): vscode.Disposable[] {
  const watcher = workspace.createFileSystemWatcher("**/*");
  const symbols: Listener = { root: undefined, onChange: (absPaths) => { for (const abs of absPaths) markSymbolFileChanged(abs); } };
  listeners.add(symbols);
  return [
    watcher,
    watcher.onDidCreate(dispatch),
    watcher.onDidChange(dispatch),
    watcher.onDidDelete(dispatch),
    { dispose: () => { listeners.delete(symbols); } },
  ];
}
