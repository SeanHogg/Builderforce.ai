import { describe, expect, it } from 'vitest';
import {
  defineRecordIndex,
  defineRecordPartition,
  newLocalRecord,
  partitionIdOf,
  stubOf,
  type LocalFirstDelta,
  type LocalRecord,
  type PartitionLoader,
  type PartitionPointer,
} from './index.js';
import { CommittedState } from './storeState.js';

interface Msg { chatId: number; n: number }

const BY_CHAT = defineRecordIndex<Msg>('message', 'test.partitionTable.chat', (row) => row.payload.chatId);
const PARTITION = defineRecordPartition<Msg>({ index: BY_CHAT, homeOf: (row) => row.payload.chatId, ordinalOf: (row) => row.payload.n });

const msg = (id: string, chatId: number, n = 1): LocalRecord<Msg> =>
  newLocalRecord<Msg>({ id, entityType: 'message', payload: { chatId, n }, deviceId: 'd', occurredAt: '2026-11-10T00:00:00.000Z' });

const CHAT_1 = partitionIdOf('message', 1);
const CHAT_2 = partitionIdOf('message', 2);
const pointer = (length: number): PartitionPointer => ({ file: 'chat.journal', length });
const stubDelta = (row: LocalRecord<Msg>, length: number): LocalFirstDelta =>
  ({ stubs: [stubOf(PARTITION, row)!], partitionPointers: { [partitionIdOf('message', row.payload.chatId)]: pointer(length) } });

/** A loader the test settles by hand, so it can move state while a read is in flight. */
function controlledLoader() {
  const pending: Array<{ id: string; pointer: PartitionPointer; from?: { file: string; length: number }; settle: (rows: LocalFirstDelta) => void }> = [];
  const loader: PartitionLoader = {
    load: (id, at, from) => new Promise((resolve) => { pending.push({ id, pointer: at, from, settle: resolve }); }),
  };
  return { loader, pending };
}
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const idsIn = (state: CommittedState, id: string): string[] => [...(state.table.segment(id)?.records.keys() ?? [])];

const stateWith = (loader?: PartitionLoader): CommittedState => {
  const state = new CommittedState();
  state.configurePartitions([PARTITION], loader);
  return state;
};

