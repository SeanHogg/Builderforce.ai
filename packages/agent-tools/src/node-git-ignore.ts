/**
 * `@builderforce/agent-tools/node-git-ignore` — the ONE answer to "is this workspace path
 * gitignored?" for every Node surface that walks a workspace and PERSISTS what it found.
 *
 * ## Why it exists
 *
 * The definition index (`node-symbols.ts` → `.builderforce/symbols.json`) and the editor's
 * codebase scan (`clients/vscode/src/codebaseScan.ts` → `project-map.md` / `scan.json`)
 * write their findings into the workspace's `.builderforce/` folder, which teams commit.
 * Walking the disk with only a hard-coded skip list put gitignored files into those
 * artifacts — the headings of an operator-only `*.local.md` security file ended up in a
 * committed `symbols.json` on a public repository. A file the repository refuses to track
 * must never reach an artifact the repository DOES track, so both walkers ask git.
 *
 * Git is the authority (nested `.gitignore`s, `.git/info/exclude`, the global excludes
 * file), so this shells out rather than re-implementing gitignore matching. Outside a git
 * repository, or with no `git` on PATH, nothing is ignored — the walkers' own skip lists
 * still apply, exactly as before.
 *
 * Two entry points, one per walker shape: a full walk loads the ignored set once
 * ({@link gitIgnoredMatcher}); an incremental refresh of a few watcher-reported files asks
 * about just those ({@link gitIgnoredSubset}), which also catches a file created since the
 * last full walk.
 */

import { spawn } from "node:child_process";

/** A full walk's verdict for a root-relative POSIX path (file or directory). */
export type GitIgnoredMatcher = (rel: string) => boolean;

const NOTHING_IGNORED: GitIgnoredMatcher = () => false;
const GIT_TIMEOUT_MS = 15_000;

/** Run git in `cwd`; resolves stdout on exit 0, or null on any failure (not a repo, no git, timeout). */
function runGit(cwd: string, args: readonly string[], input?: string, okCodes: readonly number[] = [0]): Promise<string | null> {
  return new Promise((resolve) => {
    // A missing `git` binary or cwd arrives as the 'error' event, not a throw.
    const child = spawn("git", args, { cwd, windowsHide: true, timeout: GIT_TIMEOUT_MS });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code !== null && okCodes.includes(code) ? Buffer.concat(chunks).toString("utf8") : null));
    child.stdin.end(input);
  });
}

function splitNul(out: string): string[] {
  return out.split("\0").filter(Boolean);
}

/**
 * Load the ignored set under `root` once and return a matcher for root-relative POSIX
 * paths. Wholly-ignored directories come back collapsed (`dist/`), so a path is ignored
 * when it, or any ancestor directory, is in the set.
 */
export async function gitIgnoredMatcher(root: string): Promise<GitIgnoredMatcher> {
  const out = await runGit(root, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"]);
  if (out === null) return NOTHING_IGNORED;
  const ignored = new Set(splitNul(out));
  if (ignored.size === 0) return NOTHING_IGNORED;
  return (rel) => {
    if (ignored.has(rel) || ignored.has(`${rel}/`)) return true;
    for (let i = rel.indexOf("/"); i !== -1; i = rel.indexOf("/", i + 1)) {
      if (ignored.has(rel.slice(0, i + 1))) return true;
    }
    return false;
  };
}

/** The subset of root-relative POSIX `rels` that git ignores. Tracked files are never ignored. */
export async function gitIgnoredSubset(root: string, rels: readonly string[]): Promise<Set<string>> {
  if (rels.length === 0) return new Set();
  // check-ignore exits 1 when NONE of the paths is ignored — a normal answer, not a failure.
  const out = await runGit(root, ["check-ignore", "--stdin", "-z"], `${rels.join("\0")}\0`, [0, 1]);
  return new Set(out === null ? [] : splitNul(out));
}
