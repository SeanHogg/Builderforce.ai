/**
 * `@builderforce/agent-tools/node-workspace` - the ONE local-disk {@link WorkspaceFs}: what the VS
 * Code extension, the on-prem agent runtime and the workspace MCP hand to `createRepoCapabilities`
 * so list/read/search/write/edit/delete are written once. Node-only (its own export condition; the
 * package root stays node-builtin-free for the Worker).
 *
 * Containment is the shared `node-path` resolvers, exactly as the hosts applied them before:
 * `workspace` scope resolves real paths (a link out of the root is refused), `unconfined` resolves
 * a path against the root only (absolute and `..` paths are the caller's call). List and search are
 * ALWAYS confined to the root, whatever the scope, and EVERY `list(dir)` is real-path checked (no
 * cache of directories already seen: a directory swapped for a link is caught). An escape throws
 * `WorkspaceError("outside_root", "'<path>' is outside the workspace")`.
 *
 * No host absolute path reaches the model: a missing directory or file is `not_found` naming only
 * the root-relative path, and any other filesystem error has the root prefix stripped.
 *
 * Search ({@link searchWorkspace}) uses ripgrep or the neutral scan. The search reader decodes
 * gzip separately from ordinary file operations, which preserve the bytes for `read_file`.
 */

import { mkdir, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { RepoSearchResult } from "./capabilities.js";
import { isGzipPath, latin1Bytes, readGzipText } from "./gzipText.js";
import { resolveInsideRoot, toPosixRel, tryResolveInsideRootReal } from "./node-path.js";
import { SEARCH_STOPPED, isGeneratedSearchPath, ripgrepSearch, type RgSemaphore } from "./node-text-search.js";
import { scanFiles, type SearchMatch } from "./text-scan.js";
import { WorkspaceError, type SearchFound, type WorkspaceEntry, type WorkspaceFs, type WorkspaceRead } from "./workspace.js";

export interface NodeWorkspaceOptions {
  /** `workspace` (default): every path must resolve inside the root, links included. `unconfined`: file ops may reach outside it. */
  scope?: "workspace" | "unconfined";
  /** The ripgrep binary, a lazy resolver for it (probed per search), or null/absent to scan in-process. */
  ripgrep?: string | null | (() => Promise<string | null>);
  /** The run's Stop: kills a running ripgrep and ends the fallback scan. */
  signal?: AbortSignal;
}

const isMissing = (e: unknown): boolean => {
  const code = (e as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
};

export interface WorkspaceSearchOptions {
  /** Absolute, resolved workspace root; every returned path is relative to it. */
  root: string;
  /** Absolute path to search - a directory OR a single file - inside `root`. */
  start: string;
  query: string;
  /** The ripgrep binary to run, or null to scan the tree in-process. */
  ripgrep: string | null;
  /** The run's Stop: kills ripgrep and ends the scan. */
  signal?: AbortSignal;
  /** The run's ripgrep concurrency gate (`rgGateFor`); absent = the shared default gate. */
  gate?: RgSemaphore;
}

/**
 * Search `start` for `query`. A file target is scanned directly; a directory goes to ripgrep when one
 * is available and to the neutral scan otherwise (or when ripgrep cannot run the pattern). Every
 * result says which backend produced it and how long it took (`backend`/`ms`), so a slow search is
 * visible in the trace.
 */
export async function searchWorkspace(opts: WorkspaceSearchOptions): Promise<RepoSearchResult> {
  const { root, start, query } = opts;
  const t0 = Date.now();
  const stamp = (r: RepoSearchResult, backend: "rg" | "walk"): RepoSearchResult => Object.assign(r, { backend, ms: Date.now() - t0 });
  if (!query || !query.trim()) return stamp({ ok: false, query, error: "query is required", code: "invalid" }, "walk");
  const info = await stat(start).catch(() => null);
  const scope = toPosixRel(root, start);
  if (!info) return stamp({ ok: false, query, error: `path not found: ${scope || "."}` }, "walk");
  const run = { ...(opts.signal ? { signal: opts.signal } : {}), ...(opts.gate ? { gate: opts.gate } : {}) };
  if (opts.ripgrep && !info.isFile()) {
    const r = await ripgrepSearch(root, start, query, opts.ripgrep, run);
    if (r) return stamp(r, "rg");
  }
  // A file scope searches that file (the old directory walk threw on it and reported "not referenced").
  const fs = nodeWorkspaceFs(resolve(root));
  const scanned = await scanFiles({
    ...fs,
    async read(path, readOptions) {
      const result = await fs.read(path, readOptions);
      if (!isGzipPath(path) || result.status !== "ok" || result.truncated) return result;
      try {
        const content = await readGzipText(latin1Bytes(result.content));
        return { status: "ok", content, truncated: Buffer.byteLength(content) > readOptions.maxBytes };
      } catch {
        return { status: "ok", content: "", truncated: false };
      }
    },
  }, query, scope, { ...(opts.signal ? { signal: opts.signal } : {}), skipFile: isGeneratedSearchPath });
  return stamp(scanned.error === "search stopped" ? { ...scanned, error: SEARCH_STOPPED } : scanned, "walk");
}

/** The local-disk workspace rooted at `root`. */
export function nodeWorkspaceFs(root: string, options: NodeWorkspaceOptions = {}): WorkspaceFs {
  const rootResolved = resolve(root);
  const rootPosix = rootResolved.split("\\").join("/");
  const unconfined = options.scope === "unconfined";

  /** A message with the host's root path taken out: the model sees root-relative paths only. */
  const scrub = (message: string): string => message.split(rootResolved).join(".").split(rootPosix).join(".");

  /** The error a filesystem failure becomes: `not_found` for a missing path, else `io` with no host path. */
  const failure = (e: unknown, rel: string): WorkspaceError => {
    if (e instanceof WorkspaceError) return e;
    if (isMissing(e)) return new WorkspaceError("not_found", `'${rel || "."}' was not found`);
    return new WorkspaceError("io", scrub(e instanceof Error ? e.message : String(e)));
  };

  const confined = async (p: string): Promise<string> => {
    const r = await tryResolveInsideRootReal(rootResolved, p);
    if (r.ok) return r.abs;
    if (r.reason === "escapes") throw new WorkspaceError("outside_root", r.error);
    throw isMissing(r.cause) ? new WorkspaceError("not_found", `'${p || "."}' was not found`) : new WorkspaceError("io", r.error);
  };
  const fileAbs = (p: string): Promise<string> => (unconfined ? Promise.resolve(resolve(rootResolved, p)) : confined(p));

  async function* list(dir: string): AsyncIterable<WorkspaceEntry> {
    const abs = dir === "" ? rootResolved : await confined(dir);
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch (e) {
      throw failure(e, dir);
    }
    for (const entry of entries) {
      const path = dir === "" ? entry.name : `${dir}/${entry.name}`;
      if (entry.isDirectory()) yield { path, kind: "dir" };
      else if (entry.isFile()) yield { path, kind: "file" };
    }
  }

  async function read(p: string, { maxBytes }: { maxBytes: number }): Promise<WorkspaceRead> {
    const abs = await fileAbs(p);
    try {
      const info = await stat(abs);
      if (info.isDirectory()) return { status: "is_directory" };
      const encoding = isGzipPath(p) ? "latin1" : "utf8";
      if (info.size <= maxBytes) {
        const content = await readFile(abs, encoding);
        return { status: "ok", content, truncated: false };
      }
      // Oversized: a bounded prefix marked truncated; the read tool pages from there.
      const handle = await open(abs, "r");
      try {
        const buf = Buffer.alloc(maxBytes);
        const { bytesRead } = await handle.read(buf, 0, maxBytes, 0);
        return { status: "ok", content: buf.subarray(0, bytesRead).toString(encoding), truncated: true };
      } finally {
        await handle.close();
      }
    } catch (e) {
      if (isMissing(e)) return { status: "not_found" };
      if ((e as NodeJS.ErrnoException | undefined)?.code === "EISDIR") return { status: "is_directory" };
      throw failure(e, p);
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
      try {
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, content, "utf-8");
      } catch (e) {
        throw failure(e, p);
      }
    },
    async remove(p) {
      const abs = await fileAbs(p);
      try {
        await rm(abs);
        return "deleted";
      } catch (e) {
        if (isMissing(e)) return "missing";
        throw failure(e, p);
      }
    },
    search,
    toRelative(p) {
      const abs = resolveInsideRoot(rootResolved, p);
      if (abs === null) return unconfined ? p : undefined;
      return toPosixRel(rootResolved, abs);
    },
  };
}
