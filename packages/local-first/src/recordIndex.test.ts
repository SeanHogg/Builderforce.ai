import { describe, expect, it } from 'vitest';
import {
  createMemoryLocalFirstStore,
  defineRecordIndex,
  encodeDeltaFrame,
  newLocalRecord,
  scanByIndex,
  scanJournal,
  selectByIndex,
  SCAN_STOP,
  type LocalFirstDelta,
  type LocalFirstTransaction,
  type LocalRecord,
} from './index.js';

interface Row { group: number; n: number }

const BY_GROUP = defineRecordIndex<Row>('message', 'test.group', (row) => row.payload.group);

const row = (id: string, group: number, n = 0): LocalRecord<Row> =>
  newLocalRecord<Row>({ id, entityType: 'message', payload: { group, n }, deviceId: 'd', occurredAt: '2026-11-10T00:00:00.000Z' });

/** The index's answer: ids of one group, in scan order. */
const indexed = (tx: LocalFirstTransaction, group: number): Promise<string[]> =>
  selectByIndex<Row>(tx, BY_GROUP, group).then((rows) => rows.map((r) => r.id));

/** The reference answer: a filtered walk of every message row. */
const filtered = async (tx: LocalFirstTransaction, group: number): Promise<string[]> => {
  const ids: string[] = [];
  await tx.scan<Row>('message', (r) => { if (r.payload.group === group) ids.push(r.id); });
  return ids;
};

