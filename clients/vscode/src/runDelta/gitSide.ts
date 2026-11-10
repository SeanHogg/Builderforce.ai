/**
 * The git reads of a run delta for ONE repository root (PRD 41 §C1 step 2 and the `head-switched` edge case), through
 * agent-tools' git wrapper (`node-git-history` `runGit`, the feature's ONE runner: argument arrays, so a path is never
 * re-quoted for a shell). The before side of every file clean at baseline is read in ONE `git cat-file --batch` process,
 * as BYTES (hashed raw, decoded for rules separately), never one `git show` per file.
 *
 * Every read answers `undefined` when git could not answer (no git, not a repository, an unknown commit); none throws. Each
 * git call is bounded by {@link GIT_TIMEOUT_MS}, inside the delta's own budget.
 */

import { execFile } from "node:child_process";
import { runGit } from "@builderforce/agent-tools/node-git-history";
import { baseCommitOf } from "../runChangeBaseline";

/** One git call's ceiling: well inside the delta's budget (`RUN_DELTA_BUDGET_MS`). */
export const GIT_TIMEOUT_MS = 10_000;
const BLOB_BUFFER = 256 * 1024 * 1024;

/** The git side of one repository: what a delta asks of its history. */
export interface RepoGit {
  /** `path → bytes` at `commit` (`null`: no such blob there); undefined when git could not answer. */
  blobs(commit: string, paths: readonly string[]): Promise<Map<string, Uint8Array | null> | undefined>;
  /** HEAD's commit and its branch (undefined branch: detached). */
  head(): Promise<{ commit?: string; branch?: string }>;
  /** Whether `ancestor` is an ancestor of (or equal to) `commit`; undefined when git could not answer. */
  isAncestor(ancestor: string, commit: string): Promise<boolean | undefined>;
}

/** Parses `git cat-file --batch` output for `specs` in order: `<sha> blob <size>\n<bytes>\n` or `<spec> missing\n`. */
export function parseCatFileBatch(out: Buffer, paths: readonly string[]): Map<string, Uint8Array | null> | undefined {
  const blobs = new Map<string, Uint8Array | null>();
  let at = 0;
  for (const p of paths) {
    const eol = out.indexOf(0x0a, at);
    if (eol < 0) return undefined;
    const header = out.subarray(at, eol).toString("utf8");
    at = eol + 1;
    const m = /^[0-9a-f]+ (\w+) (\d+)$/.exec(header);
    if (!m) { blobs.set(p, null); continue; } // `<spec> missing` (or ambiguous): not a blob at that commit
    const size = Number(m[2]);
    blobs.set(p, m[1] === "blob" ? new Uint8Array(out.subarray(at, at + size)) : null);
    at += size + 1;
  }
  return blobs;
}

/**
 * A full object id (SHA-1 or SHA-256 hex): the ONLY commit-ish this module hands git. A `baseCommit` can come from a stored
 * record (the restart fallback), so each one is checked before it becomes an argument or a `cat-file` spec: a value that is
 * not an object id (`-…`, a range, a ref name) is refused as "git could not answer".
 */
export function isCommitId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40,64}$/.test(value);
}

export function repoGit(root: string): RepoGit {
  const git = (args: string[]) => runGit(root, args, { timeoutMs: GIT_TIMEOUT_MS });
  return {
    blobs(commit, paths) {
      if (!isCommitId(commit)) return Promise.resolve(undefined);
      if (paths.length === 0) return Promise.resolve(new Map());
      // Each spec is one stdin line; a path holding a newline cannot be named on it (git C-quotes such a path anyway).
      if (paths.some((p) => /[\r\n]/.test(p))) return Promise.resolve(undefined);
      return new Promise((resolve) => {
        try {
          const child = execFile("git", ["-c", "core.quotepath=false", "cat-file", "--batch"],
            { cwd: root, encoding: "buffer", maxBuffer: BLOB_BUFFER, timeout: GIT_TIMEOUT_MS, windowsHide: true },
            (error, stdout) => resolve(error ? undefined : parseCatFileBatch(stdout, paths)));
          child.stdin?.on("error", () => resolve(undefined));
          child.stdin?.end(paths.map((p) => `${commit}:${p}\n`).join(""));
        } catch {
          resolve(undefined);
        }
      });
    },
    async head() {
      const commit = await baseCommitOf(root);
      const branch = (await git(["rev-parse", "--abbrev-ref", "HEAD"])).stdout?.trim();
      return { ...(commit ? { commit } : {}), ...(branch && branch !== "HEAD" ? { branch } : {}) };
    },
    async isAncestor(ancestor, commit) {
      if (!isCommitId(ancestor) || !isCommitId(commit)) return undefined;
      const out = await git(["merge-base", "--is-ancestor", "--end-of-options", ancestor, commit]);
      if (out.stdout !== undefined) return true;
      // Exit 1 is "not an ancestor"; an unknown commit is "git could not answer". The wrapper reports both as `error`, so a
      // second question tells them apart: does git know both commits?
      const [a, b] = await Promise.all([git(["cat-file", "-e", "--end-of-options", `${ancestor}^{commit}`]), git(["cat-file", "-e", "--end-of-options", `${commit}^{commit}`])]);
      return a.stdout !== undefined && b.stdout !== undefined ? false : undefined;
    },
  };
}

/**
 * C1 `head-switched`: HEAD moved to another line of history, i.e. the baseline commit is not in HEAD's history. A run's own
 * commits (or a new branch cut from the baseline) keep the delta comparable. The same branch on both sides is never a switch;
 * a detached HEAD on either side falls through to the ancestry test. Unknown (no git) is not a switch.
 */
export async function headSwitched(git: RepoGit, baseline: { baseCommit?: string; branch?: string }): Promise<boolean> {
  if (!baseline.baseCommit) return false;
  const head = await git.head();
  if (!head.commit || head.commit === baseline.baseCommit) return false;
  if (head.branch !== undefined && baseline.branch !== undefined && head.branch === baseline.branch) return false;
  return (await git.isAncestor(baseline.baseCommit, head.commit)) === false;
}
