/**
 * The VSIX store's journal file (`local-first-v3.journal`) over `node:fs` (G03).
 *
 * One frame per committed transaction — a `BFJF2` delta of the rows the commit changed,
 * from `@builderforce/local-first` — fsynced before the commit is acknowledged. What this
 * module adds over a naive append, and why:
 *
 *   - THE COMMITTED PREFIX IS TRACKED IN MEMORY. The offset where the committed frames
 *     end is known from the open and advanced by every append and every applied tail; a
 *     file longer than it has a torn tail, which is cut before the next frame lands (only
 *     ever by the lock holder — a lock-free reader never truncates).
 *   - ANOTHER WINDOW'S COMMIT IS A POSITIONAL TAIL READ. Every VS Code window shares this
 *     file. `readTail` reads from the tracked offset to EOF and returns the complete delta
 *     frames there; the store applies them and `advance`s. Only a different FILE (another
 *     window compacted: new inode/birth time) or a base frame in the tail forces a full
 *     `load`.
 *   - OPEN IS ASYNC AND CHUNKED. `load` reads the file and folds it with `scanJournalAsync`,
 *     giving the thread back between frames; a store of many small frames never blocks the
 *     host for more than one frame's work.
 *   - COMPACTION IS A STREAM. `compact` writes a sequence of bounded frames to a temp file,
 *     fsyncs, renames — never one multi-megabyte buffer. `publishCompacted` is the second
 *     half of the two-phase compaction: a pre-written temp is caught up, re-fsynced and
 *     renamed, so the cross-window lock is held for the catch-up + rename only, never for
 *     streaming the whole rewrite.
 *   - THE TAIL IS COUNTED. `tail()` is the commit frames and bytes since the last base, the
 *     figure the shared `shouldCompactJournal` policy is measured against.
 *
 * The file is `local-first-v3.journal`, not v2: v2 holds only `BFJF1` frames, and a window
 * still on an older VSIX that scanned a v3 file would stop at the first delta and then
 * TRUNCATE the file to that prefix on its next append. A new name keeps old windows away.
 * No `vscode` import.
 */

import nodeFs from "node:fs";
import type { FileHandle } from "node:fs/promises";
import nodePath from "node:path";
import {
  readJournalTail,
  scanJournalAsync,
  type JournalOpenScan,
  type LocalFirstDelta,
  type LocalFirstSnapshot,
} from "@builderforce/local-first";
import { LocalFirstStoreCorruptError } from "./localFirstCorruption";

const fs = nodeFs.promises;

export const JOURNAL_FILE = "local-first-v3.journal";
/** Only ever READ (the one-time import) — never written to, so a rollback still finds it whole. */
export const LEGACY_JOURNAL_FILE = "local-first-v2.journal";

/** Give the thread back to the event loop (I/O callbacks, timers, the webview) before continuing. */
export const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** What identifies THIS file: a compaction replaces it, which changes both fields. */
export interface FileIdentity {
  ino: number;
  birthtimeMs: number;
}

export interface JournalOpen {
  latest: LocalFirstSnapshot | undefined;
  frames: number;
}

/** A journal read in full; nothing is tracked until it is `adopt`ed. */
export interface LoadedJournal extends JournalOpen {
  committedBytes: number;
  tailFrames: number;
  tailBytes: number;
  identity: FileIdentity | undefined;
  /** The journal is damaged, not torn. Such a load can be read, never `adopt`ed (which would cut it). */
  corrupt?: JournalOpenScan["corrupt"];
  /** The newest base chain closed, so `latest` is a sound fold up to any damage. */
  baseClosed?: boolean;
}

export type TailRead =
  | { kind: "unchanged" }
  /** The file is not the one this process tracks (another window compacted), or holds a base frame. */
  | { kind: "reload" }
  | { kind: "deltas"; deltas: readonly LocalFirstDelta[]; consumedBytes: number };

/** What a compaction's catch-up copied onto the temp: whole frames and the bytes they span. */
export interface CopiedTail {
  frames: number;
  bytes: number;
}

/**
 * Copies the COMMITTED journal tail onto the temp. `tempEnd` is where the temp currently ends
 * (the WRITE offset into the temp); `journalEnd` is where the journal's committed frames end
 * (the end of the SOURCE range). The SOURCE start is the caller's closure, not an argument.
 */
export type CatchUp = (temp: FileHandle, tempEnd: number, journalEnd: number) => Promise<CopiedTail>;

