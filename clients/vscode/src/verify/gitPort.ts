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
 * - `upToDate`: the empty set was COMPUTED — the ref is already on the comparison ref
 *   (merge-base == the ref's commit). Names the ref it was computed for, and — when that ref
 *   is the checkout — the working tree's uncommitted paths (so "nothing to push" is never
 *   mistaken for "shipped" while the change sits uncommitted).
 * - `baseBranch`: whether the TARGET branch (the named `ref`, else the checkout) IS its
 *   upstream's branch (pushing to the base branch itself) — a push to a non-base branch is
 *   not gated.
 * - `ref`: the branch to compute for (a ticket branch pushed / PR'd by ref); default HEAD.
 *   Every read (`merge-base`, `log`, `diff`, blob ids) uses it in place of HEAD.
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
  /** The branch whose outgoing change is computed (the tool's `branch` arg); default the checkout (HEAD). */
  ref?: string;
}

export interface OutgoingChange {
  files: OutgoingFile[];
  diffHash: string;
  baseBranch: boolean;
  diff: string;
  /** Why nothing could be checked; set ⇒ the gate reports "unavailable" and skips the review. */
  unavailable?: string;
  /** The ref is already contained in the comparison ref (merge-base == its commit): computed, empty,
   *  nothing to push. `unavailable` is set alongside (its "no outgoing commits" reason); the gates
   *  read this first. `ref` is what was computed (`opts.ref`, else "HEAD"); `uncommitted` the
   *  working tree's changed paths (absolute) when that ref is the checkout, else empty. */
  upToDate?: { head: string; upstream: string; ref: string; uncommitted: string[] };
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

/** Files in commits since `base`: `git log <base>..<head> --name-only --format=%H`. */
async function outgoingPaths(runner: GitRunner, cwd: string, base: string, head: string): Promise<readonly string[]> {
  const out = await gitExec(runner, cwd, ["log", `${base}..${head}`, "--name-only", "--format=%H"]);
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

/** The blob id of the path AT `head` (a hash of exactly the pushed bytes), or null when it has no such file. */
async function headHash(runner: GitRunner, cwd: string, rel: string, head: string): Promise<string | null> {
  const r = await runner(["rev-parse", "--verify", "--quiet", `${head}:${rel}`], { cwd });
  const id = r.stdout.trim();
  return r.exitCode === 0 && id ? id : null;
}

/** Paths whose working-tree bytes differ from `head` (one read for the whole set). */
async function dirtyPaths(runner: GitRunner, cwd: string, head: string): Promise<ReadonlySet<string>> {
  const out = await gitExec(runner, cwd, ["diff", "--name-only", head, "--"]);
  return new Set(out.split("\n").map((l) => l.trim()).filter(Boolean));
}

/** Every uncommitted path in the working tree (modified, staged, untracked), repo-relative. */
async function uncommittedPaths(runner: GitRunner, cwd: string): Promise<string[]> {
  const out = await gitExec(runner, cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const tokens = out.split("\0");
  const paths: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]!;
    if (t.length < 4) continue;
    paths.push(t.slice(3));
    // A rename/copy entry is followed by its source path.
    if (t[0] === "R" || t[0] === "C") i += 1;
  }
  return paths;
}

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/i;
const RELATIVE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\bvi\.mock\s*\(\s*|\bjest\.mock\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g;

/** The paths a test file's relative imports resolve to, read from its bytes at `head`. */
async function testImports(runner: GitRunner, cwd: string, rel: string, absPath: string, head: string): Promise<string[]> {
  const content = await gitExec(runner, cwd, ["cat-file", "blob", `${head}:${rel}`]);
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
      const current = (await gitExec(runner, repo, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
      // The TARGET ref: the named branch (pushed / PR'd by ref), else the checkout. A named ref
      // that IS the checkout reads as HEAD, so its working tree still counts.
      const asked = opts?.ref?.trim() || "HEAD";
      const head = asked === "HEAD" || asked === current ? "HEAD" : asked;
      const target = head === "HEAD" ? current : head;
      const upstream = (await gitExec(runner, repo, ["rev-parse", "--abbrev-ref", head === "HEAD" ? "@{u}" : `${head}@{u}`])).trim();
      const baseBranch = upstream !== "" && target === upstream.split("/").pop();
      const none = (unavailable: string): OutgoingChange => ({ files: [], diffHash: sha256(""), baseBranch, diff: "", unavailable });

      let against: string;
      if (opts?.pullRequest) {
        const ref = await pullRequestBaseRef(runner, repo, opts.pullRequest.base);
        if (!ref) return none("no pull-request base branch was found on origin, so the outgoing change could not be computed");
        against = ref;
      } else {
        if (!upstream) return none("the branch has no upstream, so the outgoing change could not be computed");
        against = head === "HEAD" ? "@{u}" : `${head}@{u}`;
      }
      const base = (await gitExec(runner, repo, ["merge-base", against, head])).trim();
      if (!base) return none(`no merge-base with ${against}, so the outgoing change could not be computed`);

      const rels = await outgoingPaths(runner, repo, base, head);
      if (!rels.length) {
        const empty = none(`no outgoing commits against ${against}`);
        // merge-base == the ref's commit ⇒ it is already on `against`: computable and empty, not "cannot compute".
        const sha = (await gitExec(runner, repo, ["rev-parse", head])).trim();
        if (!sha || sha !== base) return empty;
        const uncommitted = head === "HEAD" ? (await uncommittedPaths(runner, repo)).map((rel) => `${repo}/${rel}`.replace(/\\/g, "/")) : [];
        return { ...empty, upToDate: { head: sha, upstream: opts?.pullRequest ? against : upstream, ref: asked, uncommitted } };
      }
      const diffText = await gitExec(runner, repo, ["diff", "--binary", `${base}..${head}`]);
      const dirty = await dirtyPaths(runner, repo, head);

      const files: OutgoingFile[] = [];
      for (const rel of rels) {
        const absPath = `${repo}/${rel}`.replace(/\\/g, "/");
        const hash = await headHash(runner, repo, rel, head);
        const file: OutgoingFile = { absPath, hash: hash ?? "", isNew: await isNew(runner, repo, rel, base), deleted: hash === null };
        if (hash !== null && dirty.has(rel)) {
          file.unavailable = "also modified in the working tree, so the pushed bytes could not be checked (commit or stash the edit)";
        }
        if (hash !== null && TEST_FILE.test(rel)) {
          const imports = await testImports(runner, repo, rel, absPath, head);
          if (imports.length) file.imports = imports;
        }
        files.push(file);
      }
      // `diff` is the exact text `diffHash` hashes: the reviewer reads it and hashes it the same way.
      return { files, diffHash: sha256(diffText), baseBranch, diff: diffText };
    },
    async onBaseBranch(repo: string, paths: readonly string[]): Promise<boolean> {
      // An unborn HEAD (no commits yet) is not on any branch.
      if (!(await gitExec(runner, repo, ["rev-parse", "--verify", "--quiet", "HEAD"])).trim()) return false;
      const branch = (await gitExec(runner, repo, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
      // The repo's default branch (its real base), else the conventional one. feature/x is never a base.
      const base =
        (await gitExec(runner, repo, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])).trim().replace(/^origin\//, "") ||
        (BASE_BRANCHES.has(branch) ? branch : "main");
      if (!branch || !BASE_BRANCHES.has(branch) && branch !== base) return false;
      // The base must actually exist on origin and CONTAIN HEAD (nothing unpushed on the base).
      const mergeBase = (await gitExec(runner, repo, ["merge-base", `origin/${base}`, "HEAD"])).trim();
      const head = (await gitExec(runner, repo, ["rev-parse", "HEAD"])).trim();
      if (!mergeBase || mergeBase !== head) return false;
      // The touched files must be byte-identical at HEAD, in the working tree, and on origin/<base>:
      // anything differing anywhere means the change did not fully land, or local edits unpushed it again.
      const diffTree = await gitExec(runner, repo, ["diff", "--quiet", `origin/${base}`, "HEAD", "--", ...paths]);
      const diffWt = await gitExec(runner, repo, ["diff", "--quiet", "HEAD", "--", ...paths]);
      const untracked = await runner(["ls-files", "--others", "--exclude-standard", "--", ...paths], { cwd: repo });
      return !diffTree && !diffWt && untracked.exitCode === 0 && !untracked.stdout.trim();
    },
  };
}

/** The conventional base branches; `main` is the fallback when origin's default is unreadable. */
const BASE_BRANCHES = new Set(["main", "master"]);
