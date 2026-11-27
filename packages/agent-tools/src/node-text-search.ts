/**
 * The ripgrep backend of `search_code` for every Node host (the VS Code extension and the on-prem
 * agent runtime): spawning, the per-run concurrency gate, and parsing ripgrep's `--json` events into
 * repo-relative matches. The public entry (`searchWorkspace`: a file scope, ripgrep, then the
 * neutral scan) lives in `node-workspace.ts`, so the no-ripgrep fallback is the ONE `scanFiles`
 * walk over `nodeWorkspaceFs` rather than a second walker here.
 *
 * ## One file policy
 *
 * ripgrep and the neutral scan must agree on what "the repo" is. The scan enters a directory when
 * `isIndexedDirName` admits it (a skip-list name, `.worktrees`, `*.local` and `_*_src` are out;
 * a hidden directory is out except `.github`). ripgrep therefore runs with `--hidden` plus the
 * matching exclude globs, and every match is post-filtered through `isIndexedDirName` on each
 * directory segment below the search target. The one difference left is ripgrep honouring
 * `.gitignore`, which the scan does not read.
 *
 * Every path returned is repo-relative, POSIX-separated, and the same shape whichever backend
 * produced it. Host-neutral: Node `child_process` plus a root path. Locating the ripgrep binary,
 * and wiring a Stop signal, stay with the host.
 */

import { spawn } from "node:child_process";
import type { RepoSearchResult } from "./capabilities.js";
import { toPosixRel } from "./node-path.js";
import { WORKSPACE_SKIP_DIRS, isIndexedDirName } from "./skipDirs.js";
import { SEARCH_MAX_MATCHES } from "@builderforce/tool-output-policy";
import { isValidRegex, orderMatches, smartCaseSensitive, type SearchMatch } from "./text-scan.js";

/** Wall-clock bound on a ripgrep run; what it has found by then is returned as truncated. */
const RIPGREP_TIMEOUT_MS = 20_000;
/** ripgrep skips files over this (`--max-filesize 1M`): generated bundles and data dumps
 *  are not source, and reading them is what made a whole-root scan take 15s (chat #168571). */
const RG_MAX_FILESIZE = "1M";
/** Characters of a matching line kept — enough to read, not enough to flood the window. */
const MATCH_TEXT_MAX = 200;

/**
 * Parse one ripgrep output line (`path:line:text`, as `--line-number --no-heading
 * --with-filename` prints it) into a match with a normalised repo-relative path. Paths
 * arrive as ripgrep printed them — `./a/b.ts` on POSIX, `.\a\b.ts` on Windows, or
 * `sub/dir/x.ts` for a scoped target — and leave as `a/b.ts`. Null for a line that is
 * not a match (a blank, or a `--max-columns` omission notice). Exported for the test.
 */
export function parseRipgrepLine(line: string): SearchMatch | null {
  if (!line || line === "[Omitted long matching line]") return null;
  // Greedy path so a Windows drive colon (`C:\foo\bar.ts:12:text`) is not taken as
  // the split — the LAST `:digits:` is the line number. The earlier non-greedy
  // `^(.+?):` treated `C:` as path + line and dropped every match on this OS
  // (chat #111: directory `search_code` returned total:0 truncated:false).
  const m = /^(.+):(\d+):(.*)$/.exec(line);
  if (!m) return null;
  // All three groups participate in every match of the pattern; the defaults only satisfy the index types.
  const [, rawPath = "", lineNo = "", rawText = ""] = m;
  const rel = rawPath.split("\\").join("/").replace(/^(?:\.\/)+/, "");
  if (!rel) return null;
  const text = rawText.trim();
  if (text === "[Omitted long matching line]") return null;
  return { path: rel, line: Number(lineNo), text: text.slice(0, MATCH_TEXT_MAX) };
}

/**
 * One `--json` event from ripgrep. `type:"match"` becomes a {@link SearchMatch}
 * with a repo-relative path (absolute Windows paths are stripped back to `root`).
 * Null for begin/end/summary events, malformed JSON, or the colon-format fallback
 * when the line is not a match either.
 */
export function parseRipgrepJsonLine(line: string, root: string): SearchMatch | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const ev = JSON.parse(trimmed) as {
      type?: string;
      data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } };
    };
    if (ev.type !== "match") return null;
    const printed = ev.data?.path?.text;
    const lineNo = ev.data?.line_number;
    if (!printed || typeof lineNo !== "number") return null;
    const text = (ev.data?.lines?.text ?? "").trim().slice(0, MATCH_TEXT_MAX);
    return { path: toRepoRel(root, printed), line: lineNo, text };
  } catch {
    const colon = parseRipgrepLine(trimmed);
    if (!colon) return null;
    return { ...colon, path: toRepoRel(root, colon.path) };
  }
}