export interface NodeJournalIo {
  readonly journalFile: string;
  /** Read the whole journal without tracking it. Safe without the lock. */
  load(pause?: () => Promise<void>): Promise<LoadedJournal>;
  /** Track a loaded journal as this process's view of the file. */
  adopt(loaded: LoadedJournal): void;
  /** `load` + `adopt`: the committed state, remembering where it ends. */
  open(pause?: () => Promise<void>): Promise<JournalOpen>;
  /** Complete delta frames after the tracked offset. Side-effect free; safe without the lock. */
  readTail(): Promise<TailRead>;
  /** Count a `deltas` tail as applied. Call synchronously with applying it. */
  advance(read: Extract<TailRead, { kind: "deltas" }>): void;
  /** Append one frame (the lock holder only): cut a torn tail, write, fsync. */
  append(frame: Uint8Array): Promise<void>;
  /** Replace the journal with these frames (temp file, fsync, rename). The lock holder only. */
  compact(frames: AsyncIterable<Uint8Array>): Promise<void>;
  /**
   * Two-phase compaction's publish step (the lock holder only). `tempPath` is a temp file a
   * lock-free phase already streamed and FSYNCED. `catchUp` copies the committed frames
   * appended to the journal after it was snapshotted onto the temp's end (see `CatchUp`).
   * The temp is re-fsynced and atomically renamed over the journal, so the rename lands the
   * new base and the caught-up tail in one step. Resolves with the caught-up frame count. A
   * failure removes the temp and leaves the journal untouched.
   */
  publishCompacted(tempPath: string, tempFrames: number, catchUp: CatchUp): Promise<number>;
  /** Remove a temp file a cancelled compaction left behind. */
  discardCompacted(tempPath: string): Promise<void>;
  /** Commit frames and bytes since the last base. */
  tail(): { frames: number; bytes: number };
  /** Committed frames in the file. */
  frames(): number;
  /** The offset where the committed frames end — a compaction's temp must catch up from here. */
  committedBytes(): number;
  /** The journal's file identity (a compaction replaces it, changing both fields). */
  identity(): FileIdentity | undefined;
  /** Bumps whenever the tracked view changes, so an async reader can tell it was overtaken. */
  epoch(): number;
}

function identityOf(stat: nodeFs.Stats): FileIdentity {
  return { ino: stat.ino, birthtimeMs: stat.birthtimeMs };
}

export function sameFile(a: FileIdentity | undefined, b: FileIdentity | undefined): boolean {
  if (!a || !b) return a === b;
  return a.ino === b.ino && a.birthtimeMs === b.birthtimeMs;
}

/** A write the file system cut short is a failed write: publishing it would leave a damaged frame or base. */
export async function writeWhole(handle: FileHandle, frame: Uint8Array, position: number): Promise<void> {
  const { bytesWritten } = await handle.write(frame, 0, frame.byteLength, position);
  if (bytesWritten !== frame.byteLength) {
    throw new Error(`local_first_short_write: wrote ${bytesWritten} of ${frame.byteLength} bytes`);
  }
}

const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === "ENOENT";

