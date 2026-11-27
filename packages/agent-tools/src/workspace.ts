/**
 * workspace.ts - the ONE coding provider every host adopts: `createRepoCapabilities(fs)` builds the
 * `repoRead` / `repoWrite` pair (`list_files`, `read_file`, `search_code`, `write_file`,
 * `edit_file`, `delete_file`) over a {@link WorkspaceFs}, the only thing a host writes. Extracted
 * from the VS Code provider (`localCapabilities.ts`), the most complete copy, so the editor, the
 * on-prem agent, the cloud and the browser canvas answer the same call the same way.
 *
 * Runtime-neutral: no node builtins (the Worker imports the package). Host side effects (commits,
 * leases, symbol `markDirty`, history) are NOT here; a host decorates the returned capabilities,
 * or passes `onWrite`.
 *
 * Every failure carries `code` (see {@link WorkspaceErrorCode}). Deleting a missing file is
 * `{ ok: true, deleted: false }` everywhere.
 */

import { READ_MAX_BYTES, SEARCH_MAX_MATCHES } from "@builderforce/tool-output-policy";
import type {
  RepoDeleteResult,
  RepoEditResult,
  RepoListOptions,
  RepoListResult,
  RepoReadCapability,
  RepoReadResult,
  RepoSearchResult,
  RepoWriteCapability,
  RepoWriteResult,
  WorkspaceErrorCode,
} from "./capabilities.js";
import { applyStringEdit, conformToExistingEol, editFacts } from "./edit.js";
import { normalizeScopeDir, toPosixPath } from "./glob.js";
import { isListedDirName } from "./skipDirs.js";
import { orderMatches, scanFiles, type SearchMatch } from "./text-scan.js";
import { listingResult, walkWorkspace } from "./workspaceList.js";

export type { WorkspaceErrorCode } from "./capabilities.js";
export type { SearchMatch } from "./text-scan.js";

/** One directory entry. `path` is root-relative POSIX. */
export interface WorkspaceEntry {
  path: string;
  kind: "file" | "dir";
  size?: number;
}

/** What a read found: nothing, a directory, or the (possibly byte-capped) text. */
export type WorkspaceRead =
  | { status: "not_found" }
  | { status: "is_directory" }
  | { status: "ok"; content: string; truncated: boolean };

/** A native searcher that knows it stopped early (a timeout, its own cap) says so; a bare array is "complete". */
export interface SearchFound {
  matches: SearchMatch[];
  truncated: boolean;
}

/** The only thing a host writes. Paths are root-relative POSIX; "" is the root. */
export interface WorkspaceFs {
  /** The immediate children of `dir` (one level; the provider walks). A missing or unreadable `dir` throws. */
  list(dir: string, opts: { signal?: AbortSignal }): AsyncIterable<WorkspaceEntry>;
  /** Read at most `maxBytes`; `truncated` says more remains. */
  read(path: string, opts: { maxBytes: number }): Promise<WorkspaceRead>;
  /** Write `content`, creating parents. */
  write(path: string, content: string): Promise<void>;
  remove(path: string): Promise<"deleted" | "missing">;
  /** An optional native searcher (ripgrep, a provider's code search). Absent: the neutral scanner walks `list`/`read`. */
  search?(query: string, scope: string, opts: { signal?: AbortSignal }): Promise<SearchMatch[] | SearchFound>;
}

/** An adapter throws this to name WHY an operation failed (containment, a too-large file, ...). */
export class WorkspaceError extends Error {
  constructor(readonly code: WorkspaceErrorCode, message: string) {
    super(message);
    this.name = "WorkspaceError";
  }
}

