/**
 * The `vscode.workspace.fs` adapters the knowledge host runs on — kept apart from the
 * pure modules (`vscodeDirectorySource.ts`, `knowledgeStores.ts`) so those are tested
 * without an extension host.
 *
 *   - {@link vscodeKnowledgeFs}: the directory source's filesystem (walk, stat, read) and a
 *     FileSystemWatcher for its `watch` (it drops `.builderforce/cache/**`, our own SQLite
 *     writes). Stat is node's BigInt stat for a disk path, the workspace fs otherwise;
 *   - {@link workspaceKnowledgeFiles}: the local snapshot and manifest files under a
 *     workspace folder's `.builderforce/knowledge/`.
 */

import { appendFile, mkdir, open, rename, rm, stat as nodeStat, type FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
import * as vscode from "vscode";
import type { KnowledgeFs } from "./vscodeDirectorySource";
import { isAliasConfigFile, noteAliasConfigChanged } from "./aliasConfigEvents";
import type { KnowledgeFiles } from "./knowledgeStores";
import type { IgnoreFilePort } from "./knowledgeExclude";

/** Changes a watcher batches before reporting them. */
const WATCH_DEBOUNCE_MS = 400;

/** `.builderforce/cache/` holds the knowledge SQLite file: every review write there would wake the watcher, so its events are dropped. */
export const isKnowledgeCachePath = (path: string): boolean => /(^|\/)\.builderforce\/cache(\/|$)/.test(path.replace(/\\/g, "/"));

const uriOf = (path: string): vscode.Uri => vscode.Uri.file(path);

/** The tail of each file path's in-process write chain. */
const fileChains = new Map<string, Promise<unknown>>();

/** Runs `task` after every earlier task on the same file path, one at a time; a failure does not break the chain. */
function exclusiveOn<T>(path: string, task: () => Promise<T>): Promise<T> {
  const run = (fileChains.get(path) ?? Promise.resolve()).then(task);
  const tail = run.catch(() => undefined);
  fileChains.set(path, tail);
  void tail.then(() => { if (fileChains.get(path) === tail) fileChains.delete(path); });
  return run;
}

/** `watchDebounceMs`: how long `watch` settles a burst; default {@link WATCH_DEBOUNCE_MS} (the background indexer coalesces at its own 100 ms and passes 0). */
export function vscodeKnowledgeFs(opts: { watchDebounceMs?: number } = {}): KnowledgeFs {
  const fs = vscode.workspace.fs;
  const watchDebounceMs = opts.watchDebounceMs ?? WATCH_DEBOUNCE_MS;
  return {
    async readDirectory(path) {
      const entries = await fs.readDirectory(uriOf(path));
      return entries
        .filter(([, type]) => (type & vscode.FileType.SymbolicLink) === 0)
        .map(([name, type]) => [name, (type & vscode.FileType.Directory) !== 0 ? "dir" : "file"] as [string, "file" | "dir"]);
    },
    async stat(path) {
      // A disk path: node's BigInt stat, so the stat prefilter compares ns mtimes and file ids losslessly (PRD 41 B2).
      try {
        const st = await nodeStat(path, { bigint: true });
        return { mtime: Number(st.mtimeMs), size: Number(st.size), mtimeNs: st.mtimeNs, fileId: st.ino };
      } catch {
        // What node cannot stat (a path a file-system provider serves): the workspace fs, ms mtime only.
        const st = await fs.stat(uriOf(path));
        return { mtime: st.mtime, size: st.size };
      }
    },
    readFile: (path) => Promise.resolve(fs.readFile(uriOf(path))),
    watch(base, cb) {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(uriOf(base), "**/*"));
      const changed = new Set<string>();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const note = (uri: vscode.Uri): void => {
        if (isKnowledgeCachePath(uri.fsPath)) return;
        // A tsconfig/jsconfig created, changed or deleted: the root's cached path aliases are stale at once.
        if (isAliasConfigFile(uri.fsPath)) noteAliasConfigChanged(uri.fsPath);
        changed.add(uri.fsPath.replace(/\\/g, "/"));
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          const paths = [...changed];
          changed.clear();
          cb(paths);
        }, watchDebounceMs);
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
    write(name, text) {
      const target = vscode.Uri.joinPath(dir, name);
      return exclusiveOn(target.fsPath, async () => {
        // A name may sit in a subfolder (`runs/<id>.json`): its folder is made, not only the knowledge folder.
        await fs.createDirectory(vscode.Uri.joinPath(target, ".."));
        // Never truncate in place: a crash mid-write would leave a half file. Write beside it, then rename over.
        const temp = vscode.Uri.joinPath(dir, `${name}.tmp`);
        await fs.writeFile(temp, new TextEncoder().encode(text));
        await fs.rename(temp, target, { overwrite: true });
      });
    },
    append(name, text) {
      const target = vscode.Uri.joinPath(dir, name);
      // One batch can exceed the size an OS appends atomically, so appends to a file never overlap in this process.
      // ACROSS windows safety rests on the reader, not on locking: a line-level torn-line skip on read plus
      // last-line-wins per hash (see `LocalSnapshotStore`), so interleaved or partial lines cost a cache entry, never the log.
      return exclusiveOn(target.fsPath, async () => {
        await fs.createDirectory(vscode.Uri.joinPath(target, ".."));
        await appendFile(target.fsPath, text, "utf8");
      });
    },
    async remove(name) {
      try {
        await fs.delete(vscode.Uri.joinPath(dir, name));
      } catch {
        // Already gone.
      }
    },
    async list(folder) {
      try {
        return (await fs.readDirectory(vscode.Uri.joinPath(dir, folder))).map(([name]) => name);
      } catch {
        return [];
      }
    },
    // The node fs, not the workspace fs: the replica lock's takeover needs a rename that rejects
    // when another host already moved the file (ENOENT), and replaces the target otherwise.
    async rename(from, to) {
      const target = vscode.Uri.joinPath(dir, to);
      await mkdir(vscode.Uri.joinPath(target, "..").fsPath, { recursive: true });
      await rename(vscode.Uri.joinPath(dir, from).fsPath, target.fsPath);
    },
    createExclusive: (name, text) => createExclusiveFile(vscode.Uri.joinPath(dir, name).fsPath, text),
  };
}

