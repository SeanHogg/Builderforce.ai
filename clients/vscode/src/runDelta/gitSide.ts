/**
 * The git reads of a run delta for ONE repository root (PRD 41 §C1 step 2 and the `head-switched` edge case), through
 * agent-tools' git wrapper (`node-git-history` `runGit`, the one the knowledge fixes and history already use): arguments as an
 * array, so a path is never re-quoted for a shell, and a large blob fits its buffer.
 *
 * Every read answers `undefined` when git could not answer (no git, not a repository, an unknown commit); none throws.
 */

import { runGit } from "@builderforce/agent-tools/node-git-history";

/** The git side of one repository: what a delta asks of its history. */
export interface RepoGit {
  /** Which of `paths` exist (as blobs) in `commit`; undefined when git could not answer. */
  pathsAt(commit: string, paths: readonly string[]): Promise<Set<string> | undefined>;
  /** A blob's text at `commit`; undefined when git could not read it. */
  show(commit: string, path: string): Promise<string | undefined>;
  /** HEAD's commit and its branch (undefined branch: detached). */
  head(): Promise<{ commit?: string; branch?: string }>;
  /** Whether `ancestor` is an ancestor of (or equal to) `commit`; undefined when git could not answer. */
  isAncestor(ancestor: string, commit: string): Promise<boolean | undefined>;
}

const LS_TREE_CHUNK = 200;

export function repoGit(root: string): RepoGit {
  return {
    async pathsAt(commit, paths) {
      const found = new Set<string>();
      for (let i = 0; i < paths.length; i += LS_TREE_CHUNK) {
        const chunk = paths.slice(i, i + LS_TREE_CHUNK);
        const out = await runGit(root, ["ls-tree", "-z", "--name-only", commit, "--", ...chunk]);
        if (out.stdout === undefined) return undefined;
        for (const name of out.stdout.split("\0")) if (name) found.add(name);
      }
      return found;
    },
    async show(commit, path) {
      return (await runGit(root, ["show", `${commit}:${path}`])).stdout;
    },
    async head() {
      const commit = (await runGit(root, ["rev-parse", "HEAD"])).stdout?.trim() || undefined;
      const branch = (await runGit(root, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout?.trim();
      return { ...(commit ? { commit } : {}), ...(branch && branch !== "HEAD" ? { branch } : {}) };
    },
    async isAncestor(ancestor, commit) {
      const out = await runGit(root, ["merge-base", "--is-ancestor", ancestor, commit]);
      if (out.stdout !== undefined) return true;
      // Exit 1 is "not an ancestor"; anything else (an unknown commit) git could not answer. The wrapper reports both as
      // `error`, so a second question tells them apart: does git know both commits?
      const known = await runGit(root, ["cat-file", "-e", `${ancestor}^{commit}`]);
      const knownHead = await runGit(root, ["cat-file", "-e", `${commit}^{commit}`]);
      return known.stdout !== undefined && knownHead.stdout !== undefined ? false : undefined;
    },
  };
}

/**
 * C1 `head-switched`: HEAD moved to another branch AND the baseline commit is not in its history. A run's own commits (or a
 * new branch cut from the baseline) keep the delta comparable. Unknown (no git) is not a switch.
 */
export async function headSwitched(git: RepoGit, baseline: { baseCommit?: string; branch?: string }): Promise<boolean> {
  if (!baseline.baseCommit) return false;
  const head = await git.head();
  if (!head.commit || head.commit === baseline.baseCommit) return false;
  if ((head.branch ?? "") === (baseline.branch ?? "")) return false;
  return (await git.isAncestor(baseline.baseCommit, head.commit)) === false;
}
