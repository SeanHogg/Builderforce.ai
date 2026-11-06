/**
 * Path safety for the fix flow's file operations (restore, delete): a path is a root-relative
 * name with no way out, and before anything is touched its parent chain must be REAL directories
 * inside the root - a symlink or a junction anywhere in it refuses the operation, so an undo can
 * never reach a file outside the folder through a link.
 */

import { lstat, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";

import { isSafeRelative } from "./safePath";

export { isSafeRelative };

/** A path the fix flow refused to touch. English here so this module stays free of the editor; the session words it through `fixText` (`code`, `path`). */
export class PathRefusal extends Error {
  constructor(readonly code: "outside" | "link" | "isLink", readonly path: string) {
    super(code === "outside" ? `"${path}" is outside the folder, so nothing was changed.` : code === "link" ? `"${path}" is reached through a link, so nothing was changed.` : `"${path}" is a link, so nothing was changed.`);
    this.name = "PathRefusal";
  }
}

const same = (a: string, b: string): boolean => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);

/**
 * Refuses a path unless it is safe, each directory of its parent chain (as far as it exists) is
 * a real directory under the real root (no link of any kind), and the path itself is not a link.
 */
export async function assertInsideRoot(root: string, rel: string): Promise<void> {
  if (!isSafeRelative(rel)) throw new PathRefusal("outside", rel);
  const realRoot = await realpath(root);
  let current = realRoot;
  for (const segment of dirname(rel.replace(/\\/g, "/")).split("/").filter((s) => s !== "" && s !== ".")) {
    const next = join(current, segment);
    let real: string;
    try {
      real = await realpath(next);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return; // nothing below exists yet, so nothing below is a link
      throw error;
    }
    if (!same(real, next)) throw new PathRefusal("link", rel);
    current = next;
  }
  try {
    if ((await lstat(join(current, rel.replace(/\\/g, "/").split("/").pop()!))).isSymbolicLink()) throw new PathRefusal("isLink", rel);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
