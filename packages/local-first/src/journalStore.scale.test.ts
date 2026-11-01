/**
 * PERF GUARDS for the journal: a commit costs O(rows it changed), at any store size.
 *
 * These assert BYTES and CALL COUNTS, never wall-clock time, so they cannot flake on a slow
 * machine. The store is the shape that stalled the VS Code host: tens of thousands of
 * ~1.5 KB rows, where a whole-snapshot frame per commit was 73 MB of encode + checksum +
 * fsync.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  decodeJournalFrames,
  encodeDeltaFrame,
  encodeJournalFrame,
  readJournalTail,
  scanJournal,
  scanJournalAsync,
  snapshotFrames,
} from './journalStore.js';
import type { LocalRecord } from './records.js';
import {
  createMemoryLocalFirstStore,
  newLocalRecord,
  selectRecords,
  type LocalFirstDelta,
  type LocalFirstSnapshot,
  type MemoryLocalFirstStore,
} from './store.js';

const BODY = 'x'.repeat(1500);
const noPause = (): Promise<void> => Promise.resolve();

function rows(count: number, from = 0): LocalRecord<{ n: number; text: string }>[] {
  return Array.from({ length: count }, (_, index) => newLocalRecord({
    id: `row-${from + index}`,
    entityType: 'message',
    payload: { n: from + index, text: BODY },
    deviceId: 'device-1',
  }));
}

/** An in-memory journal file: frames appended, bytes readable, nothing else. */
function memoryJournal() {
  let bytes = new Uint8Array(0);
  const frames: Uint8Array[] = [];
  return {
    frames,
    bytes: () => bytes,
    append(frame: Uint8Array): void {
      const next = new Uint8Array(bytes.byteLength + frame.byteLength);
      next.set(bytes, 0);
      next.set(frame, bytes.byteLength);
      bytes = next;
      frames.push(frame);
    },
  };
}

/** The base a host writes first: the snapshot as a chain of bounded frames. */
async function baseOf(snapshot: LocalFirstSnapshot): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for await (const frame of snapshotFrames(snapshot, noPause)) out.push(frame);
  return out;
}

const byKey = (a: LocalRecord, b: LocalRecord): number => `${a.entityType}:${a.id}`.localeCompare(`${b.entityType}:${b.id}`);
const sorted = (snapshot: LocalFirstSnapshot): LocalFirstSnapshot => ({ ...snapshot, records: [...snapshot.records].sort(byKey) });

describe('a commit costs the rows it changed', () => {
  it('appends one small frame for a put into a 20,000-row store', async () => {
    const journal = memoryJournal();
    const store = createMemoryLocalFirstStore({ records: rows(20_000) }, {
      onCommit: async (delta) => journal.append(encodeDeltaFrame(delta)),
    });
    await store.transact(async (tx) => {
      await tx.put(rows(1, 20_000)[0]!);
    });
    await store.transact(async (tx) => {
      const existing = await tx.get<{ n: number; text: string }>('message', 'row-7');
      await tx.put({ ...existing!, version: 2, payload: { n: 7, text: 'edited' } });
    });
    expect(journal.frames).toHaveLength(2);
    for (const frame of journal.frames) expect(frame.byteLength).toBeLessThan(64 * 1024);
  });

  it('never reads the JSON of an unrelated row', async () => {
    const reads = vi.fn();
    const watched = new Proxy({ n: 5, text: BODY }, {
      get(target, property, receiver) {
        reads(property);
        return Reflect.get(target, property, receiver);
      },
      ownKeys(target) {
        reads('ownKeys');
        return Reflect.ownKeys(target);
      },
    });
    const initial = rows(2_000);
    initial[5] = { ...initial[5]!, payload: watched };
    const deltas: LocalFirstDelta[] = [];
    const store = createMemoryLocalFirstStore({ records: initial }, { onCommit: async (delta) => { deltas.push(delta); } });
    await store.transact(async (tx) => {
      await tx.get('message', 'row-9');
      await tx.put(rows(1, 99_999)[0]!);
    });
    await store.transact(async (tx) => {
      await tx.put(rows(1, 99_998)[0]!);
    });
    await store.read((tx) => selectRecords(tx, 'message', (row) => row.id === 'row-9'));
    expect(reads).not.toHaveBeenCalled();
    expect(deltas.map((delta) => delta.records?.length)).toEqual([1, 1]);
  });

  it('selectRecords clones the matches and only the matches', async () => {
    const store = createMemoryLocalFirstStore({ records: rows(5_000) });
    const clone = vi.spyOn(globalThis, 'structuredClone');
    try {
      const found = await store.read((tx) => selectRecords(tx, 'message', (row) => row.id === 'row-3' || row.id === 'row-4000'));
      expect(found.map((row) => row.id)).toEqual(['row-3', 'row-4000']);
      const cloned = clone.mock.calls.reduce((total, [value]) => total + (Array.isArray(value) ? value.length : 1), 0);
      expect(cloned).toBe(2);
    } finally {
      clone.mockRestore();
    }
  });
});

