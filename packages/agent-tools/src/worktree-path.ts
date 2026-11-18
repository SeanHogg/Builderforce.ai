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

/** The exit code (and `DIRTY_WORKTREE <path>` sentinel) of a cleanup that found edits in the branch's worktree. */
export const DIRTY_WORKTREE_EXIT = 14;
/** The exit code (and `WORKTREE_KEPT <path>` sentinel) of a cleanup git would not remove the worktree for (locked, submodules). */
export const WORKTREE_KEPT_EXIT = 15;

/**
 * POSIX shell lines (run inside the repository, `set -e` safe) that FIND the convention's
 * worktree for the branch in `branchVar` (into `$WT_AT`, empty when none) and refuse when it has
 * uncommitted changes — the run_command refusal steers models to work there, so it is never
 * destroyed: the lines print `DIRTY_WORKTREE <path>` and exit {@link DIRTY_WORKTREE_EXIT}. Run
 * them BEFORE the cleanup changes anything, so a refusal leaves everything as it was. Paths are
 * compared PHYSICALLY: git lists a worktree by its resolved absolute path, never as the
 * `<top>/../<name>` it was added with, so both sides are resolved the same way first.
 */
export function checkConventionWorktreeShell(branchVar: string): string[] {
  return [
    `WT="$(cd "$(git rev-parse --show-toplevel)/.." && pwd -P)/${worktreeNameShell(branchVar)}"`,
    'WT_AT="$(git worktree list --porcelain 2>/dev/null | sed -n "s/^worktree //p" | while IFS= read -r W; do if [ "$(cd "$W" 2>/dev/null && pwd -P)" = "$WT" ]; then printf "%s\\n" "$W"; break; fi; done; true)"',
    `if [ -n "$WT_AT" ]; then [ -z "$(git -C "$WT_AT" status --porcelain 2>/dev/null)" ] || { echo "DIRTY_WORKTREE $WT_AT"; exit ${DIRTY_WORKTREE_EXIT}; }; fi`,
  ];
}

/** The line that removes the worktree {@link checkConventionWorktreeShell} found (clean: no `--force`); one git will not remove stops the script with `WORKTREE_KEPT <path>`. */
export function removeFoundWorktreeShell(): string {
  return `if [ -n "$WT_AT" ]; then git worktree remove "$WT_AT" 2>/dev/null || { echo "WORKTREE_KEPT $WT_AT"; exit ${WORKTREE_KEPT_EXIT}; }; fi`;
}
