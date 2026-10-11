/**
 * Directories no repo scanner walks: build output, dependencies, caches — and
 * `.claude`, whose `worktrees/` holds whole agent checkouts of this repo. A
 * worktree is its own checkout and runs its own guards; walking it from here
 * reports its stale relative `paths` as this tree's drift.
 */
export const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'build', '.next', '.git', '.vscode-test', 'coverage', '.claude']);
