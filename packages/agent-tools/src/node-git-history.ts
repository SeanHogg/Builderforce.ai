/**
 * node-git-history.ts — the Node implementation of the review's `HistoryPort` over
 * `git log` (PRD 38, Option B+ Contract 1: the `churn` badge; P4: `coChange`). Node-only
 * (`child_process`): the package root and `./knowledge` never import it.
 *
 * One `git log --name-only --full-diff --since=<n>.days --max-count=<m> --format=${HISTORY_FORMAT} -- .`
 * per call, run in the reviewed folder (so only its commits), with `core.quotepath=false` so a
 * non-ASCII path is its real name, not an octal-escaped string. Paths come back repo-relative
 * (`--full-diff`: every file of the commit, for its `fileCount`) and are made root-relative by
 * the folder's `--show-prefix`. Not a git repository, no git, a failed run: no port / an empty
 * list — never a throw into the review. A run that hits the timeout is reported through
 * `onWarn` (an empty list there would otherwise look like "no recent commits").
 */

import { execFile } from "node:child_process";
import type { HistoryCommit, HistoryPort } from "./knowledge/historyPort.js";

const MAX_BUFFER = 256 * 1024 * 1024;
const TIMEOUT_MS = 60_000;

/**
 * The marker that starts every commit header line of a `git log --name-only` we parse: a RECORD SEPARATOR (U+001E,
 * `%x1e` in `--format`). A path can never start with it — git C-quotes any path holding a control character, even with
 * `core.quotepath=false` — so a header is never confused with a file. (A bare `%H` was: a file named with 40–64 hex
 * characters read as a commit separator, and `@@@` is a legal file name.)
 */
export const COMMIT_MARK = "\u001e";

/** Separates the author name from the subject (a UNIT SEPARATOR, `%x1f`: names and subjects may hold `|`). */
export const AUTHOR_END = "\u001f";

/** A control character as a git `--format` escape (`%xNN`), so each `--format` below is spelled from the constants the parsers read. */
const formatEscape = (char: string): string => `%x${char.charCodeAt(0).toString(16).padStart(2, "0")}`;

/** THE `--format` of `recentCommits`, read back by `parseRecentCommits`: `<RS>%H|%cI|%an<US>%s`. */
export const RECENT_COMMITS_FORMAT = `${formatEscape(COMMIT_MARK)}%H|%cI|%an${formatEscape(AUTHOR_END)}%s`;

/** THE `--format` of the history port's log, read back by `parseCommitFiles`: `<RS>%cI` (committer time, what `--since` filters on). */
export const HISTORY_FORMAT = `${formatEscape(COMMIT_MARK)}%cI`;

/** One line of `git log` output with only its terminator removed — a path may legally begin or end with spaces. */
const logLines = (log: string): string[] => log.split(/\r?\n/);

export interface GitHistoryOptions {
  /** Told when a `git` run did not finish (timeout / too much output), so an empty churn is not read as "quiet". */
  onWarn?(message: string): void;
}

export interface GitRun {
  stdout?: string;
  stderr?: string;
  /** Why it produced nothing, when it did not. */
  failure?: "timeout" | "buffer" | "error";
}

/**
 * THE git exec wrapper (history, churn and the knowledge fixes all use it): `git` in `cwd`
 * with `core.quotepath=false`. `stdout` is set only on success; a failure says why.
 */
