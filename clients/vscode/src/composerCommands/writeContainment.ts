/**
 * The ONE check every composer-command write passes (`/starter-kit`, `/manifest init`):
 * a file is written only when it lies inside an open workspace folder, NO existing
 * component of its path below that folder is a symbolic link (a dangling one, or a
 * Windows junction, included), and the real path of its parent directory is inside the
 * folder's real path. A refused path is answered with an error that names it — never
 * skipped silently.
 *
 * Node `fs` only (no `vscode`), with the two calls it needs injectable for tests.
 */
import { lstat, realpath } from "node:fs/promises";
import * as path from "node:path";
import type { ComposerCommandText } from "./labels";
import type { ComposerReply } from "./reply";

export type WriteRefusalReason = "symlink" | "outside-folder";

export interface WriteRefusal {
  /** The absolute path that was refused. */
  file: string;
  reason: WriteRefusalReason;
}

/** Thrown by a port's `writeText` for a refused path; `dispatch.ts` words it (`text.writeRefused`). */
export class WriteRefusedError extends Error {
  constructor(readonly refusals: readonly WriteRefusal[]) {
    super(`refused to write ${refusals.map((refusal) => `${refusal.file} (${refusal.reason})`).join(", ")}`);
    this.name = "WriteRefusedError";
  }
}

/** The file-system calls the check makes. */
export interface ContainmentFs {
  lstat(file: string): Promise<{ isSymbolicLink(): boolean }>;
  realpath(file: string): Promise<string>;
}

const nodeFs: ContainmentFs = { lstat, realpath };

/** A Node `fs` rejection for a path that does not exist (or runs through a file). */
export const isMissingPath = (error: unknown): boolean => {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return code === "ENOENT" || code === "ENOTDIR";
};

/** Is `candidate` the directory `root` or below it? (`path.relative` compares case-insensitively on Windows.) */
function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Why `file` may not be written in the folder at `root`; undefined when it may. */
export async function writeRefusal(file: string, root: string, fs: ContainmentFs = nodeFs): Promise<WriteRefusalReason | undefined> {
  const base = path.resolve(root);
  const target = path.resolve(file);
  if (target === base || !within(base, target)) return "outside-folder";

  // Every existing component below the folder, the target itself included.
  let deepestExisting = base;
  let current = base;
  for (const segment of path.relative(base, target).split(path.sep)) {
    current = path.join(current, segment);
    let entry: { isSymbolicLink(): boolean };
    try {
      entry = await fs.lstat(current);
    } catch (error) {
      if (isMissingPath(error)) break; // the rest is created by the write
      throw error;
    }
    if (entry.isSymbolicLink()) return "symlink";
    deepestExisting = current;
  }

  // The parent's real path (its deepest existing ancestor's, plus what the write creates) inside the folder's.
  const parent = path.dirname(target);
  const existingAncestor = deepestExisting === target ? parent : deepestExisting;
  const realParent = path.join(await fs.realpath(existingAncestor), path.relative(existingAncestor, parent));
  return within(await fs.realpath(base), realParent) ? undefined : "outside-folder";
}

/** The refused files among `files`, each checked against the workspace folder that holds it. */
export async function refusedWrites(files: readonly string[], roots: readonly string[], fs: ContainmentFs = nodeFs): Promise<WriteRefusal[]> {
  const refusals: WriteRefusal[] = [];
  for (const file of files) {
    // The deepest folder holding the file (nested workspace folders: the inner one).
    const root = roots
      .filter((candidate) => within(path.resolve(candidate), path.resolve(file)))
      .sort((a, b) => b.length - a.length)[0];
    const reason = root === undefined ? "outside-folder" : await writeRefusal(file, root, fs);
    if (reason) refusals.push({ file, reason });
  }
  return refusals;
}

/** The reply for refused writes: every refused path, named. */
export function writeRefusedReply(text: ComposerCommandText, refusals: readonly WriteRefusal[]): ComposerReply {
  return { kind: "text", tone: "error", lines: [text.writeRefused(refusals.map((refusal) => refusal.file))] };
}