describe('compaction is a stream of bounded frames', () => {
  it('writes a 20,000-row store as frames under 1 MB, the first of them a base', async () => {
    const store = createMemoryLocalFirstStore({ records: rows(20_000) });
    const pauses = vi.fn(noPause);
    const frames: Uint8Array[] = [];
    for await (const frame of snapshotFrames(store.view(), pauses)) frames.push(frame);
    expect(frames.length).toBeGreaterThan(20);
    for (const frame of frames) expect(frame.byteLength).toBeLessThan(1024 * 1024);
    expect(pauses).toHaveBeenCalledTimes(frames.length - 1);
    const bytes = new Uint8Array(frames.reduce((total, frame) => total + frame.byteLength, 0));
    let offset = 0;
    for (const frame of frames) {
      bytes.set(frame, offset);
      offset += frame.byteLength;
    }
    const scan = scanJournal(bytes);
    expect(scan.frames).toBe(frames.length);
    expect(scan.latest?.records).toHaveLength(20_000);
    expect(scan.latest?.nextSequence).toBe(1);
  });

  it('compacts a small store to exactly one frame', async () => {
    const store = createMemoryLocalFirstStore({ records: rows(3) });
    const frames = await baseOf(store.view());
    expect(frames).toHaveLength(1);
    expect(scanJournal(frames[0]!).latest?.records.map((row) => row.id)).toEqual(['row-0', 'row-1', 'row-2']);
  });

  it('yields between frames when it opens, and counts only the commits after the base as the tail', async () => {
    const journal = memoryJournal();
    const store = createMemoryLocalFirstStore({ records: rows(2_000) }, { onCommit: async (delta) => journal.append(encodeDeltaFrame(delta)) });
    const base = await baseOf(store.view());
    expect(base.length).toBeGreaterThan(1);
    const commits = 3;
    for (let index = 0; index < commits; index += 1) {
      await store.transact(async (tx) => { await tx.put(rows(1, 50_000 + index)[0]!); });
    }
    const bytes = new Uint8Array([...base, ...journal.frames].reduce((total, frame) => total + frame.byteLength, 0));
    let offset = 0;
    for (const frame of [...base, ...journal.frames]) {
      bytes.set(frame, offset);
      offset += frame.byteLength;
    }
    const pause = vi.fn(noPause);
    const scan = await scanJournalAsync(bytes, pause);
    expect(pause.mock.calls.length).toBeGreaterThanOrEqual(base.length + commits);
    expect(scan.tailFrames).toBe(commits);
    expect(scan.frames).toBe(base.length + commits);
    expect(scan.tailBytes).toBe(journal.frames.reduce((total, frame) => total + frame.byteLength, 0));
  });
});