/** Repo-relative POSIX path from whatever ripgrep printed (relative, `..`, or `C:\...`). */
function toRepoRel(root: string, printed: string): string {
  const posix = printed.split("\\").join("/").replace(/^(?:\.\/)+/, "");
  const rootPosix = root.split("\\").join("/").replace(/\/+$/, "");
  if (posix.length > rootPosix.length) {
    const prefix = posix.slice(0, rootPosix.length);
    const same = prefix === rootPosix || prefix.toLowerCase() === rootPosix.toLowerCase();
    if (same && posix.charAt(rootPosix.length) === "/") return posix.slice(rootPosix.length + 1);
  }
  return posix;
}

/** What a search run carries beyond its target: the run's Stop and its rg gate. */
export interface SearchRunOptions {
  signal?: AbortSignal;
  gate?: RgSemaphore;
}

export const SEARCH_STOPPED = "search stopped";

/** Concurrent ripgrep processes one run may have alive at once: a 3-wide read-only batch
 *  of searches must not put three full-tree scans on the disk at the same time (W6). */
export const RG_MAX_CONCURRENT = 2;

/**
 * A tiny counting semaphore for ripgrep children. `acquire` resolves with a release
 * function once a slot is free; a Stop while queued rejects (the search reports
 * "search stopped" instead of waiting for a slot it will never use).
 */
export class RgSemaphore {
  private active = 0;
  private readonly queue: Array<{ resolve: (release: () => void) => void; reject: (err: Error) => void; signal?: AbortSignal; abort?: () => void }> = [];

  constructor(private readonly limit: number = RG_MAX_CONCURRENT) {}

  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(new Error(SEARCH_STOPPED));
    if (this.active < this.limit && this.queue.length === 0) {
      this.active += 1;
      return Promise.resolve(this.releaseFn());
    }
    return new Promise<() => void>((resolve, reject) => {
      const waiter: { resolve: (release: () => void) => void; reject: (err: Error) => void; signal?: AbortSignal; abort?: () => void } = { resolve, reject, signal };
      if (signal) {
        waiter.abort = () => {
          const i = this.queue.indexOf(waiter);
          if (i >= 0) this.queue.splice(i, 1);
          reject(new Error(SEARCH_STOPPED));
        };
        signal.addEventListener("abort", waiter.abort, { once: true });
      }
      this.queue.push(waiter);
    });
  }

  /** One-shot release: hands the slot to the next waiter, or frees it. */
  private releaseFn(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.queue.shift();
      if (next) {
        if (next.signal && next.abort) next.signal.removeEventListener("abort", next.abort);
        next.resolve(this.releaseFn());
      } else {
        this.active -= 1;
      }
    };
  }
}

// One gate per RUN, keyed by the run's Stop signal (the one object every call of a run
// shares). A WeakMap so a settled run's gate is collected with its signal; calls with
// no signal share one conservative default gate.
const gatesByRun = new WeakMap<AbortSignal, RgSemaphore>();
const defaultGate = new RgSemaphore(RG_MAX_CONCURRENT);

/** The ripgrep gate for a run: at most {@link RG_MAX_CONCURRENT} rg children at once. */
export function rgGateFor(signal?: AbortSignal): RgSemaphore {
  if (!signal) return defaultGate;
  let gate = gatesByRun.get(signal);
  if (!gate) {
    gate = new RgSemaphore(RG_MAX_CONCURRENT);
    gatesByRun.set(signal, gate);
  }
  return gate;
}

/**
 * The ripgrep backend. Resolves null when ripgrep could not run the search at all —
 * it failed to spawn, or rejected the pattern — so the caller falls back to the neutral scan.
 * A timeout or the match cap hands back what was found, marked truncated.
 */
export async function ripgrepSearch(root: string, start: string, query: string, ripgrep: string, run: SearchRunOptions = {}): Promise<RepoSearchResult | null> {
  if (run.signal?.aborted) return { ok: false, query, error: SEARCH_STOPPED };
  // At most RG_MAX_CONCURRENT rg children per run: the third call of a 3-wide batch
  // waits for a slot instead of thrashing the disk with a third full-tree scan.
  const gate = run.gate ?? rgGateFor(run.signal);
  let release: () => void;
  try {
    release = await gate.acquire(run.signal);
  } catch {
    return { ok: false, query, error: SEARCH_STOPPED };
  }
  try {
    return await spawnRipgrepSearch(root, start, query, ripgrep, run);
  } finally {
    release();
  }
}

