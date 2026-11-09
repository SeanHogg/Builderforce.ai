/**
 * The editor shell's RESULT CACHE: a run that repeats a read-only / verification command
 * (`pnpm type-check`, `git status`, `ls`) with nothing changed since gets the earlier result
 * back — marked `cached`, with when it ran — instead of paying for the run again (a
 * 100-second type-check re-run only to grep its output, chat #60338).
 *
 * "Nothing changed" is a WORKSPACE FINGERPRINT, not a guess from tool names: the checkout's
 * HEAD plus every changed / untracked path (`git status`) with its mtime and size. It sees an
 * edit by any tool, the person typing in the editor, or a script — and ignores what git
 * ignores (`dist/`, `.tsbuildinfo`, test caches), which a type-check legitimately writes. A
 * result is kept only when the fingerprint is the same before and after its run, so a
 * command that wrote a tracked file, or ran while one was being edited, is never kept.
 *
 * Only commands that cannot change the workspace are considered at all: the shared read-only
 * classifier (`isReadOnlyShellCommand`, what the read guard trusts) plus the package
 * verification scripts. Installs, writes and git mutations never are — and any command that is
 * not cacheable drops the run's cache outright. Outside a git checkout nothing is cached.
 */

import { execFile } from "child_process";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import * as path from "path";
import type { ShellResult } from "@builderforce/agent-tools";
import { IN_RUN_VERIFY_SCRIPT_NAMES, isReadOnlyShellCommand } from "@builderforce/run-guards";
import type { JobOwner } from "./localShellJobs";

/** Package scripts that only check: the in-run verify set, plus lint / check / tsc and their `:sub` variants. */
const VERIFY_SCRIPTS = [...IN_RUN_VERIFY_SCRIPT_NAMES, "lint", "check", "tsc"].map((s) => s.replace(/-/g, "\\-")).join("|");
const PACKAGE_SCRIPT = new RegExp(
  `^(?:npm|pnpm|yarn)(?:\\s+(?:--filter|-F|-C|--dir|--prefix|--workspace|-w)(?:[=\\s]\\S+)?|\\s+-r|\\s+--recursive)*\\s+(?:run\\s+)?(?:${VERIFY_SCRIPTS})(?::[\\w:-]+)?(?=\\s|$)`,
);
/** Checker binaries invoked directly — `tsc` only when it emits nothing. */
const CHECKER = /^(?:(?:npx|pnpm\s+exec|yarn)\s+)?(?:tsc\b(?=.*\s--noEmit\b)|tsgo\b(?=.*\s--noEmit\b)|vitest\s+run\b|jest\b|eslint\b|prettier\b(?=.*\s--check\b))/;
/** Flags that make a checker WRITE (fix, update snapshots) or never finish. */
const WRITING_FLAG = /\s(?:--fix\b|--write\b|-u\b|--update\w*|--watch\b|-w\b(?!\S))/;

