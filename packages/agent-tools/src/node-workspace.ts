/**
 * `@builderforce/agent-tools/node-workspace` - the ONE local-disk {@link WorkspaceFs}: what the VS
 * Code extension, the on-prem agent runtime and the workspace MCP hand to `createRepoCapabilities`
 * so list/read/search/write/edit/delete are written once. Node-only (its own export condition; the
 * package root stays node-builtin-free for the Worker).
 *
 * Containment is the shared `node-path` resolvers, exactly as the hosts applied them before:
 * `workspace` scope resolves real paths (a link out of the root is refused), `unconfined` resolves
 * a path against the root only (absolute and `..` paths are the caller's call). List and search are
 * ALWAYS confined to the root, whatever the scope. An escape throws
 * `WorkspaceError("outside_root", "'<path>' is outside the workspace")`.
 *
 * Search is the existing exact/regex searcher (`node-text-search`: ripgrep first, the in-process
 * walk as the fallback); its scope is the search TARGET, resolved before the search.
 */

import { mkdir, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { tryResolveInsideRootReal } from "./node-path.js";
import { searchWorkspace } from "./node-text-search.js";
import { WorkspaceError, type SearchFound, type WorkspaceEntry, type WorkspaceFs, type WorkspaceRead } from "./workspace.js";
import type { SearchMatch } from "./text-scan.js";

export interface NodeWorkspaceOptions {
  /** `workspace` (default): every path must resolve inside the root, links included. `unconfined`: file ops may reach outside it. */
  scope?: "workspace" | "unconfined";
  /** The ripgrep binary, a lazy resolver for it (probed per search), or null/absent to walk in-process. */
  ripgrep?: string | null | (() => Promise<string | null>);
  /** The run's Stop: kills a running ripgrep and ends the fallback walk. */
  signal?: AbortSignal;
}

const isMissing = (e: unknown): boolean => {
  const code = (e as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
};

/** The local-disk workspace rooted at `root`. */
export function nodeWorkspaceFs(root: string, options: NodeWorkspaceOptions = {}): WorkspaceFs {
  const rootResolved = resolve(root);
  const unconfined = options.scope === "unconfined";
  // Directories a listing already yielded: their children came from `readdir` (a link is not a
  // directory entry here), so a nested list needs no second real-path check.
  const emitted = new Set<string>();

  const confined = async (p: string): Promise<string> => {
    const r = await tryResolveInsideRootReal(rootResolved, p);
    if (r.ok) return r.abs;
    throw new WorkspaceError(r.reason === "escapes" ? "outside_root" : "io", r.error);
  };
  const fileAbs = (p: string): Promise<string> => (unconfined ? Promise.resolve(resolve(rootResolved, p)) : confined(p));

  async function* list(dir: string): AsyncIterable<WorkspaceEntry> {
    const abs = dir === "" ? rootResolved : emitted.has(dir) ? resolve(rootResolved, dir) : await confined(dir);
    for (const entry of await readdir(abs, { withFileTypes: true })) {
      const path = dir === "" ? entry.name : `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        emitted.add(path);
        yield { path, kind: "dir" };
      } else if (entry.isFile()) {
        yield { path, kind: "file" };
      }
    }
  }

  async function read(p: string, { maxBytes }: { maxBytes: number }): Promise<WorkspaceRead> {
    const abs = await fileAbs(p);
    try {
      const info = await stat(abs);
      if (info.isDirectory()) return { status: "is_directory" };
      if (info.size <= maxBytes) return { status: "ok", content: await readFile(abs, "utf-8"), truncated: false };
      // Oversized: a bounded prefix marked truncated; the read tool pages from there.
      const handle = await open(abs, "r");
      try {
        const buf = Buffer.alloc(maxBytes);
        const { bytesRead } = await handle.read(buf, 0, maxBytes, 0);
        return { status: "ok", content: buf.subarray(0, bytesRead).toString("utf-8"), truncated: true };
      } finally {
        await handle.close();
      }
    } catch (e) {
      if (isMissing(e)) return { status: "not_found" };
      if ((e as NodeJS.ErrnoException | undefined)?.code === "EISDIR") return { status: "is_directory" };
      throw e;
    }
  }

  async function search(query: string, scope: string, o: { signal?: AbortSignal }): Promise<SearchFound> {
    const start = scope ? await confined(scope) : rootResolved;
    const rg = typeof options.ripgrep === "function" ? await options.ripgrep().catch(() => null) : (options.ripgrep ?? null);
    // The run's Stop and this one search's own stop both end the search.
    const stops = [options.signal, o.signal].filter((s): s is AbortSignal => !!s);
    const signal = stops.length > 1 ? AbortSignal.any(stops) : stops[0];
    const r = await searchWorkspace({ root: rootResolved, start, query, ripgrep: rg, ...(signal ? { signal } : {}) });
    if (!r.ok) throw new WorkspaceError(r.code ?? (/not found/.test(r.error ?? "") ? "not_found" : "io"), r.error ?? "search failed");
    return { matches: (r.matches ?? []) as SearchMatch[], truncated: r.truncated === true };
  }

  return {
    list: (dir) => list(dir),
    read,
    async write(p, content) {
      const abs = await fileAbs(p);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content, "utf-8");
    },
    async remove(p) {
      const abs = await fileAbs(p);
      try {
        await rm(abs);
        return "deleted";
      } catch (e) {
        if (isMissing(e)) return "missing";
        throw e;
      }
    },
    search,
  };
}
