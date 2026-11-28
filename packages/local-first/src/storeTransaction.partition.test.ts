import { describe, expect, it } from 'vitest';
import {
  SCAN_STOP,
  changeTouches,
  createMemoryLocalFirstStore,
  defineRecordIndex,
  defineRecordPartition,
  newLocalRecord,
  partitionIdOf,
  scanByIndex,
  selectByIndex,
  splitPartitionedDelta,
  stubOf,
  type LocalFirstChange,
  type LocalFirstDelta,
  type LocalRecord,
  type PartitionLoader,
  type PartitionPointer,
  type RecordStub,
} from './index.js';

interface Msg { chatId: number; n: number }

const BY_CHAT = defineRecordIndex<Msg>('message', 'test.partition.chat', (row) => row.payload.chatId);
const BY_PARITY = defineRecordIndex<Msg>('message', 'test.partition.parity', (row) => row.payload.n % 2);
const PARTITION = defineRecordPartition<Msg>({ index: BY_CHAT, homeOf: (row) => row.payload.chatId, ordinalOf: (row) => row.payload.n });
const DECLARATIONS = [{ entityType: 'message' as const, index: BY_CHAT.name }];

const msg = (id: string, chatId: number, n = 1): LocalRecord<Msg> =>
  newLocalRecord<Msg>({ id, entityType: 'message', payload: { chatId, n }, deviceId: 'dev-a', occurredAt: '2026-11-10T00:00:00.000Z' });

const pid = (chatId: number): string => partitionIdOf('message', chatId);
const pointer = (length: number): PartitionPointer => ({ file: 'f.journal', length });

/** What the host's partition files hold: each partition's rows in append order, so a pointer's length is a row count. */
function disk(files: Record<number, LocalRecord<Msg>[]>) {
  const calls: Array<{ id: string; from?: { file: string; length: number } }> = [];
  const loader: PartitionLoader = {
    async load(id, at, from) {
      calls.push({ id, from });
      const chat = Number(id.split('\u0000')[1]);
      return { records: (files[chat] ?? []).slice(from?.length ?? 0, at.length) };
    },
  };
  /** The stub-only delta another window's commit sends: stubs and pointers, no rows. */
  const foreignDelta = (): LocalFirstDelta => ({
    stubs: Object.values(files).flat().map((row) => stubOf(PARTITION, row)!),
    partitionPointers: Object.fromEntries(Object.entries(files).map(([chat, rows]) => [pid(Number(chat)), pointer(rows.length)])),
  });
  return { loader, calls, foreignDelta };
}

const idsOf = (rows: readonly LocalRecord[]): string[] => rows.map((row) => row.id).sort();

