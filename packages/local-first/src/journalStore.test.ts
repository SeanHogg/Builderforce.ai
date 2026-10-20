import { describe, expect, it } from 'vitest';
import {
  DEFAULT_JOURNAL_COMPACTION,
  createJournaledLocalFirstStore,
  decodeJournalFrames,
  encodeJournalFrame,
  scanJournal,
  shouldCompactJournal,
  type JournalIo,
} from './journalStore.js';
import { newLocalRecord } from './store.js';

function memoryIo(): JournalIo & { bytes(): Uint8Array; replaced: number } {
  let bytes = new Uint8Array(0);
  const io = {
    replaced: 0,
    bytes: () => bytes,
    async read() {
      return bytes.byteLength ? bytes : undefined;
    },
    async append(frame: Uint8Array) {
      const next = new Uint8Array(bytes.byteLength + frame.byteLength);
      next.set(bytes, 0);
      next.set(frame, bytes.byteLength);
      bytes = next;
    },
    async replace(frame: Uint8Array) {
      io.replaced += 1;
      bytes = frame.slice();
    },
    async size() {
      return bytes.byteLength;
    },
  };
  return io;
}

describe('journal compaction policy', () => {
  it('compacts on either threshold, with one default for every host', () => {
    expect(DEFAULT_JOURNAL_COMPACTION).toEqual({ maxFrames: 32, maxBytes: 8 * 1024 * 1024 });
    expect(shouldCompactJournal({ frames: 31, bytes: 10 })).toBe(false);
    expect(shouldCompactJournal({ frames: 32, bytes: 10 })).toBe(true);
    expect(shouldCompactJournal({ frames: 1, bytes: 8 * 1024 * 1024 })).toBe(true);
    expect(shouldCompactJournal({ frames: 3, bytes: 10 }, { maxFrames: 3 })).toBe(true);
    expect(shouldCompactJournal({ frames: 2, bytes: 100 }, { maxBytes: 100 })).toBe(true);
  });

  it('rewrites the journal as one frame once maxFrames is reached and keeps every commit', async () => {
    const io = memoryIo();
    const store = createJournaledLocalFirstStore({ io, maxFrames: 3 });
    for (let index = 0; index < 3; index += 1) {
      await store.transact(async (tx) => {
        await tx.put(newLocalRecord({ id: `t-${index}`, entityType: 'ticket', payload: { index }, deviceId: 'd' }));
      });
    }
    expect(io.replaced).toBe(1);
    const frames = decodeJournalFrames(io.bytes());
    expect(frames).toHaveLength(1);
    expect(frames[0]?.records.map((record) => record.id).sort()).toEqual(['t-0', 't-1', 't-2']);
  });

  it('scans to the last committed frame and the committed byte length, ignoring a torn tail', () => {
    const empty = { records: [], events: [], mappings: [], receipts: [], conflicts: [], cursors: {}, nextSequence: 1 };
    const first = encodeJournalFrame(empty);
    const second = encodeJournalFrame({ ...empty, nextSequence: 7 });
    const torn = encodeJournalFrame({ ...empty, nextSequence: 9 }).subarray(0, 20);
    const bytes = new Uint8Array(first.byteLength + second.byteLength + torn.byteLength);
    bytes.set(first, 0);
    bytes.set(second, first.byteLength);
    bytes.set(torn, first.byteLength + second.byteLength);
    const scan = scanJournal(bytes);
    expect(scan.frames).toBe(2);
    expect(scan.committedBytes).toBe(first.byteLength + second.byteLength);
    expect(scan.latest?.nextSequence).toBe(7);
    expect(scanJournal(new Uint8Array(0))).toEqual({ latest: undefined, frames: 0, committedBytes: 0 });
  });
});
