/**
 * The GitPort the VSIX binds (PRD 45 §4.4 gitPort): the host reads the REAL
 * commits and the REAL bytes — never what the model claims to have written.
 *
 * - The comparison base: for a push, `merge-base(@{u}, HEAD)`; for a pull request,
 *   `merge-base(<PR base on origin>, HEAD)` — a PR comes after the branch was pushed, so
 *   `@{u}` is the branch's own remote and would leave nothing to check.
 * - `files`: the files in commits since that base (`git log <base>..HEAD`), each hashed
 *   from the bytes AT HEAD (`git rev-parse HEAD:<rel>`, the blob id) — what is pushed, not
 *   the working tree. A file also modified in the working tree is marked `unavailable`
 *   (the on-disk checks would test other bytes); a test file carries the paths its
 *   relative imports resolve to, read from its HEAD bytes.
 * - `diffHash`: sha-256 of `git diff --binary <base>..HEAD` — the reviewer's verdict is
 *   recorded against exactly this, so a diff that changes after review is refused.
 * - `unavailable`: why the outgoing set could not be computed (no upstream, no PR base,
 *   no outgoing commits). The gate then reports "unavailable", never "checks passed",
 *   and no review is spent on an empty diff.
 * - `baseBranch`: whether the current branch IS the upstream's branch (pushing to the
 *   base branch itself) — a push to a non-base branch is not gated.
 *
 * Every git read goes through `gitRunner` (argument arrays, no shell) so tests substitute a fake git.
 */

import { createHash } from "crypto";
import * as path from "path";
import type { OutgoingFile } from "./types";

export interface GitRunner {
  (args: readonly string[], opts: { cwd: string }): Promise<{ stdout: string; exitCode: number }>;
}

export interface OutgoingOptions {
  /** Present for `open_pull_request`: compare against the PR's base (default: origin's default branch). */
  pullRequest?: { base?: string };
}

export interface OutgoingChange {
  files: OutgoingFile[];
  diffHash: string;
  baseBranch: boolean;
  diff: string;
  /** Why nothing could be checked; set ⇒ the gate reports "unavailable" and skips the review. */
  unavailable?: string;
}

/** The host-side git the port shells out to; a failed call yields empty, never a guess. */
function gitExec(runner: GitRunner, cwd: string, args: readonly string[]): Promise<string> {
  return runner(args, { cwd }).then((r) => (r.exitCode === 0 ? r.stdout : ""));
}

const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

/** The ref a pull request lands on: `origin/<base>`, else origin's default branch. */
async function pullRequestBaseRef(runner: GitRunner, cwd: string, base: string | undefined): Promise<string | null> {
  const candidates = base
    ? [`origin/${base}`, base]
    : [(await gitExec(runner, cwd, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])).trim(), "origin/main", "origin/master"];
  for (const ref of candidates) {
    if (!ref) continue;
    const r = await runner(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd });
    if (r.exitCode === 0) return ref;
  }
  return null;
}

/** Files in commits since `base`: `git log <base>..HEAD --name-only --format=%H`. */
async function outgoingPaths(runner: GitRunner, cwd: string, base: string): Promise<readonly string[]> {
  const out = await gitExec(runner, cwd, ["log", `${base}..HEAD`, "--name-only", "--format=%H"]);
  const paths = new Set<string>();
  for (const line of out.split("\n")) {
    const p = line.trim();
    if (p && !/^[0-9a-f]{40}$/i.test(p)) paths.add(p);
  }
  return [...paths];
}

/**
 * Is this path NEW in the push — absent from the tree it lands on (the merge-base)?
 * `git log <base>..HEAD -- rel` cannot answer it: every outgoing path is in an outgoing commit.
 */
async function isNew(runner: GitRunner, cwd: string, rel: string, base: string): Promise<boolean> {
  const r = await runner(["cat-file", "-e", `${base}:${rel}`], { cwd });
  return r.exitCode !== 0;
}