describe('secondary record index', () => {
  it('groups rows on insert, re-files an update whose key moved, and drops a delete', async () => {
    const store = createMemoryLocalFirstStore({ records: [row('a', 1), row('b', 2)] });
    expect(await store.read((tx) => indexed(tx, 1))).toEqual(['a']); // built lazily on first read
    await store.transact(async (tx) => { await tx.put(row('c', 1)); });
    expect(await store.read((tx) => indexed(tx, 1))).toEqual(['a', 'c']);
    await store.transact(async (tx) => { await tx.put({ ...row('a', 2, 5), version: 2 }); });
    expect(await store.read((tx) => indexed(tx, 1))).toEqual(['c']);
    expect(await store.read((tx) => indexed(tx, 2))).toEqual(['b', 'a']);
    await store.transact(async (tx) => { await tx.put({ ...row('b', 2, 9), version: 2 }); });
    expect(await store.read((tx) => indexed(tx, 2))).toEqual(['b', 'a']); // an in-place update keeps its place
    expect((await store.read((tx) => selectByIndex<Row>(tx, BY_GROUP, 2)))[0]!.payload.n).toBe(9);
    await store.transact(async (tx) => { await tx.delete('message', 'b'); });
    expect(await store.read((tx) => indexed(tx, 2))).toEqual(['a']);
    expect(await store.read((tx) => indexed(tx, 3))).toEqual([]);
  });

  it('sees a transaction\'s own writes: added, moved in and out, deleted and re-added', async () => {
    const store = createMemoryLocalFirstStore({ records: [row('a', 1), row('b', 1), row('c', 2)] });
    await store.read((tx) => indexed(tx, 1)); // committed index built before the draft writes
    await store.transact(async (tx) => {
      await tx.put(row('new', 1));
      await tx.put({ ...row('c', 1), version: 2 }); // moved into group 1, in place
      await tx.put({ ...row('a', 3), version: 2 }); // moved out of group 1
      await tx.delete('message', 'b');
      await tx.put(row('b', 1)); // relocated: deleted and set again
      // Committed rows first, then the draft's additions in write order.
      expect(await indexed(tx, 1)).toEqual(['new', 'c', 'b']);
      expect((await indexed(tx, 1)).sort()).toEqual((await filtered(tx, 1)).sort());
      expect(await indexed(tx, 3)).toEqual(['a']);
      expect(await indexed(tx, 2)).toEqual([]);
    });
    for (const group of [1, 2, 3]) {
      expect((await store.read((tx) => indexed(tx, group))).sort()).toEqual((await store.read((tx) => filtered(tx, group))).sort());
    }
    // Committed: a row whose key moved lands at the END of its new group (`c` after `new`), not at its list place.
    expect(await store.read((tx) => indexed(tx, 1))).toEqual(['new', 'c', 'b']);
  });

  it('stops at SCAN_STOP and hands out caller-owned clones from selectByIndex', async () => {
    const store = createMemoryLocalFirstStore({ records: [row('a', 1), row('b', 1), row('c', 1)] });
    const seen: string[] = [];
    await store.read((tx) => scanByIndex<Row>(tx, BY_GROUP, 1, (r) => { seen.push(r.id); return r.id === 'b' ? SCAN_STOP : undefined; }));
    expect(seen).toEqual(['a', 'b']);
    const copy = await store.read((tx) => selectByIndex<Row>(tx, BY_GROUP, 1));
    copy[0]!.payload.group = 99;
    expect(await store.read((tx) => indexed(tx, 1))).toEqual(['a', 'b', 'c']);
  });

  it('is rebuilt from a reset (a reload) and stays current across another window\'s deltas', async () => {
    // Window A commits; window B folds each of A's frames in with applyDelta, as the VSIX host does.
    const deltas: LocalFirstDelta[] = [];
    const a = createMemoryLocalFirstStore(undefined, { onCommit: async (delta) => { deltas.push(delta); } });
    const b = createMemoryLocalFirstStore();
    await b.read((tx) => indexed(tx, 1)); // B's index exists before A writes anything
    await a.transact(async (tx) => { await tx.put(row('a', 1)); await tx.put(row('b', 2)); });
    await a.transact(async (tx) => { await tx.put({ ...row('b', 1), version: 2 }); await tx.put(row('c', 1)); });
    await a.transact(async (tx) => { await tx.delete('message', 'a'); });
    for (const delta of deltas) b.applyDelta(delta);
    expect(await b.read((tx) => indexed(tx, 1))).toEqual(['b', 'c']);
    expect(await b.read((tx) => indexed(tx, 2))).toEqual([]);
    // A reload replaces everything: the index keeps its declaration and refills from the reset's rows.
    b.applyDelta({ reset: true, records: [row('x', 2), row('y', 1)] });
    expect(await b.read((tx) => indexed(tx, 1))).toEqual(['y']);
    expect(await b.read((tx) => indexed(tx, 2))).toEqual(['x']);
  });

  it('answers a journal replayed from frames with the same rows as the live, incrementally kept index', async () => {
    const frames: Uint8Array[] = [];
    const live = createMemoryLocalFirstStore(undefined, { onCommit: async (delta) => { frames.push(encodeDeltaFrame(delta)); } });
    // Read BEFORE any write: the live index is built empty and kept by every commit after.
    for (let group = 0; group < 4; group += 1) expect(await live.read((tx) => indexed(tx, group))).toEqual([]);
    await live.transact(async (tx) => { for (let i = 0; i < 30; i += 1) await tx.put(row(`r${i}`, i % 4)); });
    await live.transact(async (tx) => { for (let i = 0; i < 30; i += 3) await tx.put({ ...row(`r${i}`, (i + 1) % 4), version: 2 }); });
    await live.transact(async (tx) => { for (let i = 0; i < 30; i += 5) await tx.delete('message', `r${i}`); });
    const bytes = new Uint8Array(frames.reduce((n, f) => n + f.byteLength, 0));
    let at = 0;
    for (const frame of frames) { bytes.set(frame, at); at += frame.byteLength; }
    const replayed = createMemoryLocalFirstStore(scanJournal(bytes).latest);
    // Group order is unspecified (it depends on history): compare the rows, sorted.
    for (let group = 0; group < 4; group += 1) {
      const expected = (await live.read((tx) => filtered(tx, group))).sort();
      expect((await replayed.read((tx) => indexed(tx, group))).sort()).toEqual(expected);
      expect((await live.read((tx) => indexed(tx, group))).sort()).toEqual(expected);
    }
  });

  it('leaves the committed index untouched when a transaction that read its own writes aborts', async () => {
    const store = createMemoryLocalFirstStore({ records: [row('a', 1), row('b', 2)] });
    expect(await store.read((tx) => indexed(tx, 1))).toEqual(['a']);
    await expect(store.transact(async (tx) => {
      await tx.put(row('c', 1));
      await tx.put({ ...row('b', 1), version: 2 });
      await tx.delete('message', 'a');
      expect((await indexed(tx, 1)).sort()).toEqual(['b', 'c']);
      throw new Error('abort');
    })).rejects.toThrow('abort');
    expect(await store.read((tx) => indexed(tx, 1))).toEqual(['a']);
    expect(await store.read((tx) => indexed(tx, 2))).toEqual(['b']);
  });

  it('leaves the committed index untouched when the commit hook rejects', async () => {
    const store = createMemoryLocalFirstStore({ records: [row('a', 1)] }, { onCommit: async () => { throw new Error('disk full'); } });
    expect(await store.read((tx) => indexed(tx, 1))).toEqual(['a']);
    await expect(store.transact(async (tx) => {
      await tx.put(row('b', 1));
      await tx.put({ ...row('a', 2), version: 2 });
    })).rejects.toThrow('disk full');
    expect(await store.read((tx) => indexed(tx, 1))).toEqual(['a']);
    expect(await store.read((tx) => indexed(tx, 2))).toEqual([]);
  });

  it('re-files a row deleted and re-added in one transaction under a different key', async () => {
    const store = createMemoryLocalFirstStore({ records: [row('a', 1), row('b', 1)] });
    expect((await store.read((tx) => indexed(tx, 1))).sort()).toEqual(['a', 'b']);
    await store.transact(async (tx) => {
      await tx.delete('message', 'a');
      await tx.put(row('a', 2));
      expect(await indexed(tx, 1)).toEqual(['b']);
      expect(await indexed(tx, 2)).toEqual(['a']);
    });
    expect(await store.read((tx) => indexed(tx, 1))).toEqual(['b']);
    expect(await store.read((tx) => indexed(tx, 2))).toEqual(['a']);
  });

  it('keeps tombstoned rows out of every group', async () => {
    const store = createMemoryLocalFirstStore({ records: [row('a', 1), { ...row('gone', 1), deletedAt: '2026-11-10T00:00:00.000Z' }] });
    expect(await store.read((tx) => indexed(tx, 1))).toEqual(['a']);
    await store.transact(async (tx) => {
      await tx.put({ ...row('a', 1), version: 2, deletedAt: '2026-11-10T01:00:00.000Z' });
      expect(await indexed(tx, 1)).toEqual([]);
    });
    expect(await store.read((tx) => indexed(tx, 1))).toEqual([]);
  });

  it('shares one built index between copies of a declaration, and refuses one name with two key functions', async () => {
    const store = createMemoryLocalFirstStore({ records: [row('a', 1), row('b', 2)] });
    // A second bundle (cjs next to mjs) inlines the same declaration: same name, same keyOf source.
    const copy = defineRecordIndex<Row>('message', 'test.group', (row) => row.payload.group);
    expect(await store.read((tx) => indexed(tx, 1))).toEqual(['a']);
    expect(await store.read((tx) => selectByIndex<Row>(tx, copy, 1).then((rows) => rows.map((r) => r.id)))).toEqual(['a']);
    const clash = defineRecordIndex<Row>('message', 'test.group', (row) => row.payload.n);
    await expect(store.read((tx) => selectByIndex<Row>(tx, clash, 0))).rejects.toThrow(/local_first_index_conflict/);
  });

  it('falls back to a filtered scan on a transaction without scanIndex', async () => {
    const store = createMemoryLocalFirstStore({ records: [row('a', 1), row('b', 2), row('c', 1)] });
    const ids = await store.read(async (tx) => {
      const bare: LocalFirstTransaction = { ...tx, get: tx.get.bind(tx), scan: tx.scan.bind(tx), scanIndex: undefined } as LocalFirstTransaction;
      return indexed(bare, 1);
    });
    expect(ids).toEqual(['a', 'c']);
  });

  it('puts a row whose key cannot be read in no group', async () => {
    const broken = { ...row('z', 1), payload: undefined } as unknown as LocalRecord<Row>;
    const store = createMemoryLocalFirstStore({ records: [row('a', 1), broken] });
    expect(await store.read((tx) => indexed(tx, 1))).toEqual(['a']);
  });
});
