/**
 * Two-phase journal compaction (G03/G26): the policy, the lock-free stream and the locked catch-up.
 *
 *   1. WITHOUT the cross-window lock: fold the in-memory snapshot into a unique, fsynced
 *      temp file as a stream of bounded frames (`streamCompactionTemp`). The store's serial
 *      queue is occupied by this job, so THIS window's commits wait behind it; only OTHER
 *      windows can commit (append to the journal) while it streams.
 *   2. UNDER the lock (`exclusive`, which first applies every frame other windows committed):
 *      verify the journal is still the same file and still worth compacting, then have the
 *      journal io copy the committed bytes appended since the snapshot onto the temp
 *      (`copyCommittedTail`), fsync, and rename it over the journal.
 *
 * If the file's identity changed (another window compacted) or it shrank, the temp is a fold
 * of an older generation: it is discarded and the normal open/merge path runs instead. Any
 * failure removes the temp and leaves the journal untouched.
 *
 * Frames are read with the journal's own `readJournalTail` (no second parser) and the range is
 * streamed in chunks, never one multi-megabyte buffer. No `vscode` import.
 */

import nodeFs from "node:fs";
import type { FileHandle } from "node:fs/promises";
import nodePath from "node:path";
import {
  mintJournalGeneration,
  readJournalTail,
  shouldCompactJournal,
  snapshotFrames,
  type JournalCompactionPolicy,
  type LocalFirstSnapshot,
} from "@builderforce/local-first";
import { temporaryPathFor, writeFrameFile, writeWhole } from "./localFirstAtomicFile";
import { sameFile, yieldToEventLoop, type FileIdentity, type NodeJournalIo } from "./localFirstJournalIo";

const fs = nodeFs.promises;

/** Bytes read per step of the catch-up. A frame larger than this simply extends the carry. */
const CATCH_UP_CHUNK_BYTES = 1024 * 1024;

/** What `compactJournal` needs from its host, injected so the store stays a composition. */
export interface CompactionPorts {
  io: Pick<NodeJournalIo, "journalFile" | "tail" | "committedBytes" | "identity" | "publishCompacted" | "discardCompacted">;
  /** The in-memory snapshot to fold (read synchronously, together with the file state). */
  view(): LocalFirstSnapshot;
  /** Run `work` as the lock holder, with memory already caught up with the journal. */
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  policy?: Partial<JournalCompactionPolicy>;
}

/** What was folded: the rows, and where the journal stood at that instant. */
interface CompactionSource {
  snapshot: LocalFirstSnapshot;
  /** The committed end at snapshot time — the SOURCE offset the catch-up copies from. */
  baseCommittedBytes: number;
  /** The journal's file identity at snapshot time; `undefined` before the first frame exists. */
  baseIdentity: FileIdentity | undefined;
}

/** Stream `snapshot` to a fresh, fsynced temp file next to the journal. Removes it on failure. */
export async function streamCompactionTemp(
  journalFile: string,
  snapshot: LocalFirstSnapshot,
): Promise<{ path: string; frames: number; generation: string }> {
  await fs.mkdir(nodePath.dirname(journalFile), { recursive: true });
  const path = temporaryPathFor(journalFile);
  const generation = mintJournalGeneration();
  const written = await writeFrameFile(path, snapshotFrames(snapshot, yieldToEventLoop, undefined, generation));
  return { path, frames: written.frames, generation };
}

/**
 * Copy the journal bytes `[journalFrom, journalEnd)` — committed frames only; the caller passes
 * the committed end, so a torn uncommitted tail is never read — onto `temp` at `tempEnd`.
 * Throws on a backwards range, a base frame, damage, or a range that does not end on a frame
 * boundary: the publish is then abandoned and the journal stays untouched.
 */
export async function copyCommittedTail(
  journalFile: string,
  journalFrom: number,
  journalEnd: number,
  temp: FileHandle,
  tempEnd: number,
): Promise<{ frames: number; bytes: number }> {
  if (journalFrom > journalEnd) {
    throw new Error(`local_first_compaction_backwards: catch-up from ${journalFrom} past the committed end ${journalEnd}`);
  }
  const source = await fs.open(journalFile, "r");
  let carry = new Uint8Array(0);
  let readAt = journalFrom;
  let writeAt = tempEnd;
  let frames = 0;
  try {
    while (readAt < journalEnd || carry.byteLength > 0) {
      const chunk = Buffer.alloc(Math.min(CATCH_UP_CHUNK_BYTES, journalEnd - readAt));
      let filled = 0;
      while (filled < chunk.length) {
        const { bytesRead } = await source.read(chunk, filled, chunk.length - filled, readAt + filled);
        if (bytesRead === 0) throw new Error("local_first_compaction_short_read: journal shrank during catch-up");
        filled += bytesRead;
      }
      readAt += filled;
      const bytes = new Uint8Array(carry.byteLength + filled);
      bytes.set(carry, 0);
      bytes.set(chunk, carry.byteLength);
      const tail = readJournalTail(bytes);
      if (tail.needsReload || tail.damaged) throw new Error("local_first_compaction_unexpected_frame: base or damaged frame in the committed tail");
      if (tail.consumedBytes > 0) {
        await writeWhole(temp, bytes.subarray(0, tail.consumedBytes), writeAt);
        writeAt += tail.consumedBytes;
        frames += tail.deltas.length;
      }
      carry = bytes.slice(tail.consumedBytes);
      if (readAt >= journalEnd && carry.byteLength > 0) {
        throw new Error("local_first_compaction_partial_frame: committed tail does not end on a frame boundary");
      }
    }
  } finally {
    await source.close();
  }
  return { frames, bytes: writeAt - tempEnd };
}

/**
 * One compaction job, run on the store's serial queue. Re-checks the policy first, so jobs
 * queued behind the one that already folded the tail do nothing.
 */
export async function compactJournal(ports: CompactionPorts): Promise<void> {
  const { io, policy } = ports;
  if (!shouldCompactJournal(io.tail(), policy)) return;
  const source: CompactionSource = {
    snapshot: ports.view(),
    baseCommittedBytes: io.committedBytes(),
    baseIdentity: io.identity(),
  };
  const temporary = await streamCompactionTemp(io.journalFile, source.snapshot);
  try {
    await ports.exclusive(async () => {
      const replaced = !sameFile(io.identity(), source.baseIdentity) || io.committedBytes() < source.baseCommittedBytes;
      if (replaced || !shouldCompactJournal(io.tail(), policy)) {
        await io.discardCompacted(temporary.path);
        return;
      }
      await io.publishCompacted(temporary.path, temporary.frames, (temp, tempEnd, journalEnd) =>
        copyCommittedTail(io.journalFile, source.baseCommittedBytes, journalEnd, temp, tempEnd), temporary.generation);
    });
  } catch (error) {
    await io.discardCompacted(temporary.path);
    throw error;
  }
}
