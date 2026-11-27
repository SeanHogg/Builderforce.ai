/**
 * text-scan.ts - the ONE runtime-neutral line scanner behind `search_code` for every host that
 * has no ripgrep: a breadth-first walk over a {@link WorkspaceFs}, smart case, regex with a
 * literal fallback, binary skip, per-file byte cap, bounded files and matches. Extracted from
 * `node-text-search.ts` `walkSearch` so the cloud, the browser canvas and the tests scan the
 * same way the editor does. Pure: no node builtins (the Worker imports it).
 *
 * `node-text-search.ts` carries its own copies of `isValidRegex` / `compileSearchPattern` /
 * `smartCaseSensitive` because it imports `node:*`; it should import them from here.
 */

import type { RepoSearchResult } from "./capabilities.js";
import { SEARCH_MAX_MATCHES } from "@builderforce/tool-output-policy";
import { isIndexedDirName } from "./skipDirs.js";
import type { WorkspaceFs } from "./workspace.js";

/** Files a scan reads before it stops and reports `truncated` (never "absent"). */
export const SCAN_MAX_FILES = 4_000;
/** Largest file a scan reads; a bigger one is skipped, like the node searcher. */
export const SCAN_MAX_FILE_BYTES = 2 * 1024 * 1024;
/** Characters of a matching line kept - enough to read, not enough to flood the window. */
export const MATCH_TEXT_MAX = 200;

/** One hit. Remote code search has no exact line, so `line` is optional (a documented weaker contract). */
export interface SearchMatch {
  path: string;
  line?: number;
  text: string;
  /** The shared `RepoSearchResult.matches` element is an open record; stay assignable to it. */
  [extra: string]: unknown;
}

/** True when `query` is a valid JS regular expression. */
export function isValidRegex(query: string): boolean {
  try {
    new RegExp(query, "i");
    return true;
  } catch {
    return false;
  }
}

/**
 * The pattern `search_code` scans with: the query as a regex when it is one, else the same text
 * escaped and matched literally (a model searching `foo(bar` must not get "invalid regex").
 * Case-insensitive unless `caseSensitive`.
 */
export function compileSearchPattern(query: string, caseSensitive = false): RegExp {
  const flags = caseSensitive ? "" : "i";
  return isValidRegex(query) ? new RegExp(query, flags) : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
}

/** Smart case, ripgrep's rule: an upper-case letter makes the query case-SENSITIVE. A regex escape (`\W`) is syntax, not a letter. */
export function smartCaseSensitive(query: string): boolean {
  return /[A-Z]/.test(query.replace(/\\./g, ""));
}

/** Sort by path then line so a result set reads like a file, whichever backend produced it. */
export function orderMatches<T extends { path: string; line?: number }>(matches: readonly T[]): T[] {
  return [...matches].sort((a, b) => a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0));
}

export interface ScanOptions {
  signal?: AbortSignal;
  /** Which directory names the walk enters. Default: `isIndexedDirName` (the search policy). */
  dirFilter?: (name: string) => boolean;
  /** Override {@link SCAN_MAX_FILES}. */
  maxFiles?: number;
  /** Override {@link SCAN_MAX_FILE_BYTES}. */
  maxFileBytes?: number;
  /** Override {@link SEARCH_MAX_MATCHES} (a host with its own panel cap). */
  maxMatches?: number;
  /** True skips a file before it is read or counted against `maxFiles` (a host's binary-extension rule). */
  skipFile?: (path: string, size: number | undefined) => boolean;
  /** Replaces the built-in per-line matcher: given a line's full text, returns that line's hits (a panel wants columns and every occurrence). */
  lineMatcher?: (path: string, text: string, line: number) => SearchMatch[];
}

/** The matching lines of one file's text. */
function scanText(rel: string, content: string, re: RegExp, limit: number, lineMatcher?: ScanOptions["lineMatcher"]): SearchMatch[] {
  const out: SearchMatch[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i] ?? "";
    if (lineMatcher) {
      out.push(...lineMatcher(rel, lineText, i + 1));
      if (out.length >= limit) break;
    } else if (re.test(lineText)) {
      out.push({ path: rel, line: i + 1, text: lineText.trim().slice(0, MATCH_TEXT_MAX) });
      if (out.length >= limit) break;
    }
  }
  return out;
}

/**
 * Scan `scope` (a directory or one file; "" = the root) of `fs` for `query`. Breadth-first, so
 * shallow files across the whole tree are read before the file budget goes on one deep subtree.
 * A capped scan with no matches is reported `truncated`, never as "absent".
 */
export async function scanFiles(fs: WorkspaceFs, query: string, scope: string, opts: ScanOptions = {}): Promise<RepoSearchResult> {
  const re = compileSearchPattern(query, smartCaseSensitive(query));
  const dirFilter = opts.dirFilter ?? isIndexedDirName;
  const maxFiles = opts.maxFiles ?? SCAN_MAX_FILES;
  const maxBytes = opts.maxFileBytes ?? SCAN_MAX_FILE_BYTES;
  const maxMatches = opts.maxMatches ?? SEARCH_MAX_MATCHES;
  const matches: SearchMatch[] = [];
  let scanned = 0;
  let truncated = false;
  const stopped = (): RepoSearchResult => ({ ok: false, query, error: "search stopped", code: "io" });

  const scanOne = async (rel: string, size: number | undefined): Promise<void> => {
    if (size !== undefined && size > maxBytes) return;
    const r = await fs.read(rel, { maxBytes });
    // Unreadable, a directory, or over the byte cap: skipped, like the node searcher.
    if (r.status !== "ok" || r.truncated || !r.content || r.content.includes("\0")) return;
    for (const m of scanText(rel, r.content, re, maxMatches - matches.length, opts.lineMatcher)) matches.push(m);
  };

  if (scope) {
    const probe = await fs.read(scope, { maxBytes });
    if (probe.status === "not_found") return { ok: false, query, error: `path not found: ${scope}`, code: "not_found" };
    if (probe.status === "ok") {
      // A file scope searches that file (a file scope once reported "not referenced" for a file that declared the term).
      if (!probe.truncated && probe.content && !probe.content.includes("\0")) matches.push(...scanText(scope, probe.content, re, maxMatches, opts.lineMatcher));
      return { ok: true, query, total: matches.length, truncated: matches.length >= maxMatches, matches: orderMatches(matches) };
    }
  }

  const queue: string[] = [scope];
  outer: while (queue.length > 0) {
    if (opts.signal?.aborted) return stopped();
    if (matches.length >= maxMatches || scanned >= maxFiles) { truncated = true; break; }
    const dir = queue.shift() ?? "";
    const files: Array<{ path: string; size?: number }> = [];
    try {
      for await (const e of fs.list(dir, opts.signal ? { signal: opts.signal } : {})) {
        if (e.kind === "dir") {
          const name = e.path.split("/").pop() ?? e.path;
          if (dirFilter(name)) queue.push(e.path);
        } else files.push(e.size === undefined ? { path: e.path } : { path: e.path, size: e.size });
      }
    } catch {
      continue; // an unreadable directory is skipped; the walk goes on
    }
    for (const f of files) {
      if (opts.skipFile?.(f.path, f.size)) continue;
      if (matches.length >= maxMatches || scanned >= maxFiles) { truncated = true; break outer; }
      scanned++;
      await scanOne(f.path, f.size);
    }
  }
  if (matches.length >= maxMatches) truncated = true;
  return { ok: true, query, total: matches.length, truncated, matches: orderMatches(matches) };
}
