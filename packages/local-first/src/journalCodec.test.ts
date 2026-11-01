import { describe, expect, it } from 'vitest';
import { JOURNAL_HEADER_BYTES, crc32, encodeDeltaFrame, encodeJournalFrame, isBaseFrame, walkFrames } from './journalCodec.js';
import { decodeJournalFrames, scanJournal } from './journalReplay.js';

/** The bitwise implementation the table-driven one replaced — kept here as the reference. */
function bitwiseCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc ^= bytes[index] ?? 0;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Deterministic bytes: a failing run must reproduce. */
function randomBytes(length: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let state = seed >>> 0;
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    bytes[index] = state >>> 24;
  }
  return bytes;
}

describe('crc32', () => {
  it('matches the CRC-32 check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('equals the bitwise implementation on random bytes of every alignment', () => {
    for (let length = 0; length <= 70; length += 1) {
      const bytes = randomBytes(length, length + 1);
      expect(crc32(bytes), `length ${length}`).toBe(bitwiseCrc32(bytes));
    }
    for (const length of [255, 256, 1_000, 4_093, 65_536, 200_001]) {
      const bytes = randomBytes(length, length);
      expect(crc32(bytes), `length ${length}`).toBe(bitwiseCrc32(bytes));
    }
  });

  it('still validates a frame an older build checksummed with the bitwise form', () => {
    const body = new TextEncoder().encode(JSON.stringify({
      records: [], events: [], mappings: [], receipts: [], conflicts: [], cursors: {}, nextSequence: 4,
    }));
    const frame = new Uint8Array(JOURNAL_HEADER_BYTES + body.length);
    frame.set(new TextEncoder().encode('BFJF1'), 0);
    const view = new DataView(frame.buffer);
    view.setUint32(5, body.length, false);
    view.setUint32(9, bitwiseCrc32(body), false);
    frame.set(body, JOURNAL_HEADER_BYTES);
    expect(scanJournal(frame).latest?.nextSequence).toBe(4);
    expect(decodeJournalFrames(frame)).toHaveLength(1);
  });
});

describe('frame kinds', () => {
  it('writes BFJF1 for a snapshot and BFJF2 for a delta, with one header layout', () => {
    const snapshot = encodeJournalFrame({ records: [], events: [], mappings: [], receipts: [], conflicts: [], cursors: {}, nextSequence: 1 });
    const delta = encodeDeltaFrame({ nextSequence: 2 });
    expect(new TextDecoder().decode(snapshot.subarray(0, 5))).toBe('BFJF1');
    expect(new TextDecoder().decode(delta.subarray(0, 5))).toBe('BFJF2');
    const [bound] = [...walkFrames(delta)];
    expect(bound?.start).toBe(JOURNAL_HEADER_BYTES);
    expect(bound?.end).toBe(delta.byteLength);
  });

  it('tells a base from the first bytes of a body', () => {
    const reset = encodeDeltaFrame({ nextSequence: 3, reset: true, records: [] });
    const plain = encodeDeltaFrame({ nextSequence: 3 });
    const snapshot = encodeJournalFrame({ records: [], events: [], mappings: [], receipts: [], conflicts: [], cursors: {}, nextSequence: 1 });
    expect(isBaseFrame(reset, [...walkFrames(reset)][0]!)).toBe(true);
    expect(isBaseFrame(plain, [...walkFrames(plain)][0]!)).toBe(false);
    expect(isBaseFrame(snapshot, [...walkFrames(snapshot)][0]!)).toBe(true);
  });

  it('stops at a frame whose checksum does not match', () => {
    const good = encodeDeltaFrame({ nextSequence: 2 });
    const bad = encodeDeltaFrame({ nextSequence: 3 }).slice();
    bad[bad.length - 2] = (bad[bad.length - 2] ?? 0) ^ 0xff;
    const bytes = new Uint8Array(good.byteLength + bad.byteLength);
    bytes.set(good, 0);
    bytes.set(bad, good.byteLength);
    expect(scanJournal(bytes)).toMatchObject({ frames: 1, committedBytes: good.byteLength });
  });
});
