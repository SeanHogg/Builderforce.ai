/**
 * skipDirs.ts — THE directory names no workspace walk descends into: build output,
 * dependencies, VCS stores and tool caches. One list for the definition index
 * (`node-symbols.ts`) and every knowledge review walker — the editor's and on-prem's
 * (`knowledge/fsDirectorySource.ts`) and the browser's (`@builderforce/knowledge-browser`)
 * — so the same folder gives the same graph on every host. Pure.
 */

export const WORKSPACE_SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules", ".git", ".hg", ".svn", "dist", "build", "out", ".next", "coverage", ".turbo", ".vercel", ".cache",
  "target", "vendor", ".venv", "venv", "__pycache__", ".idea", ".vscode-test",
]);
