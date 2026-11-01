/**
 * Journal compaction: WHEN to do it, and HOW to write the result without stalling a host.
 *
 * WHEN is one shared policy — every host's journal compacts on the same thresholds. A host
 * measures it against the TAIL (frames and bytes since the last base), never the whole
 * file: the base is the store, and a 70 MB store is not "a journal that needs compacting".
 *
 * HOW: the compacted journal is a SEQUENCE of small `BFJF2` frames, not one frame of the
 * whole store. Encoding one 70 MB frame blocks the thread for seconds; each frame here is
 * bounded (~256 KB of JSON or 500 rows), so a host does a frame's worth of work and gives
 * the thread back (`pause`) before the next. The first frame carries `reset:true` (a base:
 * a reader starts there), the last carries `endsBase:true` (the tail begins after it). A
 * small store compacts to exactly one frame.
 */

import type { LocalFirstSnapshot } from './storeContract.js';
import { JOURNAL_DELTA_MAGIC, encodeJournalBody } from './journalCodec.js';

/**
 * THE journal compaction policy — every host's journal (the VSIX file journal in
 * `clients/vscode`, and any other) compacts on the same thresholds, so "how big may a
 * journal grow" has one answer.
 */
export interface JournalCompactionPolicy {
  /** Compact once this many commit frames have accumulated after the base. */
  readonly maxFrames: number;
  /** Compact once the commit frames after the base reach this many bytes. */
  readonly maxBytes: number;
}

export const DEFAULT_JOURNAL_COMPACTION: JournalCompactionPolicy = Object.freeze({
  maxFrames: 8192,
  maxBytes: 64 * 1024 * 1024,
});

/** True when a journal TAIL of `frames` frames and `bytes` bytes must be folded into a new base. */
export function shouldCompactJournal(
  journal: { readonly frames: number; readonly bytes: number },
  policy: Partial<JournalCompactionPolicy> = DEFAULT_JOURNAL_COMPACTION,
): boolean {
  const maxFrames = policy.maxFrames ?? DEFAULT_JOURNAL_COMPACTION.maxFrames;
  const maxBytes = policy.maxBytes ?? DEFAULT_JOURNAL_COMPACTION.maxBytes;
  return journal.frames >= maxFrames || journal.bytes >= maxBytes;
}

export interface CompactionFrameLimits {
  /** Close a frame once its JSON reaches about this many characters. */
  readonly maxBytes: number;
  /** Close a frame once it holds this many rows. */
  readonly maxRows: number;
}

export const DEFAULT_COMPACTION_FRAME: CompactionFrameLimits = Object.freeze({
  maxBytes: 256 * 1024,
  maxRows: 500,
});

const SECTIONS = ['records', 'events', 'mappings', 'receipts', 'conflicts'] as const;
type Section = typeof SECTIONS[number];
type Chunk = Partial<Record<Section, string[]>>;

/** The snapshot's rows, stringified once, grouped into bounded chunks. Always yields at least one. */
function* chunks(snapshot: LocalFirstSnapshot, limits: CompactionFrameLimits): Generator<Chunk> {
  let current: Chunk = {};
  let bytes = 0;
  let rows = 0;
  let yielded = false;
  for (const section of SECTIONS) {
    for (const row of snapshot[section]) {
      const json = JSON.stringify(row);
      (current[section] ??= []).push(json);
      bytes += json.length;
      rows += 1;
      if (bytes >= limits.maxBytes || rows >= limits.maxRows) {
        yield current;
        yielded = true;
        current = {};
        bytes = 0;
        rows = 0;
      }
    }
  }
  if (rows > 0 || !yielded) yield current;
}

const encoder = new TextEncoder();

function frameOf(chunk: Chunk, snapshot: LocalFirstSnapshot, first: boolean, last: boolean, generation?: string): Uint8Array {
  // `reset` MUST be the first key (`encodeDeltaFrame` / `isBaseFrame` rely on it).
  const parts: string[] = [];
  if (first) {
    parts.push('"reset":true');
    if (generation) parts.push(`"generation":${JSON.stringify(generation)}`);
    parts.push(`"nextSequence":${JSON.stringify(snapshot.nextSequence)}`);
    parts.push(`"cursors":${JSON.stringify(snapshot.cursors ?? {})}`);
  }
  for (const section of SECTIONS) {
    const rows = chunk[section];
    if (rows && rows.length > 0) parts.push(`"${section}":[${rows.join(',')}]`);
  }
  if (last) parts.push('"endsBase":true');
  return encodeJournalBody(JOURNAL_DELTA_MAGIC, encoder.encode(`{${parts.join(',')}}`));
}

/**
 * The snapshot as a sequence of bounded `BFJF2` frames, produced lazily: a host writes each
 * as it arrives and the generator awaits `pause()` between frames, so no turn of the event
 * loop does more than one frame's worth of stringify + crc. `snapshot` is read-only here —
 * its rows may be a live store's own (`MemoryLocalFirstStore.view()`).
 *
 * `generation` (default: a freshly minted id) is written into the FIRST frame, so the
 * sequence opens a base a reader can identify by id alone — what a host compares to know
 * the file it is reading is still the one it tracked, even where stat identity is weak
 * (NTFS reuses inode numbers). Pass a fixed id when rewriting the same logical base.
 */
export async function* snapshotFrames(
  snapshot: LocalFirstSnapshot,
  pause: () => Promise<void>,
  limits: CompactionFrameLimits = DEFAULT_COMPACTION_FRAME,
  generation: string = mintJournalGeneration(),
): AsyncGenerator<Uint8Array, void> {
  // One chunk of lookahead: only the final frame is marked `endsBase`.
  let held: Chunk | undefined;
  let first = true;
  for (const chunk of chunks(snapshot, limits)) {
    if (held) {
      yield frameOf(held, snapshot, first, false, first ? generation : undefined);
      first = false;
      await pause();
    }
    held = chunk;
  }
  yield frameOf(held ?? {}, snapshot, first, true, first ? generation : undefined);
}

/** One opaque base-generation id per compaction (`crypto.randomUUID` when available). */
export function mintJournalGeneration(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `gen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