/** A verification command: one command (a `2>&1` is fine), no chain, no pipe, no redirect into a file. */
function isVerificationCommand(command: string): boolean {
  const c = command.replace(/\s+2>&1\s*$/, "");
  if (/[|;&<>`]|\$\(/.test(c.replace(/\s2>&1\b/g, ""))) return false;
  if (WRITING_FLAG.test(c)) return false;
  return PACKAGE_SCRIPT.test(c) || CHECKER.test(c);
}

/** Read-only, but answered by the clock or the network rather than the workspace. */
const NOT_WORKSPACE_STATE = /(^|[\s|;&(])(?:date|hostname|whoami|uptime)(?=\s|$|[|;&)])|\bls-remote\b|\bremote\s+show\b/;

/** May this command's result be reused while the workspace is unchanged? */
export function isCacheableCommand(command: string): boolean {
  const c = command.trim().replace(/\s+/g, " ");
  if (!c || NOT_WORKSPACE_STATE.test(c)) return false;
  return isReadOnlyShellCommand(c) || isVerificationCommand(c);
}

/** A git invocation's stdout, or null (not a checkout, git missing, too slow). */
function git(dir: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", ["--no-optional-locks", ...args], { cwd: dir, windowsHide: true, timeout: 15_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) =>
      resolve(err ? null : String(stdout)),
    );
  });
}

/** Changed / untracked paths past this ⇒ not worth fingerprinting; nothing is cached. */
const MAX_FINGERPRINT_PATHS = 5_000;

/** The repo-relative paths in `git status --porcelain=v2 -z` records (a rename's origin path is its own record). */
function statusPaths(records: string[]): string[] {
  const paths: string[] = [];
  for (let i = 0; i < records.length; i += 1) {
    const r = records[i] ?? "";
    const fields = r.split(" ");
    if (r.startsWith("1 ")) paths.push(fields.slice(8).join(" "));
    else if (r.startsWith("2 ")) {
      paths.push(fields.slice(9).join(" "));
      i += 1; // the origin path
    } else if (r.startsWith("u ")) paths.push(fields.slice(10).join(" "));
    else if (r.startsWith("? ")) paths.push(r.slice(2));
  }
  return paths;
}

/**
 * The state of the checkout `dir` is in: HEAD, the index/worktree status, and the mtime + size of
 * every changed or untracked path. Null outside a checkout (nothing is cached there).
 */
export async function workspaceFingerprint(dir: string): Promise<string | null> {
  const top = await git(dir, ["rev-parse", "--show-toplevel"]);
  if (!top?.trim()) return null;
  const root = top.trim();
  const status = await git(root, ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"]);
  if (status === null) return null;
  const paths = statusPaths(status.split("\0").filter(Boolean));
  if (paths.length > MAX_FINGERPRINT_PATHS) return null;
  const stats = await Promise.all(
    paths.map(async (p) => {
      try {
        const s = await fs.stat(path.join(root, p));
        return `${p}\t${s.mtimeMs}\t${s.size}`;
      } catch {
        return `${p}\t-`;
      }
    }),
  );
  return createHash("sha1").update(status).update("\0").update(stats.join("\n")).digest("hex");
}

interface Cached {
  owner: JobOwner;
  result: ShellResult;
  fingerprint: string;
  at: string;
}

/** Kept results across every run; the oldest goes first. Each is already bounded by the shell. */
const MAX_CACHED = 40;
const cache = new Map<string, Cached>();

const keyOf = (owner: JobOwner, dir: string, command: string): string => `${owner ?? "-"}\0${path.resolve(dir)}\0${command.trim().replace(/\s+/g, " ")}`;

/** Ran to completion: an exit code, no Stop, no timeout / overflow. */
function completed(r: ShellResult): boolean {
  return !r.aborted && !r.error && !r.cached && (r.ok || typeof r.exitCode === "number");
}

/** The earlier result of this command, when the workspace is exactly as it was then. */
export async function cachedResult(owner: JobOwner, dir: string, command: string): Promise<ShellResult | undefined> {
  const key = keyOf(owner, dir, command);
  const hit = cache.get(key);
  if (!hit) return undefined;
  if ((await workspaceFingerprint(dir)) !== hit.fingerprint) {
    cache.delete(key);
    return undefined;
  }
  const note = `no files changed since ${hit.at}; re-run with fresh:true to force`;
  return { ...hit.result, cached: true, note: hit.result.note ? `${hit.result.note}; ${note}` : note };
}

/** Keep `result` when the command completed and the workspace did not move while it ran. */
export async function rememberResult(owner: JobOwner, dir: string, command: string, result: ShellResult, before: Promise<string | null>, at: Date): Promise<void> {
  const first = await before;
  if (!first || !completed(result)) return;
  if ((await workspaceFingerprint(dir)) !== first) return;
  const key = keyOf(owner, dir, command);
  cache.delete(key);
  cache.set(key, { owner, result, fingerprint: first, at: at.toISOString() });
  for (const k of cache.keys()) {
    if (cache.size <= MAX_CACHED) break;
    cache.delete(k);
  }
}

/** Drop a run's cached results: it ran something that may write, or it settled. */
export function invalidateRunCache(owner: JobOwner): void {
  for (const [key, entry] of [...cache]) if (entry.owner === owner) cache.delete(key);
}
