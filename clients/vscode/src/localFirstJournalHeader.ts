/**
 * The base generation id a journal file opens with, read from its first bytes (G03).
 *
 * `snapshotFrames` writes the first frame of a base as `{"reset":true,"generation":"<id>",...}`
 * (`reset` is always the first key, `generation` the second), so a small fixed read at offset 0
 * identifies the file by id without scanning it. This is how `readTail` compares the generation
 * on the cross-window read path, where it cannot afford a full scan. The frame header
 * (magic + length + crc) precedes the body; the match is anchored to a few bytes after it.
 * A journal whose first frame carries no id (pre-migration, or a first-commit snapshot frame)
 * yields `undefined`. The caller falls back to stat identity only when it tracks no generation;
 * a window that tracks one treats `undefined` as a different file and reloads. No `vscode` import.
 */

import type { FileHandle } from "node:fs/promises";

/** The frame header is small (magic + 8 bytes); the id is a uuid. 256 bytes covers both. */
const HEADER_READ_BYTES = 256;
const HEADER_WINDOW_BYTES = 32;
const OPENING = '{"reset":true,"generation":"';
const ID = /^([^"\\]{1,100})"/;

/** The generation in `bytes` (the file's first bytes), or `undefined` when the first frame carries none. */
export function baseGenerationOf(bytes: Uint8Array): string | undefined {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
  const at = text.indexOf(OPENING);
  if (at < 0 || at > HEADER_WINDOW_BYTES) return undefined;
  return ID.exec(text.slice(at + OPENING.length))?.[1];
}

/** `baseGenerationOf` over the first bytes of an open file. */
export async function readBaseGeneration(handle: FileHandle): Promise<string | undefined> {
  const buffer = Buffer.alloc(HEADER_READ_BYTES);
  const { bytesRead } = await handle.read(buffer, 0, HEADER_READ_BYTES, 0);
  return baseGenerationOf(buffer.subarray(0, bytesRead));
}