describe('partitioned transactions', () => {
  it('regression: a store with no partitions behaves as before', async () => {
    const store = createMemoryLocalFirstStore();
    await store.transact(async (tx) => {
      await tx.put(msg('m1', 1));
      await tx.put(msg('m2', 2));
    });
    const view = store.view();
    expect(idsOf(view.records)).toEqual(['m1', 'm2']);
    expect(view).not.toHaveProperty('stubs');
    expect(view).not.toHaveProperty('partitionPointers');
    await store.read(async (tx) => {
      const stubs: RecordStub[] = [];
      await tx.scanStubs?.('message', (stub) => { stubs.push({ ...stub }); });
      expect(stubs).toEqual([]);
      expect(await tx.stub?.('message', 'm1')).toBeUndefined();
    });
  });

  it('regression: with partitions and no loader every row is resident, filed by home, and export is whole', async () => {
    const store = createMemoryLocalFirstStore(undefined, { partitions: [PARTITION] });
    await store.transact(async (tx) => {
      await tx.put(msg('m1', 1));
      await tx.put(msg('m2', 2));
      await tx.put(newLocalRecord({ id: 'c1', entityType: 'chat', payload: { title: 'x' }, deviceId: 'dev-a' }));
    });
    expect(store.view().records.map((row) => row.id)).toEqual(['c1']); // the view holds no partitioned row
    expect(store.view().stubs?.map((stub) => stub.id)).toEqual(['m1', 'm2']);
    expect(idsOf((await store.export()).records)).toEqual(['c1', 'm1', 'm2']);
    expect(idsOf(await store.read((tx) => tx.list('message')))).toEqual(['m1', 'm2']);
    const again = createMemoryLocalFirstStore(await store.export(), { partitions: [PARTITION] });
    expect(again.view().stubs?.map((stub) => stub.id)).toEqual(['m1', 'm2']); // an export re-files under the same partitions
  });

  it('regression: get and scanIndex load exactly the partition they need', async () => {
    const files = { 1: [msg('a1', 1), msg('a2', 1)], 2: [msg('b1', 2)], 3: [msg('c1', 3)] };
    const { loader, calls, foreignDelta } = disk(files);
    const store = createMemoryLocalFirstStore(undefined, { partitions: [PARTITION], loader });
    store.applyDelta(foreignDelta());
    expect(calls).toHaveLength(0); // applying stubs and pointers reads nothing
    expect((await store.read((tx) => tx.get('message', 'b1')))?.id).toBe('b1');
    expect(calls.map((call) => call.id)).toEqual([pid(2)]);
    expect(idsOf(await store.read((tx) => selectByIndex<Msg>(tx, BY_CHAT, 1)))).toEqual(['a1', 'a2']);
    expect(calls.map((call) => call.id)).toEqual([pid(2), pid(1)]);
    await store.read((tx) => tx.get('message', 'a1')); // already in memory: no further read
    expect(calls).toHaveLength(2);
    expect(await store.read((tx) => tx.get('message', 'nope'))).toBeUndefined(); // no stub means absent, without a load
    expect(calls).toHaveLength(2);
  });

  it('regression: a whole-type scan, a list and another index load every partition', async () => {
    const { loader, calls, foreignDelta } = disk({ 1: [msg('a1', 1, 1)], 2: [msg('b1', 2, 2)], 3: [msg('c1', 3, 3)] });
    const store = createMemoryLocalFirstStore(undefined, { partitions: [PARTITION], loader });
    store.applyDelta(foreignDelta());
    expect(idsOf(await store.read((tx) => tx.list('message')))).toEqual(['a1', 'b1', 'c1']);
    expect(calls).toHaveLength(3);
    const other = createMemoryLocalFirstStore(undefined, { partitions: [PARTITION], loader });
    other.applyDelta(foreignDelta());
    expect(idsOf(await other.read((tx) => selectByIndex<Msg>(tx, BY_PARITY, 1)))).toEqual(['a1', 'c1']);
    expect(calls).toHaveLength(6); // an index that is not the partition's own cannot know which partitions hold its group
    const all = createMemoryLocalFirstStore(undefined, { partitions: [PARTITION], loader });
    all.applyDelta(foreignDelta());
    const seen: string[] = [];
    await all.read((tx) => tx.scan(undefined, (row) => { seen.push(row.id); return seen.length === 1 ? SCAN_STOP : undefined; }));
    expect(seen).toHaveLength(1);
  });

  it('regression: a tombstoned row stays in its partition and the index still filters it', async () => {
    const store = createMemoryLocalFirstStore(undefined, { partitions: [PARTITION] });
    await store.transact(async (tx) => {
      await tx.put(msg('m1', 1));
      await tx.put(msg('m2', 1));
    });
    await store.transact(async (tx) => { await tx.put({ ...msg('m1', 1), version: 2, deletedAt: '2026-11-11T00:00:00.000Z' }); });
    expect(store.view().stubs?.find((stub) => stub.id === 'm1')).toMatchObject({ home: 1, deleted: true });
    expect(idsOf(await store.read((tx) => selectByIndex<Msg>(tx, BY_CHAT, 1)))).toEqual(['m2']);
    expect((await store.read((tx) => tx.get('message', 'm1')))?.deletedAt).toBeDefined();
  });

  it('regression: a put that changes a row\'s home moves it in ONE delta', async () => {
    const deltas: LocalFirstDelta[] = [];
    const store = createMemoryLocalFirstStore(undefined, { partitions: [PARTITION], onCommit: async (delta) => { deltas.push(delta); } });
    await store.transact(async (tx) => { await tx.put(msg('m1', 1)); });
    await store.transact(async (tx) => { await tx.put({ ...msg('m1', 2), version: 2 }, 1); });
    const move = deltas[1]!;
    expect(move.records?.map((row) => row.id)).toEqual(['m1']);
    expect(move.deletedRecords).toEqual([{ entityType: 'message', id: 'm1' }]);
    expect(move.deletedStubs).toEqual([{ entityType: 'message', id: 'm1', home: 1 }]);
    expect(move.stubs?.[0]?.home).toBe(2);
    const { main, partitions } = splitPartitionedDelta(move, DECLARATIONS);
    expect(partitions.get(pid(1))?.deletedRecords).toEqual([{ entityType: 'message', id: 'm1' }]);
    expect(partitions.get(pid(1))?.records).toBeUndefined();
    expect(partitions.get(pid(2))?.records?.map((row) => row.id)).toEqual(['m1']);
    expect(main.records).toBeUndefined();
    expect(idsOf(await store.read((tx) => selectByIndex<Msg>(tx, BY_CHAT, 1)))).toEqual([]);
    expect(idsOf(await store.read((tx) => selectByIndex<Msg>(tx, BY_CHAT, 2)))).toEqual(['m1']);
  });

  it('regression: a delta deletion of a partitioned row does not throw, loaded or not', async () => {
    const { loader, calls, foreignDelta } = disk({ 1: [msg('a1', 1)], 2: [msg('b1', 2)] });
    const deltas: LocalFirstDelta[] = [];
    const store = createMemoryLocalFirstStore(undefined, { partitions: [PARTITION], loader, onCommit: async (delta) => { deltas.push(delta); } });
    store.applyDelta(foreignDelta());
    expect(await store.transact((tx) => tx.delete('message', 'a1'))).toBe(true); // its partition is loaded first
    expect(calls.map((call) => call.id)).toEqual([pid(1)]);
    expect(deltas[0]?.deletedRecords).toEqual([{ entityType: 'message', id: 'a1' }]);
    expect(deltas[0]?.deletedStubs).toEqual([{ entityType: 'message', id: 'a1', home: 1 }]);
    expect(await store.read((tx) => tx.get('message', 'a1'))).toBeUndefined();
    expect(await store.transact((tx) => tx.delete('message', 'missing'))).toBe(false);
  });

  it('regression: scanStubs and stub see the draft\'s own writes and load nothing', async () => {
    const { loader, calls, foreignDelta } = disk({ 1: [msg('a1', 1, 10), msg('a2', 1, 11)], 2: [msg('b1', 2, 12)] });
    const store = createMemoryLocalFirstStore(undefined, { partitions: [PARTITION], loader });
    store.applyDelta(foreignDelta());
    await store.transact(async (tx) => {
      expect((await tx.stub?.('message', 'a1'))?.ordinal).toBe(10);
      await tx.put(msg('new', 3, 99));
      await tx.put({ ...msg('a2', 1, 11), version: 2, deletedAt: '2026-11-11T00:00:00.000Z' });
      await tx.put({ ...msg('b1', 5, 12), version: 2 }); // re-homed
      await tx.delete('message', 'a1');
      const seen = new Map<string, RecordStub>();
      await tx.scanStubs?.('message', (stub) => { seen.set(stub.id, { ...stub }); });
      expect([...seen.keys()].sort()).toEqual(['a2', 'b1', 'new']);
      expect(seen.get('a2')?.deleted).toBe(true);
      expect(seen.get('b1')?.home).toBe(5);
      expect(seen.get('new')).toMatchObject({ home: 3, ordinal: 99 });
      expect(await tx.stub?.('message', 'a1')).toBeUndefined();
      expect((await tx.stub?.('message', 'new'))?.ordinal).toBe(99);
      let visits = 0;
      await tx.scanStubs?.('message', () => { visits += 1; return SCAN_STOP; });
      expect(visits).toBe(1);
    });
    // `put` loads the row's CURRENT partition (its version, and what a re-home deletes from); the stub reads load nothing.
    expect(calls.map((call) => call.id)).toEqual([pid(1), pid(2)]);
  });

  it('regression: the partition declarations are persisted by the first commit only', async () => {
    const deltas: LocalFirstDelta[] = [];
    const store = createMemoryLocalFirstStore(undefined, { partitions: [PARTITION], onCommit: async (delta) => { deltas.push(delta); } });
    await store.transact(async (tx) => {
      await tx.put(msg('m1', 1));
      await tx.put(newLocalRecord({ id: 'c1', entityType: 'chat', payload: { title: 'x' }, deviceId: 'dev-a' }));
    });
    expect(deltas[0]?.partitionDeclarations).toEqual(DECLARATIONS);
    await store.transact(async (tx) => { await tx.put({ ...msg('m1', 1), version: 2 }); });
    expect(deltas[1]?.partitionDeclarations).toBeUndefined(); // persisted by the first commit
  });

  it('regression: splitPartitionedDelta puts no partitioned row in main', async () => {
    const deltas: LocalFirstDelta[] = [];
    const store = createMemoryLocalFirstStore(undefined, { partitions: [PARTITION], onCommit: async (delta) => { deltas.push(delta); } });
    await store.transact(async (tx) => {
      await tx.put(msg('m1', 1));
      await tx.put(msg('m2', 2));
      await tx.put(newLocalRecord({ id: 'c1', entityType: 'chat', payload: { title: 'x' }, deviceId: 'dev-a' }));
      await tx.putMapping({ destination: { kind: 'unbound' }, entityType: 'message', clientEntityId: 'm1', syncId: 5, serverVersion: 1 });
    });
    const { main, partitions } = splitPartitionedDelta(deltas[0]!, DECLARATIONS);
    expect(main.records?.map((row) => row.id)).toEqual(['c1']);
    expect(main.stubs?.map((stub) => stub.id)).toEqual(['m1', 'm2']);
    expect(main.mappings).toHaveLength(1);
    expect(main.partitionDeclarations).toEqual(DECLARATIONS);
    expect([...partitions.keys()]).toEqual([pid(1), pid(2)]);
    expect(partitions.get(pid(1))?.records?.map((row) => row.id)).toEqual(['m1']);
    expect(partitions.get(pid(1))).not.toHaveProperty('stubs');
    // A delta with nothing partitioned is its own main.
    const plain: LocalFirstDelta = { cursors: { k: 'v' } };
    expect(splitPartitionedDelta(plain, DECLARATIONS)).toEqual({ main: plain, partitions: new Map() });
  });

  it('regression: a foreign stub-only delta names the partitioned row ids', async () => {
    const store = createMemoryLocalFirstStore(undefined, { partitions: [PARTITION] });
    const changes: Array<LocalFirstChange | undefined> = [];
    store.subscribe((change) => { changes.push(change); });
    store.applyDelta({ stubs: [stubOf(PARTITION, msg('m9', 5))!], partitionPointers: { [pid(5)]: pointer(1) } });
    expect(changeTouches(changes[0], 'message', ['m9'])).toBe(true);
    expect(changeTouches(changes[0], 'message', ['other'])).toBe(false);
    store.applyDelta({ deletedStubs: [{ entityType: 'message', id: 'm9', home: 5 }] });
    expect(changeTouches(changes[1], 'message', ['m9'])).toBe(true);
    expect(store.view().stubs).toBeUndefined();
  });

  it('regression: a reset drops the loaded partitions and a later read loads them again', async () => {
    const { loader, calls, foreignDelta } = disk({ 1: [msg('a1', 1)] });
    const store = createMemoryLocalFirstStore(undefined, { partitions: [PARTITION], loader });
    store.applyDelta(foreignDelta());
    await store.read((tx) => tx.get('message', 'a1'));
    store.applyDelta({ reset: true, ...foreignDelta() });
    await store.read((tx) => tx.get('message', 'a1'));
    expect(calls).toHaveLength(2);
  });

  it('regression: a stale partition catches up on the next read, from where it was', async () => {
    const files = { 1: [msg('a1', 1)] as LocalRecord<Msg>[] };
    const { loader, calls, foreignDelta } = disk(files);
    const store = createMemoryLocalFirstStore(undefined, { partitions: [PARTITION], loader });
    store.applyDelta(foreignDelta());
    await store.read((tx) => tx.get('message', 'a1'));
    files[1].push(msg('a2', 1)); // another window appended to the partition file
    store.applyDelta(foreignDelta());
    expect(calls).toHaveLength(1); // applying the foreign commit reads nothing
    expect((await store.read((tx) => tx.get('message', 'a2')))?.id).toBe('a2');
    expect(calls[1]).toEqual({ id: pid(1), from: { file: 'f.journal', length: 1 } });
    expect(idsOf(await store.read((tx) => selectByIndex<Msg>(tx, BY_CHAT, 1)))).toEqual(['a1', 'a2']);
    expect(calls).toHaveLength(2);
  });

  it('regression: scanByIndex on the partition\'s own index sees the draft\'s rows beside the committed ones', async () => {
    const store = createMemoryLocalFirstStore(undefined, { partitions: [PARTITION] });
    await store.transact(async (tx) => { await tx.put(msg('m1', 1)); await tx.put(msg('m2', 1)); });
    await store.transact(async (tx) => {
      await tx.put(msg('m3', 1));
      await tx.delete('message', 'm1');
      const seen: string[] = [];
      await scanByIndex<Msg>(tx, BY_CHAT, 1, (row) => { seen.push(row.id); });
      expect(seen.sort()).toEqual(['m2', 'm3']);
    });
  });
});