export function runGit(cwd: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<GitRun> {
  return new Promise((resolve) => {
    try {
      execFile("git", ["-c", "core.quotepath=false", ...args], { cwd, maxBuffer: MAX_BUFFER, timeout: opts.timeoutMs ?? TIMEOUT_MS, windowsHide: true }, (error, stdout, stderr) => {
        if (!error) return resolve({ stdout, stderr });
        const e = error as NodeJS.ErrnoException & { killed?: boolean };
        resolve({ stderr, failure: e.killed ? "timeout" : e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ? "buffer" : "error" });
      });
    } catch {
      resolve({ failure: "error" });
    }
  });
}
const git = runGit;

/** One commit of `git log`, with the root-relative paths it touched. */
export interface RecentCommit { sha: string; at: string; title: string; paths: string[]; /** `%an`; absent when the log did not carry one. */ author?: string }

/** `git log --format=${RECENT_COMMITS_FORMAT} --name-only` output as commits (a header with no author separator is the older `%H|%cI|%s`). Pure. */
export function parseRecentCommits(log: string): RecentCommit[] {
  const commits: RecentCommit[] = [];
  let current: RecentCommit | undefined;
  for (const line of logLines(log)) {
    if (!line) continue;
    if (line.startsWith(COMMIT_MARK)) {
      const body = line.slice(COMMIT_MARK.length);
      const first = body.indexOf("|");
      const second = body.indexOf("|", first + 1);
      if (first < 0 || second < 0) { current = undefined; continue; }
      const rest = body.slice(second + 1);
      const split = rest.indexOf(AUTHOR_END);
      const author = split > 0 ? rest.slice(0, split).trim() : "";
      current = {
        sha: body.slice(0, first), at: body.slice(first + 1, second), title: split >= 0 ? rest.slice(split + 1) : rest, paths: [],
        ...(author ? { author } : {}),
      };
      commits.push(current);
      continue;
    }
    current?.paths.push(line.replace(/\\/g, "/"));
  }
  return commits;
}

/**
 * The last `count` commits touching the folder at `rootDir` (`-- .`, so a sub-folder root sees
 * only its own history), paths root-relative. Not a git work tree or a failed run: none, with
 * the reason through `onWarn` for a run that did not finish.
 */
export async function recentCommits(rootDir: string, count: number, options: GitHistoryOptions = {}): Promise<RecentCommit[]> {
  const run = await git(rootDir, ["log", `-${Math.max(1, Math.floor(count))}`, "--name-only", "--relative", `--format=${RECENT_COMMITS_FORMAT}`, "--", "."]);
  if (run.stdout === undefined) {
    if (run.failure === "timeout") options.onWarn?.(`git log did not finish within ${TIMEOUT_MS / 1000}s: history is missing.`);
    return [];
  }
  return parseRecentCommits(run.stdout);
}

/**
 * `git log --name-only --full-diff --format=${HISTORY_FORMAT}` output as commits, in log order. Paths are repo-relative in
 * the log; `prefix` (the root's `git rev-parse --show-prefix`, `/`-ended or empty) is stripped from those inside the root
 * and the rest are dropped, while `fileCount` counts every distinct file of the commit. Pure.
 */
export function parseCommitFiles(log: string, prefix = ""): HistoryCommit[] {
  const root = prefix.replace(/\\/g, "/");
  const out: Array<{ at: string; all: Set<string>; inRoot: Set<string> }> = [];
  let current: (typeof out)[number] | undefined;
  for (const line of logLines(log)) {
    if (!line) continue;
    if (line.startsWith(COMMIT_MARK)) {
      current = { at: line.slice(COMMIT_MARK.length).trim(), all: new Set(), inRoot: new Set() };
      out.push(current);
      continue;
    }
    if (!current) continue;
    const path = line.replace(/\\/g, "/");
    current.all.add(path);
    if (path.startsWith(root) && path.length > root.length) current.inRoot.add(path.slice(root.length));
  }
  return out.map((c) => ({ at: c.at, paths: [...c.inRoot], fileCount: c.all.size }));
}

/** The history port for `rootDir`, or undefined when it is not inside a git work tree. */
export async function gitHistoryPort(rootDir: string, options: GitHistoryOptions = {}): Promise<HistoryPort | undefined> {
  const inside = await git(rootDir, ["rev-parse", "--is-inside-work-tree", "--show-prefix"]);
  const [flag, prefix = ""] = (inside.stdout ?? "").split(/\r?\n/);
  if (flag?.trim() !== "true") return undefined;
  return {
    async commits(sinceDays, maxCommits) {
      const days = Math.max(1, Math.floor(sinceDays));
      const max = Math.max(1, Math.floor(maxCommits));
      // `-- .` picks the root's commits; `--full-diff` lists ALL their files (repo-relative) so the bulk cut sees the whole commit.
      const run = await git(rootDir, ["log", "--name-only", "--full-diff", `--since=${days}.days`, `--max-count=${max}`, `--format=${HISTORY_FORMAT}`, "--", "."]);
      if (run.stdout === undefined) {
        if (run.failure === "timeout") options.onWarn?.(`git log did not finish within ${TIMEOUT_MS / 1000}s: history (churn, co-change) is missing, not zero.`);
        else if (run.failure === "buffer") options.onWarn?.("git log produced too much output: history (churn, co-change) is missing, not zero.");
        return [];
      }
      return parseCommitFiles(run.stdout, prefix.trim());
    },
  };
}
