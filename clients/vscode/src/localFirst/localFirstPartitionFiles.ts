/**
 * Partition file I/O (AE-G031): reading a partition up to its pointer, appending a commit's frame,
 * folding a file for compaction, and removing the generations no pointer names. A partition file is
 * a standard journal (same frames, same codec); only its rows live in it.
 *
 * Two failures, kept apart because they are handled apart:
 *   - `PartitionMissingError`: the file is gone or locked (ENOENT/EPERM/EACCES/EBUSY). Another window
 *     compacted and deleted this generation, or a scanner holds it. NEVER damage: the caller refreshes
 *     the main journal (the pointer has moved) and reads again.
 *   - `PartitionDamagedError`: the file is there and what it holds is not what its pointer says.
 */

import nodeFs from "node:fs";
import type { FileHandle } from "node:fs/promises";
import nodePath from "node:path";
import {
  readJournalTail,
  scanJournalStateAsync,
  type LocalFirstDelta,
  type LocalFirstSnapshot,
  type PartitionPointer,
} from "@builderforce/local-first";
import { writeWhole } from "./localFirstAtomicFile";
import { yieldToEventLoop } from "./localFirstJournalIo";
import { PARTITIONS_DIR, partitionRelativePath } from "./localFirstPartitionNames";

const fs = nodeFs.promises;

