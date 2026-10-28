/**
 * The container's filesystem as the knowledge review reads it (PRD 38 §4.7, on-prem row):
 * the ONE walker (`@builderforce/agent-tools/knowledge` `createFsDirectorySource`) over
 * `node:fs`, and the `.builderforce/knowledge/` files a root's review manifest lives in.
 */

import { watch as fsWatch } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { KnowledgeFiles, KnowledgeFs } from "@builderforce/agent-tools/knowledge/index.js";

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
  watch(base, cb) {
    try {
      const watcher = fsWatch(base, { recursive: true }, (_event, name) => {
        if (name) cb([`${base}/${String(name).replace(/\\/g, "/")}`]);
      });
      return () => watcher.close();
    } catch {
      return () => undefined; // No recursive watch on this platform: no live updates.
    }
  },
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