export function createNodeJournalIo(directory: string): NodeJournalIo {
  const journalFile = nodePath.join(directory, JOURNAL_FILE);
  let committedBytes = 0;
  let frameCount = 0;
  let tailFrames = 0;
  let tailBytes = 0;
  let identity: FileIdentity | undefined;
  let opened = false;
  let version = 0;

  const statOrUndefined = async (): Promise<nodeFs.Stats | undefined> => {
    try {
      return await fs.stat(journalFile);
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  };

  const load = async (pause: () => Promise<void> = yieldToEventLoop): Promise<LoadedJournal> => {
    let handle: FileHandle;
    try {
      handle = await fs.open(journalFile, "r");
    } catch (error) {
      if (isMissing(error)) {
        return { latest: undefined, frames: 0, committedBytes: 0, tailFrames: 0, tailBytes: 0, identity: undefined };
      }
      throw error;
    }
    let raw: Buffer;
    let stat: nodeFs.Stats;
    try {
      stat = await handle.stat();
      raw = await handle.readFile();
    } finally {
      await handle.close();
    }
    if (raw.byteLength === 0) {
      return { latest: undefined, frames: 0, committedBytes: 0, tailFrames: 0, tailBytes: 0, identity: identityOf(stat) };
    }
    const scan = await scanJournalAsync(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength), pause);
    return {
      latest: scan.latest,
      frames: scan.frames,
      committedBytes: scan.committedBytes,
      tailFrames: scan.tailFrames,
      tailBytes: scan.tailBytes,
      identity: identityOf(stat),
      corrupt: scan.corrupt,
      baseClosed: scan.baseClosed,
    };
  };

  const adopt = (loaded: LoadedJournal): void => {
    // Tracking a damaged journal would let the next append cut everything after the damage.
    if (loaded.corrupt) throw new LocalFirstStoreCorruptError(journalFile);
    committedBytes = loaded.committedBytes;
    frameCount = loaded.frames;
    tailFrames = loaded.tailFrames;
    tailBytes = loaded.tailBytes;
    identity = loaded.identity;
    opened = true;
    version += 1;
  };

  const open = async (pause?: () => Promise<void>): Promise<JournalOpen> => {
    const loaded = await load(pause);
    adopt(loaded);
    return { latest: loaded.latest, frames: loaded.frames };
  };

  const readTail = async (): Promise<TailRead> => {
    if (!opened) return { kind: "reload" };
    const stat = await statOrUndefined();
    if (!stat) return identity === undefined && committedBytes === 0 ? { kind: "unchanged" } : { kind: "reload" };
    if (!sameFile(identityOf(stat), identity)) return { kind: "reload" };
    if (stat.size < committedBytes) return { kind: "reload" };
    if (stat.size === committedBytes) return { kind: "unchanged" };
    const handle = await fs.open(journalFile, "r");
    let bytes: Buffer;
    try {
      // The file may have been replaced between the stat and the open: trust the handle's.
      const current = await handle.stat();
      if (!sameFile(identityOf(current), identity) || current.size < committedBytes) return { kind: "reload" };
      bytes = Buffer.alloc(current.size - committedBytes);
      let read = 0;
      while (read < bytes.length) {
        const { bytesRead } = await handle.read(bytes, read, bytes.length - read, committedBytes + read);
        if (bytesRead === 0) break;
        read += bytesRead;
      }
      bytes = bytes.subarray(0, read);
    } finally {
      await handle.close();
    }
    const tail = readJournalTail(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    if (tail.needsReload || tail.damaged) return { kind: "reload" };
    if (tail.deltas.length === 0) return { kind: "unchanged" };
    return { kind: "deltas", deltas: tail.deltas, consumedBytes: tail.consumedBytes };
  };

  return {
    journalFile,
    load,
    adopt,
    open,
    readTail,
    advance(read) {
      committedBytes += read.consumedBytes;
      frameCount += read.deltas.length;
      tailFrames += read.deltas.length;
      tailBytes += read.consumedBytes;
      version += 1;
    },
    tail: () => ({ frames: tailFrames, bytes: tailBytes }),
    frames: () => frameCount,
    committedBytes: () => committedBytes,
    identity: () => identity,
    epoch: () => version,
    async append(frame: Uint8Array) {
      if (!opened) await open();
      await fs.mkdir(directory, { recursive: true });
      // Read-write + create, NOT "a+": on Windows an append-mode handle has no
      // FILE_WRITE_DATA right, so ftruncate fails EPERM, and on POSIX an append
      // handle ignores the positional write below.
      const handle = await fs.open(journalFile, nodeFs.constants.O_RDWR | nodeFs.constants.O_CREAT);
      try {
        // A torn tail from a crashed append is not a commit: cut it before the next frame.
        if ((await handle.stat()).size !== committedBytes) await handle.truncate(committedBytes);
        try {
          await writeWhole(handle, frame, committedBytes);
          // The frame is durable only after fsync. Callers are not told the write
          // was saved until this returns.
          await handle.sync();
        } catch (error) {
          // A frame that may be complete on disk but was never acknowledged must not be
          // taken for a commit by another window's tail read.
          await handle.truncate(committedBytes).catch(() => undefined);
          throw error;
        }
        identity = identityOf(await handle.stat());
      } finally {
        await handle.close();
      }
      committedBytes += frame.byteLength;
      frameCount += 1;
      tailFrames += 1;
      tailBytes += frame.byteLength;
      opened = true;
      version += 1;
    },
    async compact(frames) {
      await fs.mkdir(directory, { recursive: true });
      const temporary = `${journalFile}.${process.pid}.${Date.now()}.tmp`;
      let written = 0;
      let count = 0;
      try {
        const handle = await fs.open(temporary, "wx");
        try {
          for await (const frame of frames) {
            await writeWhole(handle, frame, written);
            written += frame.byteLength;
            count += 1;
          }
          await handle.sync();
        } finally {
          await handle.close();
        }
        await fs.rename(temporary, journalFile);
      } catch (error) {
        await fs.rm(temporary, { force: true });
        throw error;
      }
      const stat = await statOrUndefined();
      committedBytes = written;
      frameCount = count;
      tailFrames = 0;
      tailBytes = 0;
      identity = stat ? identityOf(stat) : undefined;
      opened = true;
      version += 1;
    },
    async publishCompacted(tempPath, tempFrames, catchUp) {
      let handle: FileHandle | undefined;
      try {
        handle = await fs.open(tempPath, "r+");
        const copied = await catchUp(handle, (await handle.stat()).size, committedBytes);
        // Crash-safety: the caught-up tail is durable only after this fsync; the rename
        // below must never publish frames that can vanish on a crash.
        await handle.sync();
        await handle.close();
        handle = undefined;
        await fs.rename(tempPath, journalFile);
        const stat = await statOrUndefined();
        committedBytes = stat?.size ?? 0;
        frameCount = tempFrames + copied.frames;
        // The caught-up frames follow the new base, so they are the new tail (as a reopen counts them).
        tailFrames = copied.frames;
        tailBytes = copied.bytes;
        identity = stat ? identityOf(stat) : undefined;
        opened = true;
        version += 1;
        return copied.frames;
      } catch (error) {
        if (handle) await handle.close().catch(() => undefined);
        await fs.rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
      }
    },
    async discardCompacted(tempPath) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
    },
  };
}
