/**
 * Everything the VSIX store reads from, or cleans up after, its PREVIOUS file formats.
 *
 * The record is `local-first-v3.journal`. Two older things can exist beside it:
 *
 *   - `local-first-v2.journal` — one whole-snapshot frame per commit. Imported ONCE, into v3,
 *     and never written again: a rollback to the previous VSIX still finds it whole.
 *   - `local-first-v1.json`   — the snapshot cache. Once v2 is imported it is renamed
 *     `local-first-v1.json.pre-v3` so a 70 MB file is never parsed again; afterwards it is
 *     written only by `flush()`.
 *
 * Plus the temp files an interrupted write leaves behind (`removeOrphanedTemporaries`).
 * Nothing here takes the store lock: the caller decides when it is safe to import.
 */

import nodeFs from "node:fs";
import nodePath from "node:path";
import { scanJournalAsync, type LocalFirstSnapshot } from "@builderforce/local-first";
import { LEGACY_JOURNAL_FILE } from "./localFirstJournalIo";
import { planSnapshotLoad } from "./localFirstSnapshotFile";

const fs = nodeFs.promises;

/** A cache file this large is never parsed just to check it for corruption. */
const CACHE_CHECK_MAX_BYTES = 4 * 1024 * 1024;
/** A temp file this old belongs to a write that was cut off, not one in flight. */
const ORPHAN_MIN_AGE_MS = 60 * 60 * 1000;

export const PRE_V3_SUFFIX = ".pre-v3";

const exists = async (path: string): Promise<boolean> => {
  try {
    await fs.stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
};

/** True when v2 or the snapshot cache is there to import from. */
export async function hasLegacyState(directory: string, snapshotFile: string): Promise<boolean> {
  return (await exists(nodePath.join(directory, LEGACY_JOURNAL_FILE))) || (await exists(snapshotFile));
}

/** v2's latest committed snapshot. Reads the file; never writes it. */
export async function readLegacyJournal(directory: string, pause: () => Promise<void>): Promise<LocalFirstSnapshot | undefined> {
  let raw: Buffer;
  try {
    raw = await fs.readFile(nodePath.join(directory, LEGACY_JOURNAL_FILE));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  if (raw.byteLength === 0) return undefined;
  return (await scanJournalAsync(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength), pause)).latest;
}

/**
 * The snapshot cache as a legacy import. The cache is not the record, so a corrupt copy is
 * MOVED aside — kept whole, exportable — and the open continues; throwing would fail every
 * later open too, locking the person out of their store over a cache file.
 */
export async function readSnapshotCache(snapshotFile: string): Promise<LocalFirstSnapshot | undefined> {
  let text: string;
  try {
    text = await fs.readFile(snapshotFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const plan = planSnapshotLoad(text, snapshotFile, Date.now());
  if (plan.action === "preserve") {
    await fs.rename(snapshotFile, plan.recoveryPath);
    return undefined;
  }
  return plan.snapshot;
}

/**
 * When the journal already holds the store, the cache is only checked for corruption —
 * and only when it is small. A big cache (flush writes the whole store) is not worth
 * parsing on every open for a check the journal makes unnecessary.
 */
export async function checkSnapshotCache(snapshotFile: string): Promise<void> {
  try {
    if ((await fs.stat(snapshotFile)).size > CACHE_CHECK_MAX_BYTES) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  await readSnapshotCache(snapshotFile);
}

/** `local-first-v1.json` → `local-first-v1.json.pre-v3`: imported, so never parsed again. */
export async function retireSnapshotCache(snapshotFile: string): Promise<void> {
  try {
    await fs.rename(snapshotFile, `${snapshotFile}${PRE_V3_SUFFIX}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/** Exactly the temp names this store's writers use — nothing else in the directory is touched. */
const ORPHAN_PATTERNS: readonly RegExp[] = [
  /^local-first-v1\.json\.\d+\.\d+(\.[a-z0-9]+)?\.tmp$/,
  /^local-first-v1\.lock\..+\.tmp$/,
  /^local-first-v[23]\.journal\.\d+\.\d+(\.[a-z0-9]+)?\.tmp$/,
  /^local-first-v3\.import\.json\.\d+\.\d+\.tmp$/,
];

/**
 * Remove temp files an interrupted write left in the store directory, once they are old
 * enough to be nobody's in-flight write. Best effort: a file that will not go is ignored.
 */
export async function removeOrphanedTemporaries(directory: string, now: number = Date.now()): Promise<void> {
  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch {
    return;
  }
  await Promise.all(names.filter((name) => ORPHAN_PATTERNS.some((pattern) => pattern.test(name))).map(async (name) => {
    const path = nodePath.join(directory, name);
    try {
      if (now - (await fs.stat(path)).mtimeMs < ORPHAN_MIN_AGE_MS) return;
      await fs.rm(path, { force: true });
    } catch {
      // A temp file we cannot stat or remove is left for the next open.
    }
  }));
}