describe('partition table', () => {
  it('regression: a load racing a pointer move never installs older rows', async () => {
    const { loader, pending } = controlledLoader();
    const state = stateWith(loader);
    state.applyDelta(stubDelta(msg('m1', 1), 1));
    const loading = state.ensureLoaded([CHAT_1]);
    expect(pending).toHaveLength(1);
    // Another window's commit moves the pointer while the first read is still in flight.
    state.applyDelta(stubDelta(msg('m2', 1), 2));
    pending[0]!.settle({ records: [msg('m1', 1)] });
    await flush();
    expect(state.table.segment(CHAT_1)).toBeUndefined(); // the older read was discarded, not installed
    expect(pending).toHaveLength(2);
    expect(pending[1]!.pointer.length).toBe(2);
    pending[1]!.settle({ records: [msg('m1', 1), msg('m2', 1)] });
    await loading;
    expect(idsIn(state, CHAT_1)).toEqual(['m1', 'm2']);
    expect(state.table.segment(CHAT_1)?.loadedTo).toEqual(pointer(2));
  });

  it('regression: concurrent reads of one partition share ONE in-flight load', async () => {
    const { loader, pending } = controlledLoader();
    const state = stateWith(loader);
    state.applyDelta(stubDelta(msg('m1', 1), 1));
    const reads = [state.ensureLoaded([CHAT_1]), state.ensureLoaded([CHAT_1]), state.ensureLoaded([CHAT_1])];
    expect(pending).toHaveLength(1);
    pending[0]!.settle({ records: [msg('m1', 1)] });
    await Promise.all(reads);
    await state.ensureLoaded([CHAT_1]); // current now: nothing to read
    expect(pending).toHaveLength(1);
  });

  it('regression: a stale segment catches up lazily, from where it was read to', async () => {
    const { loader, pending } = controlledLoader();
    const state = stateWith(loader);
    state.applyDelta(stubDelta(msg('m1', 1), 1));
    state.applyDelta(stubDelta(msg('o1', 2), 1));
    const first = state.ensureLoaded([CHAT_1]);
    pending[0]!.settle({ records: [msg('m1', 1)] });
    await first;
    // A foreign commit appended to chat 1 and chat 2: its stubs and pointers arrive, not its rows.
    state.applyDelta(stubDelta(msg('m2', 1), 2));
    state.applyDelta(stubDelta(msg('o2', 2), 2));
    expect(state.table.segment(CHAT_1)?.stale).toBe(true);
    expect(pending).toHaveLength(1); // nothing was read by the delta itself
    const catchUp = state.ensureLoaded([CHAT_1]);
    expect(pending[1]!.from).toEqual({ file: 'chat.journal', length: 1 });
    pending[1]!.settle({ records: [msg('m2', 1)] });
    await catchUp;
    expect(idsIn(state, CHAT_1)).toEqual(['m1', 'm2']);
    expect(state.table.segment(CHAT_1)?.stale).toBe(false);
    expect(state.table.segment(CHAT_2)).toBeUndefined(); // never loaded, so never touched
    expect(pending).toHaveLength(2);
  });

  it('regression: a delta that carries a loaded segment\'s rows keeps it current, a foreign one does not', async () => {
    const { loader, pending } = controlledLoader();
    const state = stateWith(loader);
    state.applyDelta(stubDelta(msg('m1', 1), 1));
    const loading = state.ensureLoaded([CHAT_1]);
    pending[0]!.settle({ records: [msg('m1', 1)] });
    await loading;
    state.applyDelta({ ...stubDelta(msg('m2', 1), 2), records: [msg('m2', 1)] }); // our own commit: rows and pointer together
    expect(state.table.segment(CHAT_1)?.stale).toBe(false);
    await state.ensureLoaded([CHAT_1]);
    expect(pending).toHaveLength(1);
    expect(idsIn(state, CHAT_1)).toEqual(['m1', 'm2']);
  });

  it('regression: rows for a partition that is in storage but not in memory are not kept', () => {
    const { loader } = controlledLoader();
    const state = stateWith(loader);
    state.applyDelta(stubDelta(msg('m1', 1), 1));
    state.applyDelta({ ...stubDelta(msg('m2', 1), 2), records: [msg('m2', 1)] });
    expect(state.table.segment(CHAT_1)).toBeUndefined(); // its file holds the row; a later load reads it
    expect(state.table.stub('message', 'm2')).toBeDefined();
  });

  it('regression: a reset drops every segment, stub and pointer', async () => {
    const state = stateWith();
    state.applyDelta({ ...stubDelta(msg('m1', 1), 1), records: [msg('m1', 1)] });
    expect(idsIn(state, CHAT_1)).toEqual(['m1']);
    state.applyDelta({ reset: true });
    expect(state.table.segment(CHAT_1)).toBeUndefined();
    expect(state.table.stub('message', 'm1')).toBeUndefined();
    expect(state.view().partitionPointers).toBeUndefined();
  });

  it('regression: partitioned rows are never in the records Map, and the view holds stubs not rows', () => {
    const state = stateWith();
    state.applyDelta({ records: [msg('m1', 1), msg('m2', 2)] });
    expect(state.records.size).toBe(0);
    const view = state.view();
    expect(view.records).toEqual([]);
    expect(view.stubs?.map((stub) => stub.id)).toEqual(['m1', 'm2']);
  });

  it('regression: a snapshot carrying stubs, pointers and declarations restores them', () => {
    const source = stateWith();
    source.applyDelta({
      ...stubDelta(msg('m1', 1), 1),
      partitionDeclarations: [{ entityType: 'message', index: BY_CHAT.name }],
    });
    const restored = CommittedState.from(source.view());
    expect(restored.table.stub('message', 'm1')?.home).toBe(1);
    expect(restored.table.pointer(CHAT_1)).toEqual(pointer(1));
    expect(restored.view().partitionDeclarations).toEqual([{ entityType: 'message', index: BY_CHAT.name }]);
  });

  it('regression: a row that moves home leaves its old segment', () => {
    const state = stateWith();
    state.applyDelta({ records: [msg('m1', 1)] });
    state.applyDelta({ records: [{ ...msg('m1', 2), version: 2 }] });
    expect(idsIn(state, CHAT_1)).toEqual([]);
    expect(idsIn(state, CHAT_2)).toEqual(['m1']);
    expect(state.table.stub('message', 'm1')?.home).toBe(2);
  });
});
