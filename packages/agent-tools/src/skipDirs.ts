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


const VCS_METADATA_NAMES: ReadonlySet<string> = new Set([".git", ".hg", ".svn"]);

/** A version-control store's name (`.git`, `.hg`, `.svn`): never walked as a folder and never listed as a file (a `.git` FILE is a link to a store, not a source). */
export function isVcsMetadataName(name: string): boolean {
  return VCS_METADATA_NAMES.has(name);
}

/** Why a folder is left out of a review walk (reported, never silent). */
export type SkippedFolderReason = "nested-checkout" | "worktrees" | "local-state" | "vendored-src";

/** A folder a walk left out, root-relative, with the rule that left it out. */
export interface SkippedFolder {
  path: string;
  reason: SkippedFolderReason;
}

/** Directory-NAME rules no walk descends into: other tools' worktrees, `*.local` scratch/state, vendored `_*_src` trees. */
const SKIPPED_DIR_NAME_RULES: ReadonlyArray<readonly [RegExp, SkippedFolderReason]> = [
  [/^\.worktrees$/, "worktrees"],
  [/\.local$/, "local-state"],
  [/^_.+_src$/, "vendored-src"],
];

/** The rule that skips a directory called `name`, when one of the name rules does. */
export function skippedDirReason(name: string): SkippedFolderReason | undefined {
  return SKIPPED_DIR_NAME_RULES.find(([re]) => re.test(name))?.[1];
}

/** Whether a walk skips a directory called `name`: in `skipDirs` (default {@link WORKSPACE_SKIP_DIRS}) or matching a name rule. */
export function isSkippedDirName(name: string, skipDirs: ReadonlySet<string> = WORKSPACE_SKIP_DIRS): boolean {
  return skipDirs.has(name) || skippedDirReason(name) !== undefined;
}
