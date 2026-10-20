/**
 * The VSIX store's journal file (`local-first-v2.journal`) over `node:fs` (G03).
 *
 * One frame (the shared `BFJF1` frame from `@builderforce/local-first`) per
 * committed transaction, fsynced before the commit is acknowledged. What this
 * module adds over a naive append, and why:
 *
 *   - THE COMMITTED PREFIX IS TRACKED IN MEMORY. `append` used to re-read the
 *     whole journal on every commit to find a torn tail. The prefix length is
 *     now known from the open (`scanJournal`) and advanced by each append; a
 *     file longer than it has a torn tail, which is truncated away before the
 *     next frame lands.
 *   - OPEN DECODES ONE FRAME. Frames are walked by header and crc; only the
 *     last one is parsed (`scanJournal`).
 *   - ANOTHER WINDOW'S COMMIT IS NOTICED. Every VS Code window shares this file.
 *     `changedSinceSeen` compares the file's size/mtime/inode with what this
 *     process last wrote or read, so the store reloads before it commits on
 *     top of a stale snapshot.
 *   - COMPACTION RUNS. `replace` rewrites the journal as one frame (temp file,
 *     fsync, rename); the store calls it on the ONE shared policy,
 *     `shouldCompactJournal`.
 *
 * No `vscode` import.
 */

import nodeFs from "node:fs";
import nodePath from "node:path";
import { scanJournal, type JournalIo, type LocalFirstSnapshot } from "@builderforce/local-first";

const fs = nodeFs.promises;

export const JOURNAL_FILE = "local-first-v2.journal";

export interface FileStamp {
  size: number;
  mtimeMs: number;
  ino: number;
}

export interface JournalOpen {
  latest: LocalFirstSnapshot | undefined;
  frames: number;
}

export interface NodeJournalIo extends JournalIo {
  readonly journalFile: string;
  /** Read the committed state and remember where it ends. Call only under the store lock. */
  open(): Promise<JournalOpen>;
  /** Read the committed state WITHOUT moving the tracked prefix (lock-free readers). */
  peek(): Promise<JournalOpen & { stamp: FileStamp | undefined }>;
  /** The file's stamp right now. */
  currentStamp(): Promise<FileStamp | undefined>;
  /** The stamp this process last read (`open`) or wrote. */
  seenStamp(): FileStamp | undefined;
  /** True when the file is not the one this process last read or wrote. */
  changedSinceSeen(): Promise<boolean>;
  /** Committed frames since the last open or compaction. */
  frames(): number;
}

function stampOf(stat: nodeFs.Stats): FileStamp {
  return { size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino };
}

export function sameStamp(a: FileStamp | undefined, b: FileStamp | undefined): boolean {
  if (!a || !b) return a === b;
  return a.size === b.size && a.mtimeMs === b.mtimeMs && a.ino === b.ino;
}

export function createNodeJournalIo(directory: string): NodeJournalIo {
  const journalFile = nodePath.join(directory, JOURNAL_FILE);
  let committedBytes = 0;
  let frameCount = 0;
  let seen: FileStamp | undefined;
  let opened = false;

  const statOrUndefined = async (): Promise<FileStamp | undefined> => {
    try {
      return stampOf(await fs.stat(journalFile));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  };

  const readBytes = async (): Promise<Uint8Array | undefined> => {
    try {
      const raw = await fs.readFile(journalFile);
      return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  };

  const syncFile = async (path: string): Promise<void> => {
    const handle = await fs.open(path, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  };

  const open = async (): Promise<JournalOpen> => {
    const bytes = await readBytes();
    const scan = bytes && bytes.byteLength > 0 ? scanJournal(bytes) : undefined;
    committedBytes = scan?.committedBytes ?? 0;
    frameCount = scan?.frames ?? 0;
    seen = await statOrUndefined();
    opened = true;
    return { latest: scan?.latest, frames: frameCount };
  };

  return {
    journalFile,
    open,
    async peek() {
      const stamp = await statOrUndefined();
      const bytes = await readBytes();
      const scan = bytes && bytes.byteLength > 0 ? scanJournal(bytes) : undefined;
      return { latest: scan?.latest, frames: scan?.frames ?? 0, stamp };
    },
    currentStamp: statOrUndefined,
    seenStamp: () => seen,
    read: readBytes,
    async changedSinceSeen() {
      if (!opened) return true;
      return !sameStamp(await statOrUndefined(), seen);
    },
    frames: () => frameCount,
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
        await handle.write(frame, 0, frame.byteLength, committedBytes);
        // The frame is durable only after fsync. Callers are not told the write
        // was saved until this returns.
        await handle.sync();
        seen = stampOf(await handle.stat());
      } finally {
        await handle.close();
      }
      committedBytes += frame.byteLength;
      frameCount += 1;
    },
    async replace(frame: Uint8Array) {
      await fs.mkdir(directory, { recursive: true });
      const temporary = `${journalFile}.${process.pid}.${Date.now()}.tmp`;
      try {
        await fs.writeFile(temporary, frame);
        await syncFile(temporary);
        await fs.rename(temporary, journalFile);
      } catch (error) {
        await fs.rm(temporary, { force: true });
        throw error;
      }
      committedBytes = frame.byteLength;
      frameCount = 1;
      opened = true;
      seen = await statOrUndefined();
    },
    async size() {
      if (!opened) await open();
      return committedBytes;
    },
  };
}
