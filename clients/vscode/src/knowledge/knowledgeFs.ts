/**
 * The `vscode.workspace.fs` adapters the knowledge host runs on — kept apart from the
 * pure modules (`vscodeDirectorySource.ts`, `knowledgeStores.ts`) so those are tested
 * without an extension host.
 *
 *   - {@link vscodeKnowledgeFs}: the directory source's filesystem (walk, stat, read) and a
 *     FileSystemWatcher for its `watch`;
 *   - {@link workspaceKnowledgeFiles}: the local snapshot and manifest files under a
 *     workspace folder's `.builderforce/knowledge/`.
 */

import * as vscode from "vscode";
import type { KnowledgeFs } from "./vscodeDirectorySource";
import type { KnowledgeFiles } from "./knowledgeStores";

/** Changes a watcher batches before reporting them. */
const WATCH_DEBOUNCE_MS = 400;

const uriOf = (path: string): vscode.Uri => vscode.Uri.file(path);

export function vscodeKnowledgeFs(): KnowledgeFs {
  const fs = vscode.workspace.fs;
  return {
    async readDirectory(path) {
      const entries = await fs.readDirectory(uriOf(path));
      return entries
        .filter(([, type]) => (type & vscode.FileType.SymbolicLink) === 0)
        .map(([name, type]) => [name, (type & vscode.FileType.Directory) !== 0 ? "dir" : "file"] as [string, "file" | "dir"]);
    },
    async stat(path) {
      const st = await fs.stat(uriOf(path));
      return { mtime: st.mtime, size: st.size };
    },
    readFile: (path) => Promise.resolve(fs.readFile(uriOf(path))),
    watch(base, cb) {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(uriOf(base), "**/*"));
      const changed = new Set<string>();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const note = (uri: vscode.Uri): void => {
        changed.add(uri.fsPath.replace(/\\/g, "/"));
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          const paths = [...changed];
          changed.clear();
          cb(paths);
        }, WATCH_DEBOUNCE_MS);
      };
      const subs = [watcher.onDidChange(note), watcher.onDidCreate(note), watcher.onDidDelete(note)];
      return () => {
        if (timer) clearTimeout(timer);
        for (const s of subs) s.dispose();
        watcher.dispose();
      };
    },
  };
}

/** `.builderforce/knowledge/<name>` under a workspace folder, through the workspace fs. */
export function workspaceKnowledgeFiles(folderPath: string): KnowledgeFiles {
  const dir = vscode.Uri.joinPath(uriOf(folderPath), ".builderforce", "knowledge");
  const fs = vscode.workspace.fs;
  return {
    async read(name) {
      try {
        return new TextDecoder().decode(await fs.readFile(vscode.Uri.joinPath(dir, name)));
      } catch {
        return undefined;
      }
    },
    async write(name, text) {
      await fs.createDirectory(dir);
      await fs.writeFile(vscode.Uri.joinPath(dir, name), new TextEncoder().encode(text));
    },
  };
}
