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
import { toPosixPath } from "./glob.js";
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
  /**
   * An optional resolver for ABSOLUTE paths (a drive letter or a leading "/"): the root-relative
   * POSIX path, "" for the root itself, or undefined when the path is outside the root.
   * Without a resolver, absolute paths are refused. Receives the already-normalised path.
   *
   * Remote adapters: `list` of a prefix that does not exist may yield nothing rather than throw;
   * the provider reports that as an empty listing, not as `not_found`.
   */
  toRelative?(p: string): string | undefined;
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
  /**
   * Bytes pulled to EDIT a file. Default unlimited (a local host edits any file it can read whole); a
   * remote adapter that caps a read still answers `truncated`, and that is refused as `too_large`.
   */
  maxEditBytes?: number;
  /**
   * Called with the path after a write, edit or delete lands (a host's `markDirty`, bookkeeping).
   * `written.content` is the exact text stored by a write or edit (after line-ending conforming), absent for a delete.
   */
  onWrite?(path: string, written?: { content: string }): void;
  /** Skip the root-containment pre-check (the on-prem `unconfined` scope: absolute paths and `..` are the adapter's call). */
  unconfined?: boolean;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The code an adapter error names, else `io`. */
function codeOf(e: unknown): WorkspaceErrorCode {
  const code = (e as { code?: unknown } | null)?.code;
  return code === "not_found" || code === "is_directory" || code === "outside_root" || code === "too_large" || code === "no_match" || code === "ambiguous" || code === "unsupported" || code === "invalid" ? code : "io";
}

/** True for a path that is absolute or climbs out of the root. */
function escapesRoot(p: string): boolean {
  const posix = toPosixPath(p);
  if (isAbsolutePath(posix)) return true;
  let depth = 0;
  for (const seg of posix.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") { if (--depth < 0) return true; } else depth++;
  }
  return false;
}

/** A leading "/" or a drive letter. */
const isAbsolutePath = (posix: string): boolean => posix.startsWith("/") || /^[A-Za-z]:/.test(posix);

/** Trim, POSIX separators, no leading "./": the ONE normalisation every path takes before anything looks at it. */
const normalisePath = (raw: string): string => toPosixPath(raw).trim().replace(/^(?:\.\/+)+/, "");

type Resolved = { path: string } | { bad: { ok: false; error: string; code: "outside_root" } };

