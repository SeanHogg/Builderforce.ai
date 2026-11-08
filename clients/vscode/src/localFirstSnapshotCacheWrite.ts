/**
 * Writes the JSON snapshot cache (`local-first-v1.json`): temp file written and FSYNCED, then
 * `renameDurably` (the same Windows-safe rename every journal rewrite uses), the temp removed
 * on any failure. The fsync comes first so a crash cannot leave a renamed, empty cache.
 * No `vscode` import.
 */

import nodeFs from "node:fs";
import nodePath from "node:path";
import type { LocalFirstSnapshot } from "@builderforce/local-first";
import { renameDurably, temporaryPathFor } from "./localFirstAtomicFile";

const fs = nodeFs.promises;

export async function writeSnapshotCache(snapshotFile: string, snapshot: LocalFirstSnapshot): Promise<void> {
  const temporary = temporaryPathFor(snapshotFile);
  try {
    await fs.mkdir(nodePath.dirname(snapshotFile), { recursive: true });
    const handle = await fs.open(temporary, "wx");
    try {
      await handle.writeFile(JSON.stringify(snapshot), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await renameDurably(temporary, snapshotFile);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}
