/**
 * The workspace's CACHE folder — `.builderforce/cache/` — made git-ignored before anything
 * is written under it. ONE helper for every writer (the run-delta analyzer cache, the
 * before trees, a sub-agent's collected data): each used to write its own `*` ignore file.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

/** The cache folder, relative to the workspace root. */
export const CACHE_DIR = [".builderforce", "cache"] as const;

/**
 * Create `<root>/.builderforce/cache/<sub…>` and make sure `.builderforce/cache/.gitignore`
 * ignores everything in it. An existing ignore file is left alone (`wx`); any other write
 * failure is thrown — a cache that git would pick up must not be written silently.
 */
export async function ensureIgnoredCacheDir(root: string, ...sub: string[]): Promise<string> {
  const cache = path.join(root, ...CACHE_DIR);
  const dir = path.join(cache, ...sub);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(cache, ".gitignore"), "*\n", { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  return dir;
}
