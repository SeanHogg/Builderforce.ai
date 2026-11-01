/**
 * A damaged `local-first-v3.journal` (a frame failed its checksum with committed bytes behind
 * it, or the newest compacted base never closed) is never truncated: it is copied aside whole,
 * then the store is rebuilt from v2 or the open is refused. A torn tail is NOT this — it is cut
 * and recovered as before (`localFirstJournalIo.ts`).
 */

import nodeFs from "node:fs";
import nodePath from "node:path";

const fs = nodeFs.promises;

/** Stable name for a journal that exists but cannot be trusted and has no v2 to rebuild from. */
export const LOCAL_FIRST_STORE_CORRUPT = "local_first_store_corrupt";

/** Thrown after the damaged journal has been copied aside. `message` names where. */
export class LocalFirstStoreCorruptError extends Error {
  readonly recoveryPath: string;
  constructor(recoveryPath: string) {
    super(`${LOCAL_FIRST_STORE_CORRUPT}: ${recoveryPath}`);
    this.name = LOCAL_FIRST_STORE_CORRUPT;
    this.recoveryPath = recoveryPath;
  }
}

/**
 * Copy the journal to `<journal>.corrupt-<timestamp>`, byte for byte. A copy already holding
 * exactly these bytes is reused, so retrying a refused open does not fill the disk.
 */
export async function quarantineJournal(journalFile: string, timestamp: number = Date.now()): Promise<string> {
  const original = await fs.readFile(journalFile);
  const directory = nodePath.dirname(journalFile);
  const prefix = `${nodePath.basename(journalFile)}.corrupt-`;
  for (const name of await fs.readdir(directory)) {
    if (!name.startsWith(prefix)) continue;
    const existing = nodePath.join(directory, name);
    try {
      if ((await fs.stat(existing)).size === original.byteLength && (await fs.readFile(existing)).equals(original)) return existing;
    } catch {
      // A copy we cannot read is not a match.
    }
  }
  const copy = `${journalFile}.corrupt-${timestamp}`;
  // Durable before compaction replaces the original: the copy may be the only whole record left.
  const handle = await fs.open(copy, "wx");
  try {
    await handle.write(original, 0, original.byteLength, 0);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return copy;
}