export interface RepoCapabilityOptions {
  /** Which directory NAMES a listing enters. Default `isListedDirName` (skip policy + the config dot-dirs). */
  dirFilter?: (name: string) => boolean;
  /** Bytes pulled per read. Default `READ_MAX_BYTES` (2 MiB); the workspace MCP passes 1 MB. */
  maxReadBytes?: number;
  /** Called with the path after a write, edit or delete lands (a host's `markDirty`, bookkeeping). */
  onWrite?(path: string): void;
  /** Skip the root-containment pre-check (the on-prem `unconfined` scope: absolute paths and `..` are the adapter's call). */
  unconfined?: boolean;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The code an adapter error names, else `io`. */
function codeOf(e: unknown): WorkspaceErrorCode {
  const code = (e as { code?: unknown } | null)?.code;
  return code === "not_found" || code === "is_directory" || code === "outside_root" || code === "too_large" || code === "no_match" || code === "ambiguous" || code === "unsupported" ? code : "io";
}

/** True for an absolute path or one that climbs out of the root after normalising. */
function escapesRoot(p: string): boolean {
  const posix = toPosixPath(p);
  if (posix.startsWith("/") || /^[A-Za-z]:/.test(posix)) return true;
  let depth = 0;
  for (const seg of posix.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") { if (--depth < 0) return true; } else depth++;
  }
  return false;
}

/** Build the shared read and write capabilities over `fs`. */
export function createRepoCapabilities(fs: WorkspaceFs, opts: RepoCapabilityOptions = {}): { repoRead: RepoReadCapability; repoWrite: RepoWriteCapability } {
  const dirFilter = opts.dirFilter ?? isListedDirName;
  const maxRead = opts.maxReadBytes ?? READ_MAX_BYTES;
  const outside = (p: string): { ok: false; error: string; code: "outside_root" } | null =>
    !opts.unconfined && escapesRoot(p) ? { ok: false, error: `'${p}' is outside the workspace`, code: "outside_root" } : null;
  const wrote = (p: string): void => { opts.onWrite?.(p); };
  // Paths the adapter sees are POSIX with no leading "./".
  const rel = (p: string): string => (opts.unconfined ? p : normalizeScopeDir(p));

  const repoRead: RepoReadCapability = {
    async listFiles(subdir?: string, glob?: string, listOpts?: RepoListOptions): Promise<RepoListResult> {
      if (subdir) { const bad = outside(subdir); if (bad) return bad; }
      const start = normalizeScopeDir(subdir);
      try {
        // A glob is an explicit "find these files": the full matches, never the directory summary.
        const found = await walkWorkspace(fs, { start, ...(glob ? { glob, scope: subdir ?? "" } : {}), unbounded: listOpts?.unbounded === true, dirFilter });
        return listingResult(found, glob, subdir ? start : undefined, listOpts?.unbounded === true);
      } catch (e) {
        return { ok: false, error: messageOf(e), code: codeOf(e) };
      }
    },

    async readFile(p: string): Promise<RepoReadResult> {
      const bad = outside(p); if (bad) return bad;
      try {
        const r = await fs.read(rel(p), { maxBytes: maxRead });
        if (r.status === "not_found") return { ok: false, path: p, error: "file not found", code: "not_found" };
        if (r.status === "is_directory") return { ok: false, path: p, error: "path is a directory, not a file — use list_files to see its contents", code: "is_directory" };
        // Oversized: a bounded prefix marked truncated, never a hard failure; read_file pages from there.
        return r.truncated ? { ok: true, path: p, content: r.content, truncated: true } : { ok: true, path: p, content: r.content };
      } catch (e) {
        return { ok: false, path: p, error: messageOf(e), code: codeOf(e) };
      }
    },

    async searchCode(query: string, scope?: string, searchOpts?: { signal?: AbortSignal }): Promise<RepoSearchResult> {
      if (scope) { const bad = outside(scope); if (bad) return { ...bad, query }; }
      const dir = normalizeScopeDir(scope);
      const run = searchOpts?.signal ? { signal: searchOpts.signal } : {};
      try {
        if (!fs.search) return await scanFiles(fs, query, dir, run);
        const found = await fs.search(query, dir, run);
        const all = Array.isArray(found) ? found : found.matches;
        const matches = orderMatches(all).slice(0, SEARCH_MAX_MATCHES);
        return { ok: true, query, total: matches.length, truncated: (!Array.isArray(found) && found.truncated) || all.length > SEARCH_MAX_MATCHES, matches };
      } catch (e) {
        return { ok: false, query, error: messageOf(e), code: codeOf(e) };
      }
    },
  };

  const repoWrite: RepoWriteCapability = {
    async writeFile(p: string, content: string): Promise<RepoWriteResult> {
      const bad = outside(p); if (bad) return bad;
      try {
        const existing = await fs.read(rel(p), { maxBytes: maxRead });
        if (existing.status === "is_directory") return { ok: false, error: "path is a directory, not a file", code: "is_directory" };
        const prior = existing.status === "ok" ? existing.content : null;
        // A rewrite keeps the file's line endings: an LF body over a CRLF file would flip or mix every line.
        await fs.write(rel(p), conformToExistingEol(prior, content));
        wrote(p);
        return { ok: true, change: prior !== null ? "modified" : "created" };
      } catch (e) {
        return { ok: false, error: messageOf(e), code: codeOf(e) };
      }
    },

    async deleteFile(p: string): Promise<RepoDeleteResult> {
      const bad = outside(p); if (bad) return bad;
      try {
        if ((await fs.remove(rel(p))) === "missing") return { ok: true, deleted: false, note: `'${p}' does not exist, so there is nothing to delete.` };
        wrote(p);
        return { ok: true, deleted: true };
      } catch (e) {
        return { ok: false, deleted: false, error: messageOf(e), code: codeOf(e) };
      }
    },

    async editFile(p: string, oldString: string, newString: string, replaceAll?: boolean): Promise<RepoEditResult> {
      const bad = outside(p); if (bad) return bad;
      try {
        const cur = await fs.read(rel(p), { maxBytes: maxRead });
        if (cur.status === "not_found") return { ok: false, error: "file not found", code: "not_found" };
        if (cur.status === "is_directory") return { ok: false, error: "path is a directory, not a file", code: "is_directory" };
        // Writing back a byte-capped prefix would silently destroy the rest of the file.
        if (cur.truncated) return { ok: false, error: "file is too large to edit in place", code: "too_large" };
        // EOL-tolerant, EOL-preserving match (shared with the cloud provider).
        const edit = applyStringEdit(cur.content, oldString, newString, replaceAll);
        if (!edit.ok || edit.content == null) {
          const error = edit.error ?? "oldString not found in file";
          return { ok: false, ...editFacts(edit), error, code: /not unique/i.test(error) ? "ambiguous" : "no_match" };
        }
        await fs.write(rel(p), edit.content);
        wrote(p);
        return { ok: true, change: "modified", ...editFacts(edit) };
      } catch (e) {
        return { ok: false, error: messageOf(e), code: codeOf(e) };
      }
    },
  };

  return { repoRead, repoWrite };
}
