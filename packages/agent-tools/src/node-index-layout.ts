/**
 * Where a workspace root keeps its LOCAL index files, in one place (platform duplication audit
 * §2.5.6). Every kind lives under `<root>/.builderforce/index/`, named by the SAME stem the
 * knowledge-card index uses (`rootFileStem(rootId)`, `.builderforce/knowledge/<stem>.idx`):
 *
 *   - `<stem>.idx`           the code-chunk index (`@seanhogg/builderforce-code-index`);
 *   - `<stem>.symbols.json`  the definition-index snapshot (`WorkspaceSymbolIndex`).
 *
 * A host passes the root id its knowledge index already uses (`vscode:…`, `onprem:…`); a headless
 * caller that has none gets {@link localRootId}. The index directory is gitignored (`*`): its
 * files hold generated source bodies and must never be committed.
 *
 * Node-only (node:fs), so it sits behind its own export; the knowledge barrel stays Worker-safe.
 */

import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { KnowledgeIndexFiles } from "./knowledge/index/contract.js";
import { rootFileStem, writeIndexAtomic } from "./knowledge/index/persistence.js";
import { folderIdOf, rootIdFor } from "./knowledge/rootId.js";

/** The host segment of the root id a caller without a host of its own is given. */
export const LOCAL_ROOT_HOST = "local";

const INDEX_DIR_PARTS = [".builderforce", "index"] as const;
const IGNORE_ALL = "*\n";

/** The root id of a workspace folder for a caller that has no host (`local:<hash of the path>`), by THE root-id rule. */
export function localRootId(root: string): string {
  return rootIdFor({ host: LOCAL_ROOT_HOST, folderId: folderIdOf(path.resolve(root)) });
}

/** `<root>/.builderforce/index`. */
export function localIndexDir(root: string): string {
  return path.join(root, ...INDEX_DIR_PARTS);
}

/** The file-safe stem every local index file of `root` is named by. */
export function localIndexStem(root: string, rootId?: string): string {
  return rootFileStem(rootId ?? localRootId(root));
}

/** `<root>/.builderforce/index/<stem>.idx` — the code-chunk index. */
export function codeIndexPath(root: string, rootId?: string): string {
  return path.join(localIndexDir(root), `${localIndexStem(root, rootId)}.idx`);
}

/** `<root>/.builderforce/index/<stem>.symbols.json` — the definition-index snapshot. */
export function symbolSnapshotPath(root: string, rootId?: string): string {
  return path.join(localIndexDir(root), `${localIndexStem(root, rootId)}.symbols.json`);
}

/** The two places a snapshot was written before this layout: read once, never written again. */
export function legacySymbolSnapshotPaths(root: string): string[] {
  return [path.join(root, ".builderforce", "symbols.json"), path.join(root, ".builderForceAgents", "symbols.json")];
}

/** A definition index's snapshot location: where it lives now, and where it used to live. */
export function symbolSnapshotLocation(root: string, rootId?: string): { cachePath: string; legacyCachePaths: string[] } {
  return { cachePath: symbolSnapshotPath(root, rootId), legacyCachePaths: legacySymbolSnapshotPaths(root) };
}

/** The disk, as the knowledge index's files (`writeIndexAtomic` and `readStoredIndex` run on it). */
export const nodeIndexFiles: KnowledgeIndexFiles = {
  async read(file) {
    try {
      return new Uint8Array(await readFile(file));
    } catch {
      return undefined;
    }
  },
  write: (file, bytes) => writeFile(file, bytes),
  rename: (from, to) => rename(from, to),
  mkdir: async (dir) => {
    await mkdir(dir, { recursive: true });
  },
  remove: (file) => rm(file, { force: true }),
};

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

/** The bytes of a regular file of at most `maxSize` bytes; undefined when absent, not a file, or larger. */
export async function readRegularFile(file: string, maxSize: number): Promise<Buffer | undefined> {
  try {
    const info = await lstat(file);
    return info.isFile() && info.size <= maxSize ? await readFile(file) : undefined;
  } catch (error) {
    if (missing(error)) return undefined;
    throw error;
  }
}

/** Receives a non-fatal index failure: what was being done, the file involved, and why it failed. */
export type IndexFailureSink = (failure: { what: string; file: string; error: unknown }) => void;

/** Report a non-fatal index failure (the index keeps working) to `sink`, else as a process warning naming the path and reason. */
export function reportIndexFailure(what: string, file: string, error: unknown, sink?: IndexFailureSink): void {
  if (sink) sink({ what, file, error });
  else process.emitWarning(`${what} (${file}): ${error instanceof Error ? error.message : String(error)}`);
}

/** Make `dir` a gitignored cache directory: write its `.gitignore` (`*`) when absent, and refuse a directory whose own is anything else. */
export async function ensureIgnoredDir(dir: string): Promise<void> {
  const ignore = path.join(dir, ".gitignore");
  await writeFile(ignore, IGNORE_ALL, { flag: "wx", mode: 0o600 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  if ((await readRegularFile(ignore, 1_024))?.toString("utf-8").trim() !== "*") {
    throw new Error("Index cache directory is not gitignored");
  }
}

/** The snapshot text from `cachePath`, else from the first legacy path that reads; undefined when none does. */
export async function readSnapshotText(cachePath: string, legacyCachePaths: readonly string[]): Promise<string | undefined> {
  for (const file of [cachePath, ...legacyCachePaths]) {
    try {
      return await readFile(file, "utf-8");
    } catch {
      /* try the next place */
    }
  }
  return undefined;
}

/**
 * Write `json` to `cachePath` atomically (`writeIndexAtomic`: a temp file, then a rename) into a
 * gitignored directory, then delete the legacy copies so nothing writes the old places again.
 * Throws when the directory cannot be gitignored or the write fails.
 */
export async function writeSnapshotText(cachePath: string, legacyCachePaths: readonly string[], json: string): Promise<void> {
  // The same guarded directory the code index uses (lstat, never a symlink), not a plain `mkdir -p`.
  await ensureIndexDirAt(path.dirname(cachePath));
  await writeIndexAtomic(nodeIndexFiles, cachePath, new TextEncoder().encode(json), randomUUID().replace(/-/g, ""));
  for (const legacy of legacyCachePaths) await rm(legacy, { force: true }).catch(() => undefined);
}

/** Create `<root>/.builderforce/index` (private, never a symlink) and gitignore it; returns it. */
export function ensureLocalIndexDir(root: string): Promise<string> {
  return ensureIndexDirAt(localIndexDir(root));
}

/** Create `directory` and its parent one level at a time (private, each lstat-checked as a real directory, never a symlink) and gitignore `directory`; returns it. Anything above the parent is the caller's own tree. */
export async function ensureIndexDirAt(directory: string): Promise<string> {
  await mkdir(path.dirname(path.dirname(directory)), { recursive: true });
  for (const dir of [path.dirname(directory), directory]) {
    await mkdir(dir, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    if (!(await lstat(dir)).isDirectory()) throw new Error("Index cache directory is unavailable");
  }
  await ensureIgnoredDir(directory);
  return directory;
}
