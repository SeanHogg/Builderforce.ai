/**
 * THE worktree path convention: a branch's side-by-side worktree lives at `../<branch>-wt`
 * relative to the repository's TOP LEVEL, with every `/` in the branch name turned into `-`.
 *
 * `git_commit` with `branch` creates (or reuses) it there, `git_cleanup_merged` removes it from
 * there, and the `run_command` branch-switch refusal tells the model to create it there — so a
 * worktree made by following the refusal is one the cleanup can find. The publish scripts
 * compute it in POSIX shell from a variable when the branch is only known at run time
 * (`worktreePathShell`); `worktree-path.test.ts` pins that both spellings agree.
 */

/** The worktree path for `branch`, relative to the repository top level. */
export function worktreePathFor(branch: string): string {
  return `../${branch.replace(/\//g, "-")}-wt`;
}

/** The same path as a POSIX shell expression over the variable `branchVar` (no `$`). */
export function worktreePathShell(branchVar: string): string {
  return `../$(echo "$${branchVar}" | tr / -)-wt`;
}