/** The blob id of the path AT HEAD (a hash of exactly the pushed bytes), or null when HEAD has no such file. */
async function headHash(runner: GitRunner, cwd: string, rel: string): Promise<string | null> {
  const r = await runner(["rev-parse", "--verify", "--quiet", `HEAD:${rel}`], { cwd });
  const id = r.stdout.trim();
  return r.exitCode === 0 && id ? id : null;
}

/** Paths whose working-tree bytes differ from HEAD (one read for the whole set). */
async function dirtyPaths(runner: GitRunner, cwd: string): Promise<ReadonlySet<string>> {
  const out = await gitExec(runner, cwd, ["diff", "--name-only", "HEAD", "--"]);
  return new Set(out.split("\n").map((l) => l.trim()).filter(Boolean));
}

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/i;
const RELATIVE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\bvi\.mock\s*\(\s*|\bjest\.mock\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g;

/** The paths a test file's relative imports resolve to, read from its bytes at HEAD. */
async function testImports(runner: GitRunner, cwd: string, rel: string, absPath: string): Promise<string[]> {
  const content = await gitExec(runner, cwd, ["cat-file", "blob", `HEAD:${rel}`]);
  const dir = path.posix.dirname(absPath);
  const out = new Set<string>();
  for (const m of content.matchAll(RELATIVE_IMPORT)) {
    if (m[1]) out.add(path.posix.normalize(path.posix.join(dir, m[1])));
  }
  return [...out];
}

/** The GitPort. The runner is the host's git (argument arrays, never a shell string). */
export function createGitPort(runner: GitRunner) {
  return {
    async outgoing(repo: string, opts?: OutgoingOptions): Promise<OutgoingChange> {
      const upstream = (await gitExec(runner, repo, ["rev-parse", "--abbrev-ref", "@{u}"])).trim();
      const current = (await gitExec(runner, repo, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
      const baseBranch = upstream !== "" && current === upstream.split("/").pop();
      const none = (unavailable: string): OutgoingChange => ({ files: [], diffHash: sha256(""), baseBranch, diff: "", unavailable });

      let against: string;
      if (opts?.pullRequest) {
        const ref = await pullRequestBaseRef(runner, repo, opts.pullRequest.base);
        if (!ref) return none("no pull-request base branch was found on origin, so the outgoing change could not be computed");
        against = ref;
      } else {
        if (!upstream) return none("the branch has no upstream, so the outgoing change could not be computed");
        against = "@{u}";
      }
      const base = (await gitExec(runner, repo, ["merge-base", against, "HEAD"])).trim();
      if (!base) return none(`no merge-base with ${against}, so the outgoing change could not be computed`);

      const rels = await outgoingPaths(runner, repo, base);
      if (!rels.length) return none(`no outgoing commits against ${against}`);
      const diffText = await gitExec(runner, repo, ["diff", "--binary", `${base}..HEAD`]);
      const dirty = await dirtyPaths(runner, repo);

      const files: OutgoingFile[] = [];
      for (const rel of rels) {
        const absPath = `${repo}/${rel}`.replace(/\\/g, "/");
        const hash = await headHash(runner, repo, rel);
        const file: OutgoingFile = { absPath, hash: hash ?? "", isNew: await isNew(runner, repo, rel, base), deleted: hash === null };
        if (hash !== null && dirty.has(rel)) {
          file.unavailable = "also modified in the working tree, so the pushed bytes could not be checked (commit or stash the edit)";
        }
        if (hash !== null && TEST_FILE.test(rel)) {
          const imports = await testImports(runner, repo, rel, absPath);
          if (imports.length) file.imports = imports;
        }
        files.push(file);
      }
      // `diff` is the exact text `diffHash` hashes: the reviewer reads it and hashes it the same way.
      return { files, diffHash: sha256(diffText), baseBranch, diff: diffText };
    },
  };
}
