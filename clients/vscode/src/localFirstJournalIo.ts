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
  mintJournalGeneration,
  readJournalTail,
  snapshotFrames,
  scanJournalAsync,
  type JournalOpenScan,
  type LocalFirstDelta,
  type LocalFirstSnapshot,
} from "@builderforce/local-first";
import { LocalFirstStoreCorruptError } from "./localFirstCorruption";
import { renameDurably, temporaryPathFor, writeFrameFile, writeWhole } from "./localFirstAtomicFile";
import { readBaseGeneration } from "./localFirstJournalHeader";

const fs = nodeFs.promises;

export const JOURNAL_FILE = "local-first-v3.journal";
/** Only ever READ (the one-time import) — never written to, so a rollback still finds it whole. */
export const LEGACY_JOURNAL_FILE = "local-first-v2.journal";

/**
 * One stage of a measured operation. Emitted only when a timing sink is
 * provided (`NodeJournalIoOptions.onStageTiming`), so the default path is
 * zero-overhead. Stage names are stable: `import.load`, `import.decode`,
 * `import.persist`, `commit.write`, `commit.fsync`.
 */
export interface JournalStageTiming {
  stage: string;
  ms: number;
  detail?: string;
}

/** Optional instrumentation. Absent (the default) = no timings computed at all. */
export interface NodeJournalIoOptions {
  onStageTiming?: (timing: JournalStageTiming) => void;
}

/** Give the thread back to the event loop (I/O callbacks, timers, the webview) before continuing. */
export const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * What identifies THIS file: a compaction replaces it, which changes every field. `ino` and
 * `birthtimeNs` come from BigInt stats (a number `ino` loses precision above 2^53). `generation`
 * is the base generation (`JournalOpenScan.generation`) — the strong identity, since
 * `(ino, birthtime)` is weak on NTFS. Absent for a pre-migration journal; those compare by stat.
 */
export interface FileIdentity {
  ino: bigint;
  birthtimeNs: bigint;
  generation?: string;
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
  /** Replace the journal with this snapshot as a new base (temp file, fsync, rename). The lock holder only. */
  compact(snapshot: LocalFirstSnapshot, pause?: () => Promise<void>): Promise<void>;
  /**
   * Two-phase compaction's publish step (the lock holder only). `tempPath` is a temp file a
   * lock-free phase already streamed and FSYNCED. `catchUp` copies the committed frames
   * appended to the journal after it was snapshotted onto the temp's end (see `CatchUp`).
   * The temp is re-fsynced and atomically renamed over the journal, so the rename lands the
   * new base and the caught-up tail in one step. A
   * failure removes the temp and leaves the journal untouched.
   */
  publishCompacted(tempPath: string, tempFrames: number, catchUp: CatchUp, generation: string): Promise<void>;
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

function identityOf(stat: nodeFs.BigIntStats, generation?: string): FileIdentity {
  return generation === undefined
    ? { ino: stat.ino, birthtimeNs: stat.birthtimeNs }
    : { ino: stat.ino, birthtimeNs: stat.birthtimeNs, generation };
}

/** Both sides carry a generation: it decides. Otherwise (pre-migration journal) the stat identity does. */
export function sameFile(a: FileIdentity | undefined, b: FileIdentity | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.generation !== undefined && b.generation !== undefined) return a.generation === b.generation;
  return a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
}

const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === "ENOENT";

