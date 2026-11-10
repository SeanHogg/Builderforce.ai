/**
 * The GitPort the VSIX binds (PRD 45 §4.4 gitPort): the host reads the REAL
 * commits and the REAL bytes — never what the model claims to have written.
 *
 * - `files`: the files in commits not yet on upstream (`git log @{u}..HEAD`), each
 *   with the hash of its CURRENT bytes on disk (the host hashes the file itself,
 *   keyed to the HEAD tree) and whether it is new.
 * - `diffHash`: sha-256 of `git diff --binary <merge-base(@{u}, HEAD)>..HEAD` — the
 *   reviewer's verdict is recorded against exactly this, so a diff that changes
 *   after review is refused by `reviewGate`.
 * - `baseBranch`: whether the current branch IS the upstream (pushing to the base
 *   branch itself) — a push to a non-base branch is not gated.
 *
 * Every git read goes through `gitRunner` so tests substitute a fake git.
 */

import { createHash } from "crypto";
import type { OutgoingFile } from "./types";

export interface GitRunner {
  (args: readonly string[], opts: { cwd: string }): Promise<{ stdout: string; exitCode: number }>;
}

const GIT_TIMEOUT_MS = 30_000;

/** The host-side git the port shells out to; a failed call yields empty, never a guess. */
function gitExec(runner: GitRunner, cwd: string, args: readonly string[]): Promise<string> {
  return runner(args, { cwd }).then((r) => (r.exitCode === 0 ? r.stdout : ""));
}

/** The merge-base of HEAD and its upstream (the review's base for the diff). */
async function mergeBase(runner: GitRunner, cwd: string): Promise<string | null> {
  const out = await gitExec(runner, cwd, ["merge-base", "@{u}", "HEAD"]);
  const base = out.trim();
  return base || null;
}

/** Files in commits not on upstream: `git log @{u}..HEAD --name-only --format=%H`. */
async function outgoingPaths(runner: GitRunner, cwd: string): Promise<readonly string[]> {
  const out = await gitExec(runner, cwd, ["log", "@{u}..HEAD", "--name-only", "--format=%H"]);
  const paths = new Set<string>();
  for (const line of out.split("\n")) {
    const p = line.trim();
    if (p && !/^[0-9a-f]{40}$/i.test(p)) paths.add(p);
  }
  return [...paths];
}

/**
 * Is this path NEW in the push — absent from the tree it lands on (the merge-base, else the
 * upstream)? `git log @{u}..HEAD -- rel` cannot answer it: every outgoing path is in an
 * outgoing commit, so that read called every file "not new" and `newSourceNeedsTest` never fired.
 */
async function isNew(runner: GitRunner, cwd: string, rel: string, base: string | null): Promise<boolean> {
  const r = await runner(["cat-file", "-e", `${base ?? "@{u}"}:${rel}`], { cwd });
  return r.exitCode !== 0;
}

/** The current bytes' sha-256, keyed to the HEAD tree's bytes for the path. */
async function fileHash(runner: GitRunner, cwd: string, rel: string, readFile: (p: string) => Promise<string | null>): Promise<string | null> {
  const abs = `${cwd}/${rel}`;
  const content = await readFile(abs);
  if (content === null) return null; // deleted: no bytes, no hash
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * The GitPort. `readFile` returns the file's current UTF-8 text (null when absent)
 * so hashes reflect the real bytes; the runner is the host's git.
 */
export function createGitPort(runner: GitRunner, readFile: (abs: string) => Promise<string | null>) {
  return {
    async outgoing(repo: string): Promise<{ files: OutgoingFile[]; diffHash: string; baseBranch: boolean; diff: string }> {
      const upstream = (await gitExec(runner, repo, ["rev-parse", "--abbrev-ref", "@{u}"])).trim();
      const current = (await gitExec(runner, repo, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
      const baseBranch = upstream !== "" && current === upstream.split("/").pop();

      const base = await mergeBase(runner, repo);
      const diffText = await gitExec(runner, repo, [
        "diff", "--binary", ...(base ? [`${base}..HEAD`] : ["@{u}..HEAD"]),
      ]);
      const diffHash = createHash("sha256").update(diffText, "utf8").digest("hex");

      const files: OutgoingFile[] = [];
      for (const rel of await outgoingPaths(runner, repo)) {
        const hash = await fileHash(runner, repo, rel, readFile);
        files.push({
          absPath: `${repo}/${rel}`.replace(/\\/g, "/"),
          hash: hash ?? "",
          isNew: await isNew(runner, repo, rel, base),
          deleted: hash === null,
        });
      }
      // `diff` is the exact text `diffHash` hashes: the reviewer reads it and hashes it the same way.
      return { files, diffHash, baseBranch, diff: diffText };
    },
  };
}
