/**
 * `search_code` for the editor surface — the searcher behind the local capability
 * provider's `repoRead.searchCode`.
 *
 * ## The two false negatives this replaces
 *
 * Both were measured on chat #101 (26 turns, 44 tool calls, nothing changed):
 *
 *  1. **A scope that names a FILE returned "the term is not referenced there".** The
 *     walker `readdir`'d the path, which throws on a file, was swallowed, and the search
 *     reported zero matches with `truncated:false` — the wording the tool reserves for
 *     "definitely absent". `search_code("BfBrainChat", path: "…/bfApi.ts")` said the
 *     interface did not exist in the very file that declares it, four times over.
 *  2. **An unscoped search of a multi-checkout workspace returned `total:0,
 *     truncated:true`.** The walk read every file's bytes itself and gave up at 4,000
 *     files — on a monorepo of several checkouts that is a fraction of one package, so
 *     every repo-wide symbol search came back empty after 6–13 seconds, and the model
 *     retried it unscoped five times.
 *
 * ## What runs now
 *
 * A file scope searches that file. A directory scope (or none) is handed to ripgrep —
 * the binary VS Code itself ships (see `ripgrep.ts`) — which is ignore-aware, parallel,
 * and covers a hundred-thousand-file tree in well under a second, so the scan budget
 * that manufactured the false "not found" is simply not reached. The walker survives
 * only as the fallback for a machine with no ripgrep, or a pattern ripgrep's regex
 * engine rejects (lookaround, backreferences) — the JS engine then does the honest,
 * slower job.
 *
 * Every path returned is repo-relative, POSIX-separated, and the same shape whichever
 * backend produced it, so the model sees one contract.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { spawn } from "child_process";
import type { RepoSearchResult } from "@builderforce/agent-tools";

/** Directories no local walk or search descends into — build output and dependencies. */
export const SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules", ".git", "dist", "build", ".next", "out", "coverage", ".turbo", ".vercel", ".cache",
]);

/** Matches handed back per search. Past this the result says `truncated`. */
export const SEARCH_MAX_MATCHES = 100;
/** Files the FALLBACK walk reads before giving up (ripgrep has no such cap). */
const WALK_MAX_FILES = 4_000;
const SEARCH_MAX_FILE_BYTES = 2 * 1024 * 1024;
/** Wall-clock bound on a ripgrep run; what it has found by then is returned as truncated. */
const RIPGREP_TIMEOUT_MS = 20_000;
/** Characters of a matching line kept — enough to read, not enough to flood the window. */
const MATCH_TEXT_MAX = 200;

