/**
 * node-git-history.ts — the Node implementation of the review's `HistoryPort` over
 * `git log` (PRD 38, Option B+ Contract 1: the `churn` badge). Node-only
 * (`child_process`): the package root and `./knowledge` never import it.
 *
 * One `git log --name-only --since=<n>.days --format=%H` per call, run in the reviewed
 * folder with `--relative` so paths are root-relative, and with `core.quotepath=false` so a
 * non-ASCII path is its real name, not an octal-escaped string. Not a git repository, no
 * git, a failed run: no port / an empty map — never a throw into the review. A run that
 * hits the timeout is reported through `onWarn` (an empty map there would otherwise look
 * like "no recent commits").
 */

import { execFile } from "node:child_process";
import type { HistoryPort } from "./knowledge/historyPort.js";

const MAX_BUFFER = 256 * 1024 * 1024;
const TIMEOUT_MS = 60_000;
const SHA = /^[0-9a-f]{40,64}$/;

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
export function runGit(cwd: string, args: string[]): Promise<GitRun> {
  return new Promise((resolve) => {
    try {
      execFile("git", ["-c", "core.quotepath=false", ...args], { cwd, maxBuffer: MAX_BUFFER, timeout: TIMEOUT_MS, windowsHide: true }, (error, stdout, stderr) => {
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

const COMMIT_MARK = "@@@";
/** Separates the author name from the subject (a unit separator: names and subjects may hold `|`). */
const AUTHOR_END = "\u001f";

/** `git log --format=@@@%H|%cI|%an<US>%s --name-only` output as commits (a line with no author separator is the older `%H|%cI|%s`). Pure. */
export function parseRecentCommits(log: string): RecentCommit[] {
  const commits: RecentCommit[] = [];
  let current: RecentCommit | undefined;
  for (const raw of log.split(/\r?\n/)) {
    const line = raw.trim();
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
  const run = await git(rootDir, ["log", `-${Math.max(1, Math.floor(count))}`, "--name-only", "--relative", `--format=${COMMIT_MARK}%H|%cI|%an%x1f%s`, "--", "."]);
  if (run.stdout === undefined) {
    if (run.failure === "timeout") options.onWarn?.(`git log did not finish within ${TIMEOUT_MS / 1000}s: history is missing.`);
    return [];
  }
  return parseRecentCommits(run.stdout);
}

/** Commits per path from `git log --name-only --format=%H` output, for the wanted paths only. */
export function countCommitsPerPath(log: string, wanted: ReadonlySet<string>): Map<string, number> {
  const counts = new Map<string, number>();
  let seen = new Set<string>();
  for (const raw of log.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (SHA.test(line)) { seen = new Set(); continue; }
    const path = line.replace(/\\/g, "/");
    if (!wanted.has(path) || seen.has(path)) continue;
    seen.add(path);
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return counts;
}

/** The history port for `rootDir`, or undefined when it is not inside a git work tree. */
export async function gitHistoryPort(rootDir: string, options: GitHistoryOptions = {}): Promise<HistoryPort | undefined> {
  const inside = await git(rootDir, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.stdout?.trim() !== "true") return undefined;
  return {
    async commitsTouching(paths, sinceDays) {
      if (paths.length === 0) return new Map();
      const days = Math.max(1, Math.floor(sinceDays));
      const run = await git(rootDir, ["log", "--name-only", "--relative", `--since=${days}.days`, "--format=%H", "--", "."]);
      if (run.stdout === undefined) {
        if (run.failure === "timeout") options.onWarn?.(`git log did not finish within ${TIMEOUT_MS / 1000}s: churn is missing, not zero.`);
        else if (run.failure === "buffer") options.onWarn?.("git log produced too much output: churn is missing, not zero.");
        return new Map();
      }
      return countCommitsPerPath(run.stdout, new Set(paths));
    },
  };
}
