/**
 * skipDirs.ts — THE directory names no workspace walk descends into: build output,
 * dependencies, VCS stores and tool caches. One list for the definition index
 * (`node-symbols.ts`) and every knowledge review walker — the editor's and on-prem's
 * (`knowledge/fsDirectorySource.ts`) and the browser's (`@builderforce/knowledge-browser`)
 * — so the same folder gives the same graph on every host. Pure.
 */

/** Version-control stores. */
const VCS_DIRS: readonly string[] = [".git", ".hg", ".svn"];

/** Installed-dependency and language-environment directories (never a workspace's own files, wherever they sit). */
const DEPENDENCY_DIRS: readonly string[] = ["node_modules", ".pnpm-store", ".venv", "venv", ".tox", "__pycache__"];

/** Version-control and dependency/environment directory names: safe to match ANYWHERE in an absolute path, because no project lives inside one (a build-output name like `out` or `build` can be a parent folder, so it is not in this set). */
const DEPENDENCY_AND_VCS_DIRS: ReadonlySet<string> = new Set([...VCS_DIRS, ...DEPENDENCY_DIRS]);

/** Whether `name` is a VCS store or an installed-dependency / language-environment directory. */
export const isDependencyDirName = (name: string): boolean => DEPENDENCY_AND_VCS_DIRS.has(name);

/** Build, dependency, VCS and cache OUTPUT directories: what a snapshot walk that must see every user-edited file still skips. */
export const OUTPUT_DIRS: ReadonlySet<string> = new Set([
  ...DEPENDENCY_AND_VCS_DIRS, ".next", ".nuxt", ".svelte-kit", ".wrangler", ".output", ".gradle", "dist", "build", "out", ".cache", ".turbo", ".vercel", "coverage", ".vscode-test",
]);

/** Whether `name` is a build/dependency/VCS output directory. */
export const isOutputDirName = (name: string): boolean => OUTPUT_DIRS.has(name);

/** {@link OUTPUT_DIRS} plus the directories not worth indexing (vendored code, target, IDE state). */
export const WORKSPACE_SKIP_DIRS: ReadonlySet<string> = new Set([...OUTPUT_DIRS, "vendor", "target", ".idea"]);

/**
 * Compiled-output names (.NET / Java `bin`, `obj`) that are ALSO real source folders in other
 * ecosystems (a JS package's `bin/` holds its CLI), so no walk skips them; only a CLASSIFIER
 * ("is this generated?", evidence sampling) treats them as generated, via {@link isGeneratedDirName}.
 */
const COMPILED_OUTPUT_DIRS: ReadonlySet<string> = new Set(["bin", "obj"]);

/** Whether a classifier (not a walk) reads a directory called `name` as generated or vendored: any {@link WORKSPACE_SKIP_DIRS} entry or a compiled-output folder. */
export const isGeneratedDirName = (name: string): boolean => WORKSPACE_SKIP_DIRS.has(name) || COMPILED_OUTPUT_DIRS.has(name);

/**
 * Whether a `/` or `\` separated `path` lies inside a directory `isSkipped` accepts (default: a
 * {@link WORKSPACE_SKIP_DIRS} name; pass {@link isOutputDirName} to skip only build output and
 * dependencies), at any depth. The last segment is the file, not a directory, so it is not
 * tested. Directory names are lower-cased first, like the import/evidence rules this replaced.
 */
export function isInSkippedDir(path: string, isSkipped: (dirName: string) => boolean = (name) => WORKSPACE_SKIP_DIRS.has(name)): boolean {
  const segments = path.split(/[\\/]+/);
  for (let i = 0; i < segments.length - 1; i++) if (isSkipped((segments[i] ?? "").toLowerCase())) return true;
  return false;
}

/** The one hidden directory an index walk still enters: CI workflows and issue templates are source worth indexing. */
const INDEXED_DOT_DIR = ".github";

/**
 * Hidden directories a FILE LISTING still shows (`list_files`), so an agent can edit workflows,
 * editor settings and tool config. Indexing and search skip them; listing does not.
 */
export const LIST_CONFIG_DOT_DIRS: ReadonlySet<string> = new Set([
  ".github", ".vscode", ".devcontainer", ".husky", ".changeset", ".claude", ".cursor",
]);


const VCS_METADATA_NAMES: ReadonlySet<string> = new Set(VCS_DIRS);

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

/** Whether an INDEX / SEARCH / ANALYSIS walk enters a directory called `name`: not skipped (by `skipDirs`, default {@link WORKSPACE_SKIP_DIRS}), and not a hidden directory other than `.github`. */
export function isIndexedDirName(name: string, skipDirs: ReadonlySet<string> = WORKSPACE_SKIP_DIRS): boolean {
  return !isSkippedDirName(name, skipDirs) && (!name.startsWith(".") || name === INDEXED_DOT_DIR);
}

/** Whether a FILE LISTING (`list_files`) enters a directory called `name`: not skipped, and not a hidden directory outside {@link LIST_CONFIG_DOT_DIRS}. */
export function isListedDirName(name: string): boolean {
  return !isSkippedDirName(name) && (!name.startsWith(".") || LIST_CONFIG_DOT_DIRS.has(name));
}