/** Build the shared read and write capabilities over `fs`. */
export function createRepoCapabilities(fs: WorkspaceFs, opts: RepoCapabilityOptions = {}): { repoRead: RepoReadCapability; repoWrite: RepoWriteCapability } {
  const dirFilter = opts.dirFilter ?? isListedDirName;
  const maxRead = opts.maxReadBytes ?? READ_MAX_BYTES;
  const maxEdit = opts.maxEditBytes ?? Number.MAX_SAFE_INTEGER;
  const wrote = (p: string, content?: string): void => { opts.onWrite?.(p, content === undefined ? undefined : { content }); };

  /**
   * The path the adapter sees (root-relative POSIX, no leading "./"), or the refusal. The path is
   * normalised ONCE; the containment check runs on exactly the string handed to the adapter.
   * Absolute paths are only accepted if the adapter maps them inside its root.
   * `unconfined` skips containment.
   */
  const resolvePath = (raw: string | undefined, asDir = false): Resolved => {
    let p = normalisePath(raw ?? "");
    const refuse = (): Resolved => ({ bad: { ok: false, error: `'${raw ?? ""}' is outside the workspace`, code: "outside_root" } });
    if (!opts.unconfined) {
      if (isAbsolutePath(p)) {
        const inside = fs.toRelative?.(p);
        if (inside === undefined) return refuse();
        p = normalisePath(inside);
      }
      if (escapesRoot(p)) return refuse();
    }
    if (asDir) { p = p.replace(/\/+$/, ""); if (p === ".") p = ""; }
    return { path: p };
  };

  const repoRead: RepoReadCapability = {
    async listFiles(subdir?: string, glob?: string, listOpts?: RepoListOptions): Promise<RepoListResult> {
      const r = resolvePath(subdir, true);
      if ("bad" in r) return r.bad;
      const start = r.path;
      try {
        // A glob is an explicit "find these files": the full matches, never the directory summary.
        const found = await walkWorkspace(fs, { start, ...(glob ? { glob, scope: start } : {}), unbounded: listOpts?.unbounded === true, dirFilter });
        return listingResult(found, glob, start || undefined, listOpts?.unbounded === true);
      } catch (e) {
        return { ok: false, error: messageOf(e), code: codeOf(e) };
      }
    },

    async readFile(p: string): Promise<RepoReadResult> {
      const r0 = resolvePath(p);
      if ("bad" in r0) return r0.bad;
      try {
        const r = await fs.read(r0.path, { maxBytes: maxRead });
        if (r.status === "not_found") return { ok: false, path: p, error: "file not found", code: "not_found" };
        if (r.status === "is_directory") return { ok: false, path: p, error: "path is a directory, not a file — use list_files to see its contents", code: "is_directory" };
        // Oversized: a bounded prefix marked truncated, never a hard failure; read_file pages from there.
        return r.truncated ? { ok: true, path: p, content: r.content, truncated: true } : { ok: true, path: p, content: r.content };
      } catch (e) {
        return { ok: false, path: p, error: messageOf(e), code: codeOf(e) };
      }
    },

    async searchCode(query: string, scope?: string, searchOpts?: { signal?: AbortSignal }): Promise<RepoSearchResult> {
      if (!query || !query.trim()) return { ok: false, query, error: "query is required", code: "invalid" };
      const r0 = resolvePath(scope, true);
      if ("bad" in r0) return { ...r0.bad, query };
      const dir = r0.path;
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
      const r0 = resolvePath(p);
      if ("bad" in r0) return r0.bad;
      if (isGzipPath(r0.path)) return GZ_UNSUPPORTED;
      // The read probe only learns the file's line endings and whether it is new. ONLY a definite
      // `not_found` means "new file"; a probe that fails or cannot answer (io, a capped read, a
      // directory-looking submodule or link) never fails the write: the content is written as given.
      let prior: string | null = null;
      let isNew = false;
      let probedDirectory = false;
      try {
        const existing = await fs.read(r0.path, { maxBytes: maxRead });
        if (existing.status === "not_found") isNew = true;
        else if (existing.status === "is_directory") probedDirectory = true;
        else if (!existing.truncated) prior = existing.content;
      } catch { /* unknown: write as given */ }
      try {
        // A rewrite keeps a known file's line endings: an LF body over a CRLF file would flip or mix every line.
        const stored = conformToExistingEol(prior, content);
        await fs.write(r0.path, stored);
        wrote(p, stored);
        return { ok: true, change: isNew ? "created" : "modified" };
      } catch (e) {
        if (probedDirectory) return { ok: false, error: "path is a directory, not a file", code: "is_directory" };
        return { ok: false, error: messageOf(e), code: codeOf(e) };
      }
    },

    async deleteFile(p: string): Promise<RepoDeleteResult> {
      const r0 = resolvePath(p);
      if ("bad" in r0) return { ...r0.bad, deleted: false };
      try {
        if ((await fs.remove(r0.path)) === "missing") return { ok: true, deleted: false, note: `'${p}' does not exist, so there is nothing to delete.` };
        wrote(p);
        return { ok: true, deleted: true };
      } catch (e) {
        return { ok: false, deleted: false, error: messageOf(e), code: codeOf(e) };
      }
    },

    async editFile(p: string, oldString: string, newString: string, replaceAll?: boolean): Promise<RepoEditResult> {
      const r0 = resolvePath(p);
      if ("bad" in r0) return r0.bad;
      try {
        const cur = await fs.read(r0.path, { maxBytes: maxEdit });
        if (cur.status === "not_found") return { ok: false, error: "file not found", code: "not_found" };
        if (cur.status === "is_directory") return { ok: false, error: "path is a directory, not a file", code: "is_directory" };
        // Writing back a byte-capped prefix would silently destroy the rest of the file.
        if (cur.truncated) return { ok: false, error: "file is too large to edit in place", code: "too_large" };
        // EOL-tolerant, EOL-preserving match (shared with the cloud provider).
        const edit = applyStringEdit(cur.content, oldString, newString, replaceAll);
        if (!edit.ok || edit.content == null) {
          const error = edit.error ?? "oldString not found in file";
          return edit.matchCount === undefined
            ? { ok: false, ...editFacts(edit), error, code: "no_match" }
            : { ok: false, error, code: "ambiguous", matchCount: edit.matchCount };
        }
        await fs.write(r0.path, edit.content);
        wrote(p, edit.content);
        return { ok: true, change: "modified", ...editFacts(edit) };
      } catch (e) {
        return { ok: false, error: messageOf(e), code: codeOf(e) };
      }
    },
  };

  return { repoRead, repoWrite };
}
