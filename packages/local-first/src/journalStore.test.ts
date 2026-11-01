import { describe, expect, it } from 'vitest';
import {
  DEFAULT_JOURNAL_COMPACTION,
  encodeJournalFrame,
  scanJournal,
  shouldCompactJournal,
} from './journalStore.js';

describe('journal compaction policy', () => {
  it('compacts on either threshold, with one default for every host', () => {
    expect(DEFAULT_JOURNAL_COMPACTION).toEqual({ maxFrames: 8192, maxBytes: 64 * 1024 * 1024 });
    expect(shouldCompactJournal({ frames: 8191, bytes: 10 })).toBe(false);
    expect(shouldCompactJournal({ frames: 8192, bytes: 10 })).toBe(true);
    expect(shouldCompactJournal({ frames: 1, bytes: 64 * 1024 * 1024 })).toBe(true);
    expect(shouldCompactJournal({ frames: 3, bytes: 10 }, { maxFrames: 3 })).toBe(true);
    expect(shouldCompactJournal({ frames: 2, bytes: 100 }, { maxBytes: 100 })).toBe(true);
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
