/**
 * workspaceList.ts - the `list_files` walk over a {@link WorkspaceFs}, ported from the VS Code
 * provider (`localCapabilities.walkFiles` + `summarizeDirs`), the most complete copy: breadth-first
 * (shallow files are collected before the budget is spent deep in one subtree), the glob applied
 * DURING the walk (so the budget counts matches, not candidates), directories the glob cannot
 * reach pruned, and a big unscoped listing collapsed to a directory summary. Pure.
 */

import { LIST_MAX_FILES, LIST_RETURN_MAX } from "@builderforce/tool-output-policy";
import type { RepoListResult } from "./capabilities.js";
import { dirMayContainGlobMatch, matchGlobInScope } from "./glob.js";
import type { WorkspaceFs } from "./workspace.js";

export interface WalkOptions {
  /** The directory (root-relative POSIX, "" = root) the walk starts in. */
  start: string;
  glob?: string;
  /** The scope the glob resolves against (the raw `subdir` argument). */
  scope?: string;
  unbounded?: boolean;
  dirFilter: (name: string) => boolean;
}

/** Collect root-relative file paths from `start`, bounded and sorted. */
export async function walkWorkspace(fs: WorkspaceFs, o: WalkOptions): Promise<{ paths: string[]; truncated: boolean }> {
  const cap = o.unbounded ? Number.POSITIVE_INFINITY : LIST_MAX_FILES;
  const out: string[] = [];
  const queue: string[] = [o.start];
  let truncated = false;
  let first = true;
  while (queue.length > 0) {
    if (out.length >= cap) { truncated = true; break; }
    const dir = queue.shift() ?? "";
    const entries: Array<{ path: string; kind: "file" | "dir" }> = [];
    try {
      for await (const e of fs.list(dir, {})) entries.push(e);
    } catch (e) {
      // The directory the caller NAMED failing is the caller's answer; a nested one is skipped.
      if (first) throw e;
      continue;
    }
    first = false;
    for (const entry of entries) {
      if (entry.kind === "dir") {
        const name = entry.path.split("/").pop() ?? entry.path;
        if (!o.dirFilter(name)) continue;
        // Prune directories the glob cannot reach so the match budget is not spent on unrelated trees.
        if (o.glob && !dirMayContainGlobMatch(entry.path, o.glob, o.scope)) continue;
        queue.push(entry.path);
      } else {
        if (o.glob && !matchGlobInScope(entry.path, o.glob, o.scope)) continue;
        if (out.length >= cap) { truncated = true; break; }
        out.push(entry.path);
      }
    }
  }
  return { paths: out.sort((a, b) => a.localeCompare(b)), truncated };
}

/**
 * Collapse a large listing to the deduped directory prefixes just below the listed folder
 * (trailing "/"), so an over-broad `list_files` returns a scoping map instead of thousands of
 * paths. Files directly at the listed folder are kept (a root doc stays discoverable).
 */
export function summarizeDirs(paths: string[], subdir?: string): string[] {
  const baseDepth = subdir ? subdir.split("/").filter(Boolean).length : 0;
  const depth = baseDepth + 2; // up to two levels below the listed folder
  const dirs = new Set<string>();
  for (const p of paths) {
    const segs = p.split("/");
    if (segs.length <= 1) { dirs.add(p); continue; }
    const cut = Math.min(depth, segs.length - 1);
    dirs.add(`${segs.slice(0, cut).join("/")}/`);
  }
  return [...dirs].sort().slice(0, LIST_RETURN_MAX);
}

/** The `list_files` result for a finished walk: a glob returns every match, a big plain listing the summary. */
export function listingResult(found: { paths: string[]; truncated: boolean }, glob: string | undefined, subdir: string | undefined, unbounded: boolean): RepoListResult {
  if (glob || unbounded || found.paths.length <= LIST_RETURN_MAX) return { ok: true, paths: found.paths, truncated: found.truncated };
  return { ok: true, paths: summarizeDirs(found.paths, subdir), truncated: true };
}