export class PartitionMissingError extends Error {
  /** ENOENT: the file is gone (a compaction deleted it, or it is lost). Anything else (EPERM, EBUSY, EACCES) is a lock that will pass. */
  readonly gone: boolean;
  constructor(readonly file: string, cause: unknown) {
    super(`local_first_partition_unavailable: ${file}: ${(cause as Error)?.message ?? String(cause)}`);
    this.gone = (cause as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
  }
}

export class PartitionDamagedError extends Error {
  constructor(readonly file: string, reason: string) {
    super(`local_first_partition_damaged: ${file}: ${reason}`);
  }
}

const UNAVAILABLE = new Set(["ENOENT", "EPERM", "EACCES", "EBUSY"]);

/** `[from, to)` of a partition file. A short file is damage (its pointer promised more). */
export async function readRange(path: string, from: number, to: number): Promise<Buffer> {
  let handle: FileHandle;
  try {
    handle = await fs.open(path, "r");
  } catch (error) {
    if (UNAVAILABLE.has((error as NodeJS.ErrnoException).code ?? "")) throw new PartitionMissingError(path, error);
    throw error;
  }
  try {
    const bytes = Buffer.alloc(Math.max(0, to - from));
    let read = 0;
    while (read < bytes.length) {
      const { bytesRead } = await handle.read(bytes, read, bytes.length - read, from + read);
      if (bytesRead === 0) throw new PartitionDamagedError(path, `holds ${from + read} bytes, its pointer says ${to}`);
      read += bytesRead;
    }
    return bytes;
  } catch (error) {
    if (error instanceof PartitionDamagedError) throw error;
    if (UNAVAILABLE.has((error as NodeJS.ErrnoException).code ?? "")) throw new PartitionMissingError(path, error);
    throw error;
  } finally {
    await handle.close();
  }
}

const bytesOf = (buffer: Buffer): Uint8Array => new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

/** The partition's rows as a snapshot (every frame up to `length`). Throws on damage. */
export async function foldPartitionFile(path: string, length: number): Promise<LocalFirstSnapshot | undefined> {
  if (length === 0) return undefined;
  const scan = await scanJournalStateAsync(bytesOf(await readRange(path, 0, length)), yieldToEventLoop);
  if (scan.corrupt || scan.committedBytes !== length || !scan.state) {
    throw new PartitionDamagedError(path, `frames end at ${scan.committedBytes} of ${length} bytes${scan.corrupt ? ` (${scan.corrupt})` : ""}`);
  }
  return scan.state.view();
}

/**
 * What `PartitionLoader.load` returns: the rows of the file up to `pointer.length`, or only what was
 * appended after `from` (the same file and generation). Rows come back as `records` and `deletedRecords`.
 */
export async function loadPartition(
  path: string,
  pointer: PartitionPointer,
  from?: { file: string; length: number },
): Promise<LocalFirstDelta> {
  if (!from) {
    const folded = await foldPartitionFile(path, pointer.length);
    return { records: folded?.records ?? [] };
  }
  const bytes = await readRange(path, from.length, pointer.length);
  const tail = readJournalTail(bytesOf(bytes));
  if (tail.needsReload || tail.damaged || tail.consumedBytes !== bytes.length) {
    throw new PartitionDamagedError(path, `the frames between ${from.length} and ${pointer.length} do not parse`);
  }
  // Fold the frames in order: a row deleted and put again keeps both entries (the table deletes, then sets).
  const rows = new Map<string, NonNullable<LocalFirstDelta["records"]>[number]>();
  const deleted = new Map<string, NonNullable<LocalFirstDelta["deletedRecords"]>[number]>();
  for (const delta of tail.deltas) {
    for (const gone of delta.deletedRecords ?? []) {
      rows.delete(gone.id);
      deleted.set(gone.id, gone);
    }
    for (const row of delta.records ?? []) rows.set(row.id, row);
  }
  return { records: [...rows.values()], deletedRecords: [...deleted.values()] };
}

/** Make a directory entry durable. Windows cannot open a directory: that is not a failure. */
export async function fsyncDirectory(directory: string): Promise<void> {
  try {
    const handle = await fs.open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    // A platform that cannot open a directory (Windows) is not a failure; anything else is.
    if (!NO_DIRECTORY_HANDLE.has((error as NodeJS.ErrnoException).code ?? "")) throw error;
  }
}

const NO_DIRECTORY_HANDLE = new Set(["EISDIR", "EPERM", "EACCES", "EINVAL", "ENOTSUP"]);

/**
 * Append one frame at `from` (the caught-up POINTER, never a length this process tracked): anything past
 * it is a leftover of a commit that never reached the main journal, and is cut. Written and fsynced
 * before it returns; a new file also gets its directory fsynced. Returns the file's new length.
 */
export async function appendPartitionFrame(directory: string, file: string, frame: Uint8Array, from: number, created: boolean): Promise<number> {
  const path = nodePath.join(directory, file);
  await fs.mkdir(nodePath.dirname(path), { recursive: true });
  const handle = await fs.open(path, nodeFs.constants.O_RDWR | nodeFs.constants.O_CREAT);
  try {
    const size = (await handle.stat()).size;
    if (size < from) throw new PartitionDamagedError(path, `holds ${size} bytes, its pointer says ${from}`);
    if (size !== from) await handle.truncate(from);
    try {
      await writeWhole(handle, frame, from);
      await handle.sync();
    } catch (error) {
      await handle.truncate(from).catch(() => undefined);
      throw error;
    }
  } finally {
    await handle.close();
  }
  if (created) {
    await fsyncDirectory(nodePath.dirname(path));
    await fsyncDirectory(directory);
  }
  return from + frame.byteLength;
}

/** The `.journal` files in the partitions directory (never temps), by relative path. */
export async function listPartitionFiles(directory: string): Promise<string[]> {
  try {
    return (await fs.readdir(nodePath.join(directory, PARTITIONS_DIR)))
      .filter((name) => name.endsWith(".journal"))
      .map(partitionRelativePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/**
 * Remove every partition file no pointer names. UNDER THE LOCK ONLY: with the lock held no commit is in
 * flight, so a file nothing names is a leftover (a compaction published past its main frame, a failed first
 * commit, a migration that never renamed). A reader that still holds an old generation gets ENOENT and
 * retries against the new pointer. A file that will not go stays for the next pass, and is REPORTED.
 */
export async function removeUnreferencedPartitions(directory: string, referenced: ReadonlySet<string>, onError: (error: unknown) => void): Promise<number> {
  let removed = 0;
  for (const file of await listPartitionFiles(directory)) {
    if (referenced.has(file)) continue;
    try {
      await fs.rm(nodePath.join(directory, file), { force: true });
      removed += 1;
    } catch (error) {
      onError(error);
    }
  }
  return removed;
}

/**
 * Set aside every partition file no pointer names, instead of deleting it: a v4 journal that was quarantined
 * can leave partitions that hold the only copy of real messages. Renamed `<file>.orphaned-<time>` (no longer
 * a `.journal`, so nothing reads or lists it). Returns the names set aside.
 */
export async function setAsideUnreferencedPartitions(directory: string, referenced: ReadonlySet<string>): Promise<string[]> {
  const aside: string[] = [];
  for (const file of await listPartitionFiles(directory)) {
    if (referenced.has(file)) continue;
    const target = `${file}.orphaned-${Date.now()}`;
    await fs.rename(nodePath.join(directory, file), nodePath.join(directory, target));
    aside.push(target);
  }
  return aside;
}