export function createNodeJournalIo(directory: string, options: NodeJournalIoOptions = {}): NodeJournalIo {
  const onStageTiming = options.onStageTiming;
  const journalFile = nodePath.join(directory, JOURNAL_FILE);
  let committedBytes = 0;
  let frameCount = 0;
  let tailFrames = 0;
  let tailBytes = 0;
  let identity: FileIdentity | undefined;
  let opened = false;
  let version = 0;

  const statOrUndefined = async (): Promise<nodeFs.BigIntStats | undefined> => {
    try {
      return await fs.stat(journalFile, { bigint: true });
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  };

  const load = async (pause: () => Promise<void> = yieldToEventLoop): Promise<LoadedJournal> => {
    const started = onStageTiming ? Date.now() : 0;
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
    let stat: nodeFs.BigIntStats;
    try {
      stat = await handle.stat({ bigint: true });
      raw = await handle.readFile();
    } finally {
      await handle.close();
    }
    if (onStageTiming) onStageTiming({ stage: "import.load", ms: Date.now() - started, detail: `${stat.size} bytes` });
    if (raw.byteLength === 0) {
      return { latest: undefined, frames: 0, committedBytes: 0, tailFrames: 0, tailBytes: 0, identity: identityOf(stat) };
    }
    const decodeStarted = onStageTiming ? Date.now() : 0;
    const scan = await scanJournalAsync(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength), pause);
    if (onStageTiming) onStageTiming({ stage: "import.decode", ms: Date.now() - decodeStarted, detail: `${scan.frames} frames` });
    return {
      latest: scan.latest,
      frames: scan.frames,
      committedBytes: scan.committedBytes,
      tailFrames: scan.tailFrames,
      tailBytes: scan.tailBytes,
      identity: identityOf(stat, scan.generation),
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
    const size = Number(stat.size);
    if (!sameFile(identityOf(stat), identity)) return { kind: "reload" };
    if (size < committedBytes) return { kind: "reload" };
    // With a tracked generation even an equal-size file may be a different one: check its header first.
    if (size === committedBytes && identity?.generation === undefined) return { kind: "unchanged" };
    const handle = await fs.open(journalFile, "r");
    let bytes: Buffer;
    try {
      // The file may have been replaced between the stat and the open: trust the handle's.
      const current = await handle.stat({ bigint: true });
      const currentSize = Number(current.size);
      if (!sameFile(identityOf(current), identity) || currentSize < committedBytes) return { kind: "reload" };
      // Stat identity is weak on NTFS: the base generation the file opens with must still be the tracked one.
      // A header with no generation (an older build's file on a reused inode) is a different file too.
      if (identity?.generation !== undefined && (await readBaseGeneration(handle)) !== identity.generation) return { kind: "reload" };
      if (currentSize === committedBytes) return { kind: "unchanged" };
      bytes = Buffer.alloc(currentSize - committedBytes);
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
          const writeStarted = onStageTiming ? Date.now() : 0;
          await writeWhole(handle, frame, committedBytes);
          if (onStageTiming) onStageTiming({ stage: "commit.write", ms: Date.now() - writeStarted, detail: `${frame.byteLength} bytes` });
          // The frame is durable only after fsync. Callers are not told the write
          // was saved until this returns.
          const fsyncStarted = onStageTiming ? Date.now() : 0;
          await handle.sync();
          if (onStageTiming) onStageTiming({ stage: "commit.fsync", ms: Date.now() - fsyncStarted });
        } catch (error) {
          // A frame that may be complete on disk but was never acknowledged must not be
          // taken for a commit by another window's tail read.
          await handle.truncate(committedBytes).catch(() => undefined);
          throw error;
        }
        // Appending does not change the base generation: keep it while the file is the same one.
        const written = identityOf(await handle.stat({ bigint: true }));
        identity = identity?.ino === written.ino && identity.generation !== undefined ? { ...written, generation: identity.generation } : written;
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
    async compact(snapshot, pause = yieldToEventLoop) {
      const generation = mintJournalGeneration();
      const frames = snapshotFrames(snapshot, pause, undefined, generation);
      const compactStart = onStageTiming ? Date.now() : 0;
      await fs.mkdir(directory, { recursive: true });
      const temporary = temporaryPathFor(journalFile);
      const written = await writeFrameFile(temporary, frames);
      try {
        await renameDurably(temporary, journalFile);
      } catch (error) {
        await fs.rm(temporary, { force: true });
        throw error;
      }
      if (onStageTiming) onStageTiming({ stage: "import.persist", ms: Date.now() - compactStart, detail: `${written.frames} frames, ${written.bytes} bytes` });
      const stat = await statOrUndefined();
      committedBytes = written.bytes;
      frameCount = written.frames;
      tailFrames = 0;
      tailBytes = 0;
      identity = stat ? identityOf(stat, generation) : undefined; // the base this host just wrote
      opened = true;
      version += 1;
    },
    async publishCompacted(tempPath, tempFrames, catchUp, generation) {
      let handle: FileHandle | undefined;
      try {
        handle = await fs.open(tempPath, "r+");
        const copied = await catchUp(handle, (await handle.stat()).size, committedBytes);
        // Crash-safety: the caught-up tail is durable only after this fsync; the rename
        // below must never publish frames that can vanish on a crash.
        await handle.sync();
        await handle.close();
        handle = undefined;
        await renameDurably(tempPath, journalFile);
        const stat = await statOrUndefined();
        committedBytes = stat ? Number(stat.size) : 0;
        frameCount = tempFrames + copied.frames;
        // The caught-up frames follow the new base, so they are the new tail (as a reopen counts them).
        tailFrames = copied.frames;
        tailBytes = copied.bytes;
        identity = stat ? identityOf(stat, generation) : undefined;
        opened = true;
        version += 1;
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
