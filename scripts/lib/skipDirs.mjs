/**
 * Directories no repo scanner walks: build output, dependencies, caches — and
 * `.claude` and `.builderforce`, whose `worktrees/` hold whole agent checkouts of this
 * repo (Claude Code's, and the VS Code agent's per PRD 35 §5.2). A worktree is its own
 * checkout and runs its own guards; walking it from here reports its relative `paths`
 * as this tree's drift.
 */
export const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'build', '.next', '.git', '.vscode-test', 'coverage', '.claude', '.builderforce']);
