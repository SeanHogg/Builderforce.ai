/**
 * Keeps the editor's definition index current as files change — from the agent, the
 * user, a `git checkout` or another tool. Each event re-parses exactly the file it names
 * on the next lookup, so the index never needs a per-query tree walk (the 10-minute full
 * walk in `workspaceSymbols.ts` is only the backstop for what a watcher cannot report).
 * The watcher reports EVERYTHING (`node_modules`, build output, the index's own
 * `.builderforce/symbols.json`); the index drops what its walk would never visit — the
 * skip dirs and dot directories — so those events cost nothing.
 */

import * as vscode from "vscode";
import { markSymbolFileChanged } from "@builderforce/agent-tools/node-symbols";

export function watchWorkspaceSymbols(): vscode.Disposable[] {
  const watcher = vscode.workspace.createFileSystemWatcher("**/*");
  const mark = (uri: vscode.Uri) => markSymbolFileChanged(uri.fsPath);
  return [watcher, watcher.onDidCreate(mark), watcher.onDidChange(mark), watcher.onDidDelete(mark)];
}
