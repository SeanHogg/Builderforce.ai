/**
 * The journal's BYTES: frame header, checksum, and the two frame kinds.
 *
 *   BFJF1  one WHOLE snapshot (the shipped format; readable forever).
 *   BFJF2  one `LocalFirstDelta` — what a single commit changed.
 *
 * Both share one 13-byte header: 5-byte magic, u32 body length, u32 crc32 of the body
 * (big-endian). A frame is complete only when its length fits the file and its crc
 * matches; the first frame that is not is the torn tail a kill left, and nothing after it
 * is trusted. No I/O here, no store.
 */

import type { LocalFirstDelta } from './localFirstDelta.js';
import type { LocalFirstSnapshot } from './storeContract.js';

/** `BFJF1` + u32 length + u32 crc32 of the body: one whole snapshot. */
export const JOURNAL_FRAME_MAGIC = 'BFJF1';
/** `BFJF2` + u32 length + u32 crc32 of the body: one delta. */
export const JOURNAL_DELTA_MAGIC = 'BFJF2';
const MAGIC_BYTES = 5;
export const JOURNAL_HEADER_BYTES = MAGIC_BYTES + 8;

/** The body of a delta that discards everything first starts with exactly this (see `encodeDeltaFrame`). */
const RESET_PREFIX = new TextEncoder().encode('{"reset":true');

// CRC-32 (IEEE, reflected, polynomial 0xedb88320), slicing-by-8: eight lookup tables so
// each loop turn folds eight bytes. The bitwise form this replaced cost seven seconds on
// a 73 MB store; the output is identical, so every shipped frame still validates.
const TABLES = ((): Int32Array => {
  const tables = new Int32Array(8 * 256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let bit = 0; bit < 8; bit += 1) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    tables[n] = c;
  }
  for (let n = 0; n < 256; n += 1) {
    let c = tables[n]!;
    for (let k = 1; k < 8; k += 1) {
      c = tables[c & 0xff]! ^ (c >>> 8);
      tables[k * 256 + n] = c;
    }
  }
  return tables;
})();

