/**
 * memoryWorkspaceFs.ts - a {@link WorkspaceFs} over an in-memory file map: the browser canvas's
 * files and every test of the shared coding provider. Pure and runtime-neutral.
 *
 * Keys are root-relative POSIX paths. A `Map` is used IN PLACE (the host keeps ownership, and its
 * writes show through); a plain record is copied into a fresh map, exposed as `files`.
 */

import { toPosixPath } from "./glob.js";
import type { WorkspaceEntry, WorkspaceFs, WorkspaceRead } from "./workspace.js";

export interface MemoryWorkspaceFs extends WorkspaceFs {
  /** The backing map: the caller's own when one was passed, else the copy made from the record. */
  readonly files: Map<string, string>;
}

const clean = (p: string): string => toPosixPath(p).replace(/^\.\/+/, "").replace(/^\/+|\/+$/g, "");

export function memoryWorkspaceFs(source: Map<string, string> | Record<string, string>): MemoryWorkspaceFs {
  const files = source instanceof Map ? source : new Map(Object.entries(source));
  const isDir = (dir: string): boolean => {
    if (dir === "") return true;
    const prefix = `${dir}/`;
    for (const k of files.keys()) if (k.startsWith(prefix)) return true;
    return false;
  };

  return {
    files,
    async *list(dir) {
      const base = clean(dir);
      if (!isDir(base)) throw Object.assign(new Error(`directory not found: ${dir}`), { code: "not_found" });
      const prefix = base === "" ? "" : `${base}/`;
      const seenDirs = new Set<string>();
      const out: WorkspaceEntry[] = [];
      for (const [key, content] of files) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const slash = rest.indexOf("/");
        if (slash === -1) out.push({ path: key, kind: "file", size: content.length });
        else {
          const child = `${prefix}${rest.slice(0, slash)}`;
          if (!seenDirs.has(child)) { seenDirs.add(child); out.push({ path: child, kind: "dir" }); }
        }
      }
      for (const e of out) yield e;
    },
    async read(path, { maxBytes }): Promise<WorkspaceRead> {
      const key = clean(path);
      const content = files.get(key);
      if (content === undefined) return isDir(key) && key !== "" ? { status: "is_directory" } : { status: "not_found" };
      return content.length > maxBytes ? { status: "ok", content: content.slice(0, maxBytes), truncated: true } : { status: "ok", content, truncated: false };
    },
    async write(path, content) {
      files.set(clean(path), content);
    },
    async remove(path) {
      return files.delete(clean(path)) ? "deleted" : "missing";
    },
  };
}