export interface SearchMatch {
  path: string;
  line: number;
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
 * The pattern `search_code` scans with: the query as a regex when it is one, else the
 * same text escaped and matched literally. A query that is not a valid regex is searched
 * LITERALLY rather than refused — the model reaches for this tool with text it just read
 * (`?task=`, `foo(bar`, `a[0]`), and "invalid regex: Nothing to repeat" once made it
 * retry the same words for a whole turn. Case-insensitive either way.
 */
export function compileSearchPattern(query: string): RegExp {
  return isValidRegex(query) ? new RegExp(query, "i") : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

/** A repo-relative POSIX path from an absolute one under `root`. */
function relPosix(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join("/");
}

/**
 * Parse one ripgrep output line (`path:line:text`, as `--line-number --no-heading
 * --with-filename` prints it) into a match with a normalised repo-relative path. Paths
 * arrive as ripgrep printed them — `./a/b.ts` on POSIX, `.\a\b.ts` on Windows, or
 * `sub/dir/x.ts` for a scoped target — and leave as `a/b.ts`. Null for a line that is
 * not a match (a blank, or a `--max-columns` omission notice). Exported for the test.
 */
export function parseRipgrepLine(line: string): SearchMatch | null {
  const m = /^(.+?):(\d+):(.*)$/.exec(line);
  if (!m) return null;
  const rel = m[1].split("\\").join("/").replace(/^(?:\.\/)+/, "");
  if (!rel) return null;
  return { path: rel, line: Number(m[2]), text: m[3].trim().slice(0, MATCH_TEXT_MAX) };
}

/** Sort by path then line so a result set reads like a file, whichever backend produced it. */
function ordered(matches: SearchMatch[]): SearchMatch[] {
  return [...matches].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
}

export interface WorkspaceSearchOptions {
  /** Absolute, resolved workspace root; every returned path is relative to it. */
  root: string;
  /** Absolute path to search — a directory OR a single file — inside `root`. */
  start: string;
  query: string;
  /** The ripgrep binary to run, or null to walk the tree in-process. */
  ripgrep: string | null;
}

/**
 * Search `start` for `query`. A file target is scanned directly; a directory goes to
 * ripgrep when one is available and to the in-process walk otherwise (or when ripgrep
 * cannot run the pattern).
 */
export async function searchWorkspace(opts: WorkspaceSearchOptions): Promise<RepoSearchResult> {
  const { root, start, query } = opts;
  const stat = await fs.stat(start).catch(() => null);
  if (!stat) return { ok: false, query, error: `path not found: ${relPosix(root, start) || "."}` };
  if (stat.isFile()) {
    // The file-scope case: search exactly that file. The walker's readdir threw here
    // and reported "not referenced" — the false negative that started this module.
    const matches = await searchOneFile(root, start, compileSearchPattern(query), stat.size);
    return { ok: true, query, total: matches.length, truncated: false, matches };
  }
  if (opts.ripgrep) {
    const r = await ripgrepSearch(root, start, query, opts.ripgrep);
    if (r) return r;
  }
  return walkSearch(root, start, query);
}

/** Scan one file's lines with the JS pattern, honouring the size and binary guards. */
async function searchOneFile(root: string, abs: string, re: RegExp, size: number): Promise<SearchMatch[]> {
  if (size > SEARCH_MAX_FILE_BYTES) return [];
  const content = await fs.readFile(abs, "utf-8").catch(() => "");
  if (!content || content.includes("\0")) return [];
  const rel = relPosix(root, abs);
  const out: SearchMatch[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      out.push({ path: rel, line: i + 1, text: lines[i].trim().slice(0, MATCH_TEXT_MAX) });
      if (out.length >= SEARCH_MAX_MATCHES) break;
    }
  }
  return out;
}

/**
 * The ripgrep backend. Resolves null when ripgrep could not run the search at all —
 * it failed to spawn, or rejected the pattern — so the caller falls back to the walk.
 * A timeout or the match cap hands back what was found, marked truncated.
 */
export function ripgrepSearch(root: string, start: string, query: string, ripgrep: string): Promise<RepoSearchResult | null> {
  const target = relPosix(root, start) || ".";
  const args = [
    "--line-number", "--no-heading", "--with-filename", "--color", "never", "--no-messages",
    "--ignore-case", "--max-columns", "400", "--max-filesize", `${SEARCH_MAX_FILE_BYTES}`,
    // Mirror the walker's skip list so the two backends agree on what "the repo" is.
    ...[...SKIP_DIRS].flatMap((dir) => ["--glob", `!**/${dir}/**`]),
    // The JS engine's escaping rule, expressed as ripgrep's own flag: a query that is not
    // a regex is a literal, never a refused search.
    ...(isValidRegex(query) ? [] : ["--fixed-strings"]),
    "--regexp", query,
    "--", target,
  ];
  return new Promise((resolve) => {
    const matches: SearchMatch[] = [];
    let truncated = false;
    let settled = false;
    let pending = "";
    let child: ReturnType<typeof spawn>;
    const finish = (value: RepoSearchResult | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const done = (): void => finish({ ok: true, query, total: matches.length, truncated, matches: ordered(matches) });
    const timer = setTimeout(() => {
      truncated = true;
      try { child.kill(); } catch { /* already gone */ }
      done();
    }, RIPGREP_TIMEOUT_MS);
    try {
      child = spawn(ripgrep, args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      finish(null);
      return;
    }
    child.on("error", () => finish(null));
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (settled) return;
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const match = parseRipgrepLine(line);
        if (!match) continue;
        matches.push(match);
        if (matches.length >= SEARCH_MAX_MATCHES) {
          truncated = true;
          try { child.kill(); } catch { /* already gone */ }
          done();
          return;
        }
      }
    });
    child.on("close", (code) => {
      if (settled) return;
      const last = parseRipgrepLine(pending);
      if (last && matches.length < SEARCH_MAX_MATCHES) matches.push(last);
      // 0 = matches, 1 = none; 2 = ripgrep could not do this search (an unsupported
      // pattern, an unreadable target). A 2 with nothing found means "let the walk try".
      if (code === 2 && matches.length === 0) finish(null);
      else done();
    });
  });
}

/**
 * The in-process fallback: BREADTH-FIRST over the tree (a directory queue, not depth-
 * first recursion, so shallow files across the whole tree are scanned before the file
 * budget goes on one deep subtree), reading each file and testing its lines with the JS
 * pattern. Bounded by {@link WALK_MAX_FILES}, and honest about it: a capped scan with no
 * matches is reported `truncated`, never as "absent".
 */
export async function walkSearch(root: string, start: string, query: string): Promise<RepoSearchResult> {
  const re = compileSearchPattern(query);
  const matches: SearchMatch[] = [];
  let filesScanned = 0;
  let truncated = false;
  const queue: string[] = [start];
  outer: while (queue.length > 0) {
    if (matches.length >= SEARCH_MAX_MATCHES || filesScanned >= WALK_MAX_FILES) { truncated = true; break; }
    const dir = queue.shift()!;
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (matches.length >= SEARCH_MAX_MATCHES || filesScanned >= WALK_MAX_FILES) { truncated = true; break outer; }
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        queue.push(abs);
      } else if (entry.isFile()) {
        const stat = await fs.stat(abs).catch(() => null);
        if (!stat) continue;
        filesScanned++;
        const found = await searchOneFile(root, abs, re, stat.size);
        for (const m of found) {
          matches.push(m);
          if (matches.length >= SEARCH_MAX_MATCHES) { truncated = true; break outer; }
        }
      }
    }
  }
  return { ok: true, query, total: matches.length, truncated, matches: ordered(matches) };
}