export function crc32(bytes: Uint8Array): number {
  const T = TABLES;
  const length = bytes.length;
  let crc = -1;
  let index = 0;
  for (; index + 8 <= length; index += 8) {
    const lo = (bytes[index]! | (bytes[index + 1]! << 8) | (bytes[index + 2]! << 16) | (bytes[index + 3]! << 24)) ^ crc;
    const hi = bytes[index + 4]! | (bytes[index + 5]! << 8) | (bytes[index + 6]! << 16) | (bytes[index + 7]! << 24);
    crc = T[1792 + (lo & 0xff)]!
      ^ T[1536 + ((lo >>> 8) & 0xff)]!
      ^ T[1280 + ((lo >>> 16) & 0xff)]!
      ^ T[1024 + (lo >>> 24)]!
      ^ T[768 + (hi & 0xff)]!
      ^ T[512 + ((hi >>> 8) & 0xff)]!
      ^ T[256 + ((hi >>> 16) & 0xff)]!
      ^ T[hi >>> 24]!;
  }
  for (; index < length; index += 1) crc = T[(crc ^ bytes[index]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

/** Order-stable, so two exports of the same state are the same frame bytes. */
function canonicalSnapshot(snapshot: LocalFirstSnapshot): LocalFirstSnapshot {
  const byEntity = (a: { entityType: string; id: string }, b: { entityType: string; id: string }): number =>
    a.entityType === b.entityType ? a.id.localeCompare(b.id) : a.entityType.localeCompare(b.entityType);
  return {
    records: [...snapshot.records].sort(byEntity),
    events: [...snapshot.events].sort((a, b) => a.localSequence - b.localSequence),
    mappings: [...snapshot.mappings].sort((a, b) =>
      `${a.entityType}:${a.clientEntityId}`.localeCompare(`${b.entityType}:${b.clientEntityId}`)),
    receipts: [...snapshot.receipts].sort((a, b) => a.eventId.localeCompare(b.eventId)),
    conflicts: [...snapshot.conflicts].sort((a, b) => a.id.localeCompare(b.id)),
    cursors: Object.fromEntries(
      Object.entries(snapshot.cursors ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    ),
    nextSequence: snapshot.nextSequence,
  };
}

/** Header + body as one frame. */
export function encodeJournalBody(magic: string, body: Uint8Array): Uint8Array {
  const frame = new Uint8Array(JOURNAL_HEADER_BYTES + body.length);
  for (let index = 0; index < MAGIC_BYTES; index += 1) frame[index] = magic.charCodeAt(index);
  const view = new DataView(frame.buffer);
  view.setUint32(MAGIC_BYTES, body.length, false);
  view.setUint32(MAGIC_BYTES + 4, crc32(body), false);
  frame.set(body, JOURNAL_HEADER_BYTES);
  return frame;
}

/** One whole snapshot, as bytes a host appends to its journal (`BFJF1`). */
export function encodeJournalFrame(snapshot: LocalFirstSnapshot): Uint8Array {
  return encodeJournalBody(JOURNAL_FRAME_MAGIC, new TextEncoder().encode(JSON.stringify(canonicalSnapshot(snapshot))));
}

/**
 * One commit's delta as a frame (`BFJF2`). `reset` is written FIRST so a scan can tell a
 * base frame from the first bytes of its body, without parsing it.
 */
export function encodeDeltaFrame(delta: LocalFirstDelta): Uint8Array {
  const { reset, ...rest } = delta;
  const ordered = reset ? { reset: true as const, ...rest } : rest;
  return encodeJournalBody(JOURNAL_DELTA_MAGIC, new TextEncoder().encode(JSON.stringify(ordered)));
}

export interface JournalFrameBound {
  readonly kind: 'snapshot' | 'delta';
  /** Offset of the body (after the header). */
  readonly start: number;
  /** Offset just past the frame. */
  readonly end: number;
}

function magicKind(bytes: Uint8Array, offset: number): JournalFrameBound['kind'] | undefined {
  const same = (magic: string): boolean => {
    for (let index = 0; index < MAGIC_BYTES; index += 1) {
      if (bytes[offset + index] !== magic.charCodeAt(index)) return false;
    }
    return true;
  };
  if (same(JOURNAL_FRAME_MAGIC)) return 'snapshot';
  if (same(JOURNAL_DELTA_MAGIC)) return 'delta';
  return undefined;
}

/**
 * Header-checked frame boundaries, oldest first: a known magic, a length that fits, a
 * matching crc. No JSON parse. Stops at the first frame that fails any of those.
 */
export function* walkFrames(bytes: Uint8Array): Generator<JournalFrameBound> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (offset + JOURNAL_HEADER_BYTES <= bytes.byteLength) {
    const kind = magicKind(bytes, offset);
    if (!kind) return;
    const length = view.getUint32(offset + MAGIC_BYTES, false);
    const expected = view.getUint32(offset + MAGIC_BYTES + 4, false);
    const start = offset + JOURNAL_HEADER_BYTES;
    const end = start + length;
    // A short read is the torn tail. Nothing after it can be trusted.
    if (end > bytes.byteLength) return;
    if (crc32(bytes.subarray(start, end)) !== expected) return;
    yield { kind, start, end };
    offset = end;
  }
}

/** A whole frame (known magic, length that fits, matching crc) starts at `offset`. */
function completeFrameAt(bytes: Uint8Array, offset: number): boolean {
  if (offset + JOURNAL_HEADER_BYTES > bytes.byteLength || !magicKind(bytes, offset)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = offset + JOURNAL_HEADER_BYTES;
  const end = start + view.getUint32(offset + MAGIC_BYTES, false);
  return end <= bytes.byteLength && crc32(bytes.subarray(start, end)) === view.getUint32(offset + MAGIC_BYTES + 4, false);
}

/**
 * `walkFrames` stopped at `offset`, short of the end of the file. Is that a plain TORN TAIL
 * (a kill cut the last append short: the failed frame is the last thing in the file), or
 * DAMAGE (a frame failed its crc with more bytes after it, or a whole frame still follows)?
 * A torn tail is cut and recovered; damage must never be truncated.
 */
export function damagedAfterStop(bytes: Uint8Array, offset: number): boolean {
  if (offset + JOURNAL_HEADER_BYTES > bytes.byteLength) return false;
  if (magicKind(bytes, offset)) {
    const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset + MAGIC_BYTES, false);
    // Failed its crc with bytes after it: the frame was complete once, so it is not a torn append.
    if (offset + JOURNAL_HEADER_BYTES + length < bytes.byteLength && !completeFrameAt(bytes, offset)) return true;
  }
  // A frame that cannot be read, but a whole one after it: committed data sits behind the damage.
  for (let index = offset + 1; index + JOURNAL_HEADER_BYTES <= bytes.byteLength; index += 1) {
    if (bytes[index] === 0x42 && completeFrameAt(bytes, index)) return true;
  }
  return false;
}

/** True for a frame a reader may START from: a whole snapshot, or a delta that resets. */
export function isBaseFrame(bytes: Uint8Array, bound: JournalFrameBound): boolean {
  if (bound.kind === 'snapshot') return true;
  if (bound.end - bound.start < RESET_PREFIX.length) return false;
  for (let index = 0; index < RESET_PREFIX.length; index += 1) {
    if (bytes[bound.start + index] !== RESET_PREFIX[index]) return false;
  }
  return true;
}
