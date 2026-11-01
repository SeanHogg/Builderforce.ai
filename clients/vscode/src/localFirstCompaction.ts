/**
 * The two halves of a two-phase journal compaction that touch files (G03/G26).
 *
 *   - `streamCompactionTemp` (no lock): write the folded snapshot to a unique temp file as a
 *     stream of bounded frames, fsynced, giving the thread back between frames.
 *   - `copyCommittedTail` (lock holder, via `io.publishCompacted`): copy the COMMITTED journal
 *     bytes appended since the snapshot onto the temp, so the rename lands them atomically.
 *
 * Frames are read with the journal's own `readJournalTail` (no second parser) and the range
 * is streamed in chunks, never one multi-megabyte buffer. No `vscode` import.
 */

import nodeFs from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { readJournalTail, snapshotFrames, type LocalFirstSnapshot } from "@builderforce/local-first";
import { writeWhole, yieldToEventLoop, type CopiedTail } from "./localFirstJournalIo";

const fs = nodeFs.promises;

/** Bytes read per step of the catch-up. A frame larger than this simply extends the carry. */
const CATCH_UP_CHUNK_BYTES = 1024 * 1024;

/** Stream `snapshot` to a fresh, fsynced temp file next to the journal. Removes it on failure. */
export async function streamCompactionTemp(
  journalFile: string,
  snapshot: LocalFirstSnapshot,
): Promise<{ path: string; frames: number }> {
  const path = `${journalFile}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  let written = 0;
  let frames = 0;
  try {
    const handle = await fs.open(path, "wx");
    try {
      for await (const frame of snapshotFrames(snapshot, yieldToEventLoop)) {
        await writeWhole(handle, frame, written);
        written += frame.byteLength;
        frames += 1;
      }
      // Crash-safety: the data must be durable before the rename can ever publish it.
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    await fs.rm(path, { force: true });
    throw error;
  }
  return { path, frames };
}

/**
 * Copy the journal bytes `[journalFrom, journalEnd)` — committed frames only; the caller passes
 * the committed end, so a torn uncommitted tail is never read — onto `temp` at `tempEnd`.
 * Throws on a base frame, damage, or a range that does not end on a frame boundary: the
 * publish is then abandoned and the journal stays untouched.
 */
export async function copyCommittedTail(
  journalFile: string,
  journalFrom: number,
  journalEnd: number,
  temp: FileHandle,
  tempEnd: number,
): Promise<CopiedTail> {
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
