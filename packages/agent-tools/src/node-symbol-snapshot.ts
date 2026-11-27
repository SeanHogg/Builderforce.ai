/**
 * How the definition index's snapshot reaches the disk: read from its location (else, once,
 * from a legacy one), written atomically (a temp file, then a rename — `writeIndexAtomic`)
 * into a gitignored directory, and the legacy copies deleted after the first successful
 * write so nothing writes the old places again. Layout: `node-index-layout.ts`.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import * as path from "node:path";
import { writeIndexAtomic } from "./knowledge/index/persistence.js";
import { ensureIgnoredDir, nodeIndexFiles } from "./node-index-layout.js";

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

/** Write `json` to `cachePath` atomically, then retire the legacy copies. Throws when the directory is not gitignorable or the write fails. */
export async function writeSnapshotText(cachePath: string, legacyCachePaths: readonly string[], json: string): Promise<void> {
  const dir = path.dirname(cachePath);
  await mkdir(dir, { recursive: true });
  await ensureIgnoredDir(dir);
  await writeIndexAtomic(nodeIndexFiles, cachePath, new TextEncoder().encode(json), randomUUID().replace(/-/g, ""));
  for (const legacy of legacyCachePaths) await rm(legacy, { force: true }).catch(() => undefined);
}