describe('reading a journal back', () => {
  it('reopens base + deltas to exactly the live store', async () => {
    const journal = memoryJournal();
    const store = createMemoryLocalFirstStore({ records: rows(1_500) }, { onCommit: async (delta) => journal.append(encodeDeltaFrame(delta)) });
    const base = await baseOf(store.view());
    await store.transact(async (tx) => {
      await tx.put(rows(1, 8_000)[0]!);
      await tx.delete('message', 'row-1');
      await tx.append({
        idempotencyKey: 'k1', clientEntityId: 'row-8000', entityType: 'message', operation: 'create',
        schemaVersion: 1, occurredAt: '2026-11-01T00:00:00.000Z', dependsOn: [], destination: { kind: 'unbound' }, payload: {},
      });
      await tx.setCursor({ kind: 'bound', accountId: 'a', tenantId: 't' }, 'cursor-1');
    });
    await store.transact(async (tx) => {
      const row = await tx.get<{ n: number; text: string }>('message', 'row-2');
      await tx.put({ ...row!, version: 2, payload: { n: 2, text: 'changed' } });
      await tx.delete('message', 'row-3');
      await tx.put(rows(1, 3)[0]!);
    });
    const bytes = new Uint8Array([...base, ...journal.frames].reduce((total, frame) => total + frame.byteLength, 0));
    let offset = 0;
    for (const frame of [...base, ...journal.frames]) {
      bytes.set(frame, offset);
      offset += frame.byteLength;
    }
    const reopened = scanJournal(bytes).latest!;
    const live = await store.export();
    expect(sorted(reopened)).toEqual(sorted(live));
    // Delete + re-add moves a row to the end, on the reopened copy exactly as on the live one.
    expect(reopened.records.at(-1)?.id).toBe(live.records.at(-1)?.id);
  });

  it('drops a torn tail and keeps every complete frame', async () => {
    const journal = memoryJournal();
    const store = createMemoryLocalFirstStore({}, { onCommit: async (delta) => journal.append(encodeDeltaFrame(delta)) });
    for (let index = 0; index < 3; index += 1) {
      await store.transact(async (tx) => { await tx.put(rows(1, index)[0]!); });
    }
    const whole = journal.bytes();
    const torn = encodeDeltaFrame({ records: rows(1, 99) }).subarray(0, 40);
    const bytes = new Uint8Array(whole.byteLength + torn.byteLength);
    bytes.set(whole, 0);
    bytes.set(torn, whole.byteLength);
    const scan = scanJournal(bytes);
    expect(scan.frames).toBe(3);
    expect(scan.committedBytes).toBe(whole.byteLength);
    expect(scan.latest?.records.map((row) => row.id)).toEqual(['row-0', 'row-1', 'row-2']);
    expect(readJournalTail(bytes).consumedBytes).toBe(whole.byteLength);
  });

  it('reads a shipped BFJF1 journal followed by delta frames', async () => {
    const legacy = encodeJournalFrame({ records: rows(4), events: [], mappings: [], receipts: [], conflicts: [], cursors: {}, nextSequence: 9 });
    const deltas = [
      encodeDeltaFrame({ records: rows(1, 100) }),
      encodeDeltaFrame({ deletedRecords: [{ entityType: 'message', id: 'row-0' }], nextSequence: 10 }),
    ];
    const bytes = new Uint8Array([legacy, ...deltas].reduce((total, frame) => total + frame.byteLength, 0));
    let offset = 0;
    for (const frame of [legacy, ...deltas]) {
      bytes.set(frame, offset);
      offset += frame.byteLength;
    }
    const scan = scanJournal(bytes);
    expect(scan.frames).toBe(3);
    expect(scan.latest?.records.map((row) => row.id)).toEqual(['row-1', 'row-2', 'row-3', 'row-100']);
    expect(scan.latest?.nextSequence).toBe(10);
    const frames = decodeJournalFrames(bytes);
    expect(frames).toHaveLength(3);
    expect(frames[0]?.records).toHaveLength(4);
    expect(frames.at(-1)?.records).toHaveLength(4);
    expect(String.fromCharCode(...bytes.subarray(0, 5))).toBe('BFJF1');
  });

  it('lets a second store follow the first by applying only the tail it has not seen', async () => {
    const journal = memoryJournal();
    function windowOver() {
      let offset = 0;
      let applied = 0;
      const store: MemoryLocalFirstStore = createMemoryLocalFirstStore(undefined, {
        onCommit: async (delta) => {
          journal.append(encodeDeltaFrame(delta));
          offset = journal.bytes().byteLength;
        },
      });
      const catchUp = (): void => {
        const tail = readJournalTail(journal.bytes().subarray(offset));
        for (const delta of tail.deltas) store.applyDelta(delta);
        applied += tail.deltas.length;
        offset += tail.consumedBytes;
      };
      return {
        store,
        applied: () => applied,
        async commit(work: Parameters<MemoryLocalFirstStore['transact']>[0]) {
          catchUp();
          await store.transact(work);
        },
        catchUp,
      };
    }
    const a = windowOver();
    const b = windowOver();
    await a.commit(async (tx) => { await tx.put(rows(1, 1)[0]!); });
    await b.commit(async (tx) => { await tx.put(rows(1, 2)[0]!); });
    await a.commit(async (tx) => { await tx.put(rows(1, 3)[0]!); });
    a.catchUp();
    b.catchUp();
    const ids = async (window: ReturnType<typeof windowOver>) => (await window.store.export()).records.map((row) => row.id).sort();
    expect(await ids(a)).toEqual(['row-1', 'row-2', 'row-3']);
    expect(await ids(b)).toEqual(['row-1', 'row-2', 'row-3']);
    // Each window applied the OTHER's frames only; its own commits were never replayed onto it.
    expect(a.applied()).toBe(1);
    expect(b.applied()).toBe(2);
  });
});