/** Whether a match path survives the scan's directory policy: every directory segment BELOW the search target is admitted by `isIndexedDirName`. */
function underIndexedPolicy(matchPath: string, target: string): boolean {
  const below = target === "." || target === "" ? matchPath : matchPath.startsWith(`${target}/`) ? matchPath.slice(target.length + 1) : matchPath;
  const dirs = below.split("/").slice(0, -1);
  return dirs.every((name) => isIndexedDirName(name));
}

/** The exclude globs that make ripgrep walk what `isIndexedDirName` admits (the post-filter settles anything a glob cannot express). */
function policyGlobs(target: string): string[] {
  // A target that itself sits in a hidden directory is the caller's explicit choice: no dot-dir glob then.
  const targetIsHidden = target.split("/").some((seg) => seg !== "." && seg.startsWith("."));
  return [
    ...[...WORKSPACE_SKIP_DIRS].flatMap((dir) => ["--glob", `!**/${dir}/**`]),
    "--glob", "!**/.worktrees/**",
    "--glob", "!**/*.local/**",
    "--glob", "!**/_*_src/**",
    ...(targetIsHidden ? [] : ["--glob", "!**/.[!g]*/**"]),
  ];
}

/** The rg child itself, run under the caller's gate slot. */
function spawnRipgrepSearch(root: string, start: string, query: string, ripgrep: string, run: SearchRunOptions): Promise<RepoSearchResult | null> {
  // The resolved scope IS ripgrep's search path (`-- <target>` from cwd=root), never a
  // post-filter over a whole-root scan — a scoped search only walks the subtree.
  const target = toPosixRel(root, start) || ".";
  if (run.signal?.aborted) return Promise.resolve({ ok: false, query, error: SEARCH_STOPPED });
  const args = [
    // JSON events, not `path:line:text` — on Windows that colon format collides with
    // drive letters and a directory search silently reported total:0 (chat #111).
    // The case rule (smart case) is decided HERE and passed explicitly, so ripgrep and
    // the neutral scan always agree on what a query matches.
    "--json", smartCaseSensitive(query) ? "--case-sensitive" : "--ignore-case", "--max-columns", "400", "--max-filesize", RG_MAX_FILESIZE,
    // ONE file policy with the scan: hidden entries are walked (a `.github` tree and dotfiles are source), then the policy excludes.
    "--hidden",
    ...policyGlobs(target),
    // The JS engine's escaping rule, expressed as ripgrep's own flag: a query that is not
    // a regex is a literal, never a refused search.
    ...(isValidRegex(query) ? [] : ["--fixed-strings"]),
    // A `.gz` artifact (a pack, PRD 49 §1.12) is searched inflated, as the scan does.
    "--search-zip",
    "--regexp", query,
    "--", target,
  ];
  return new Promise((resolve) => {
    const matches: SearchMatch[] = [];
    let truncated = false;
    let settled = false;
    let pending = "";
    let child: ReturnType<typeof spawn> | undefined;
    const finish = (value: RepoSearchResult | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      run.signal?.removeEventListener("abort", onStop);
      resolve(value);
    };
    // Stop kills the child: a stopped run must not leave a repo-wide rg running.
    const onStop = (): void => {
      try { child?.kill(); } catch { /* already gone */ }
      finish({ ok: false, query, error: SEARCH_STOPPED });
    };
    const done = (): void => finish({ ok: true, query, total: matches.length, truncated, matches: orderMatches(matches) });
    const timer = setTimeout(() => {
      truncated = true;
      try { child?.kill(); } catch { /* already gone */ }
      done();
    }, RIPGREP_TIMEOUT_MS);
    const take = (line: string): boolean => {
      const match = parseRipgrepJsonLine(line, root);
      if (!match || !underIndexedPolicy(match.path, target)) return false;
      matches.push(match);
      return true;
    };
    try {
      child = spawn(ripgrep, args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      finish(null);
      return;
    }
    run.signal?.addEventListener("abort", onStop, { once: true });
    child.on("error", () => finish(null));
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (settled) return;
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (take(line) && matches.length >= SEARCH_MAX_MATCHES) {
          truncated = true;
          try { child?.kill(); } catch { /* already gone */ }
          done();
          return;
        }
      }
    });
    child.on("close", (code) => {
      if (settled) return;
      if (matches.length < SEARCH_MAX_MATCHES) take(pending);
      // 0 = matches, 1 = none; 2 = ripgrep could not do this search (an unsupported
      // pattern, an unreadable target). A 2 with nothing found means "let the scan try".
      // Exit 0 with ZERO parsed matches is the Windows colon-split lie: rg found hits
      // whose lines we could not parse, so falling through to "absent" is the bug.
      if (matches.length === 0 && code !== 1) finish(null);
      else done();
    });
  });
}
