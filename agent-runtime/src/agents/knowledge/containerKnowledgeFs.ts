/**
 * The container's filesystem as the knowledge review reads it (PRD 38 §4.7, on-prem row):
 * the ONE walker (`@builderforce/agent-tools/knowledge` `createFsDirectorySource`) over
 * `node:fs`, and the `.builderforce/knowledge/` files a root's review manifest lives in.
 */

import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import chokidar from "chokidar";
import { isBuilderforceState, isSkippedPath, type KnowledgeFiles, type KnowledgeFs } from "@builderforce/agent-tools/knowledge/index.js";
import { logDebug } from "../../logger.js";

/** The slice of a chokidar watcher this uses (a test hands in its own). */
export interface FolderWatcher {
  on(event: "all" | "error", cb: (...args: any[]) => void): unknown;
  close(): Promise<void> | void;
}

/**
 * Whether the watcher should look at `path` at all: install and build trees, VCS stores and
 * the host's own `.builderforce/` state are never watched (the shared walker's skip list) — a
 * recursive watch on a `node_modules` is thousands of handles for events nobody wants.
 */
export function ignoredByKnowledgeWatch(base: string, path: string): boolean {
  const rel = relative(base, path).replace(/\\/g, "/");
  if (!rel || rel.startsWith("..")) return false;
  // `rel/x`: a directory's own name is judged like the files in it.
  return isSkippedPath(`${rel}/x`) || (rel !== ".builderforce" && isBuilderforceState(rel));
}

/**
 * Watches `base` and reports changed absolute paths. A watcher error (too many handles,
 * a folder that vanished, a permission) is logged and ends THIS watch — it never reaches the
 * process: the folder simply stops updating live.
 */
export function watchFolder(
  base: string,
  cb: (paths: string[]) => void,
  open: (base: string, ignored: (path: string) => boolean) => FolderWatcher = (b, ignored) =>
    chokidar.watch(b, { ignoreInitial: true, ignored, followSymlinks: false }),
): () => void {
  let closed = false;
  let watcher: FolderWatcher | undefined;
  const close = (): void => {
    if (closed) return;
    closed = true;
    try { void Promise.resolve(watcher?.close()).catch(() => undefined); } catch { /* already closed */ }
  };
  try {
    watcher = open(base, (path) => ignoredByKnowledgeWatch(base, path));
    watcher.on("all", (_event: string, path: string) => {
      if (!closed && path) cb([String(path).replace(/\\/g, "/")]);
    });
    watcher.on("error", (error: unknown) => {
      logDebug(`[knowledge] folder watch stopped: ${String(error)}`);
      close();
    });
  } catch (error) {
    logDebug(`[knowledge] folder watch unavailable: ${String(error)}`);
    close();
  }
  return close;
}

export const containerKnowledgeFs: KnowledgeFs = {
  async readDirectory(path) {
    const entries = await readdir(path, { withFileTypes: true });
    return entries
      .filter((e) => !e.isSymbolicLink() && (e.isFile() || e.isDirectory()))
      .map((e) => [e.name, e.isDirectory() ? "dir" : "file"] as [string, "file" | "dir"]);
  },
  async stat(path) {
    const st = await stat(path);
    return { mtime: st.mtimeMs, size: st.size };
  },
  readFile: async (path) => new Uint8Array(await readFile(path)),
  watch: (base, cb) => watchFolder(base, cb),
};

/** `<workspace>/.builderforce/knowledge/<name>` on disk. */
export function containerKnowledgeFiles(workspaceRoot: string): KnowledgeFiles {
  const dir = join(workspaceRoot, ".builderforce", "knowledge");
  return {
    async read(name) {
      try {
        return await readFile(join(dir, name), "utf8");
      } catch {
        return undefined;
      }
    },
    async write(name, text) {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, name), text, "utf8");
    },
  };
}
