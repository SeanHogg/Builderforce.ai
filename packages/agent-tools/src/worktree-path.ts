/**
 * THE worktree path convention: a branch's side-by-side worktree lives at `../<branch>-wt`
 * relative to the repository's TOP LEVEL, with every `/` in the branch name turned into `-`.
 *
 * `git_commit` with `branch` creates (or reuses) it there, `git_cleanup_merged` removes it from
 * there, and the `run_command` branch-switch refusal tells the model to create it there — so a
 * worktree made by following the refusal is one the cleanup can find. The cleanup script knows
 * the branch only at run time, so it spells the name in POSIX shell (`worktreeNameShell`);
 * `worktree-path.test.ts` pins that both spellings agree.
 */

/** The worktree directory's NAME for `branch` (it sits beside the repository's top level). */
export function worktreeNameFor(branch: string): string {
  return `${branch.replace(/\//g, "-")}-wt`;
}

/** The worktree path for `branch`, relative to the repository top level. */
export function worktreePathFor(branch: string): string {
  return `../${worktreeNameFor(branch)}`;
}

/** {@link worktreeNameFor} as a POSIX shell expression over the variable `branchVar` (no `$`). */
export function worktreeNameShell(branchVar: string): string {
  return `$(echo "$${branchVar}" | tr / -)-wt`;
}
