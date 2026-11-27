/**
 * Writes the JSON snapshot cache (`local-first-v1.json`) through `writeFileAtomically`: temp file
 * written and FSYNCED, then `renameDurably`, the temp removed on any failure. The fsync comes
 * first so a crash cannot leave a renamed, empty cache.
 * No `vscode` import.
 */

import nodeFs from "node:fs";
import nodePath from "node:path";
import type { LocalFirstSnapshot } from "@builderforce/local-first";
import { writeFileAtomically } from "./localFirstAtomicFile";

const fs = nodeFs.promises;

export async function writeSnapshotCache(snapshotFile: string, snapshot: LocalFirstSnapshot): Promise<void> {
  await fs.mkdir(nodePath.dirname(snapshotFile), { recursive: true });
  await writeFileAtomically(snapshotFile, JSON.stringify(snapshot));
}