/**
 * Creates `path` with `text` only when it does not exist — the OS's atomic exclusive create
 * (`open(path, "wx")`), so of two hosts racing for one file exactly one wins. True when THIS
 * call created it, false when it already existed; any other failure rejects. A write that
 * fails after the create removes the half file, so a crashed create never holds the name.
 */
export async function createExclusiveFile(path: string, text: string): Promise<boolean> {
  await mkdir(dirname(path), { recursive: true });
  let handle: FileHandle;
  try {
    handle = await open(path, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  try {
    await handle.writeFile(text, "utf8");
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(path, { force: true }).catch(() => undefined);
    throw error;
  }
  await handle.close();
  return true;
}

/** A root's `.builderforce/ignore` through the workspace fs; a write goes to a temp file first and replaces the ignore file by rename (atomic). */
export function rootIgnoreFile(rootPath: string): IgnoreFilePort {
  const dir = vscode.Uri.joinPath(uriOf(rootPath), ".builderforce");
  const target = vscode.Uri.joinPath(dir, "ignore");
  const fs = vscode.workspace.fs;
  return {
    async read() {
      try {
        return new TextDecoder().decode(await fs.readFile(target));
      } catch {
        return undefined;
      }
    },
    async write(text) {
      await fs.createDirectory(dir);
      // A name of its own per write: two writes (two windows) never share a temp file.
      const temp = vscode.Uri.joinPath(dir, `ignore.${process.pid}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.tmp`);
      await fs.writeFile(temp, new TextEncoder().encode(text));
      await fs.rename(temp, target, { overwrite: true });
    },
  };
}
