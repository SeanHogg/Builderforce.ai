import { describe, expect, it, vi } from 'vitest';
import { UNBOUND_DESTINATION, type JournalEvent } from './records.js';
import {
  changeTouches,
  createMemoryLocalFirstStore,
  newLocalRecord,
  SCAN_STOP,
  selectRecords,
  type AppendJournalEvent,
  type LocalFirstChange,
  type LocalFirstDelta,
} from './store.js';
import { selectPending } from './pendingQueries.js';

const record = (id: string, text = id) => newLocalRecord({ id, entityType: 'ticket', payload: { text }, deviceId: 'd' });
const event = (key: string, extra: Partial<AppendJournalEvent> = {}): AppendJournalEvent => ({
  idempotencyKey: key,
  clientEntityId: key,
  entityType: 'ticket',
  operation: 'create',
  schemaVersion: 1,
  occurredAt: '2026-11-01T00:00:00.000Z',
  dependsOn: [],
  destination: UNBOUND_DESTINATION,
  payload: {},
  ...extra,
});
const ids = async (store: ReturnType<typeof createMemoryLocalFirstStore>) =>
  store.read(async (tx) => (await tx.list()).map((row) => row.id));

describe('copy-on-write transactions', () => {
  it('lists in Map order: an overwrite keeps its place, delete + re-add goes last', async () => {
    const store = createMemoryLocalFirstStore({ records: [record('a'), record('b'), record('c')] });
    await store.transact(async (tx) => {
      await tx.put({ ...record('a'), version: 2 });
      await tx.delete('ticket', 'b');
      await tx.put(record('b', 'again'));
      await tx.put(record('d'));
      await tx.put(record('e'));
      await tx.delete('ticket', 'e');
    });
    expect(await ids(store)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('reads its own writes before they are published, and publishes nothing when work throws', async () => {
    const store = createMemoryLocalFirstStore({ records: [record('a')] });
    await expect(store.transact(async (tx) => {
      await tx.put(record('b'));
      await tx.delete('ticket', 'a');
      expect((await tx.list()).map((row) => row.id)).toEqual(['b']);
      throw new Error('boom');
    })).rejects.toThrow('boom');
    expect(await ids(store)).toEqual(['a']);
  });

  it('keeps the idempotency-key index across commits, acknowledgements and the same transaction', async () => {
    const store = createMemoryLocalFirstStore();
    const first = await store.transact((tx) => tx.append(event('k')));
    const [dupe, dependent] = await store.transact(async (tx) => [
      await tx.append(event('k')),
      await tx.append(event('other', { dependsOn: ['k', 'later'] })),
    ] as const);
    expect(dupe.eventId).toBe(first.eventId);
    expect(dependent.dependsOn).toEqual(['k', 'later']);
    await store.transact((tx) => tx.acknowledge([first.eventId]));
    const next = await store.transact((tx) => tx.append(event('k')));
    expect(next.eventId).not.toBe(first.eventId);
    // Appended and acknowledged in one transaction: the key is free again inside it.
    const [inner, outer] = await store.transact(async (tx) => {
      const appended = await tx.append(event('fresh'));
      await tx.acknowledge([appended.eventId]);
      return [appended, await tx.append(event('fresh'))] as const;
    });
    expect(outer.eventId).not.toBe(inner.eventId);
  });

  it('scans without cloning and selects clones of only the matches', async () => {
    const store = createMemoryLocalFirstStore({ records: [record('a'), record('b')] });
    const seen: unknown[] = [];
    await store.read((tx) => tx.scan('ticket', (row) => { seen.push(row); }));
    const again: unknown[] = [];
    await store.read((tx) => tx.scan('ticket', (row) => { again.push(row); }));
    expect(seen[0]).toBe(again[0]);
    const [picked] = await store.read((tx) => selectRecords(tx, 'ticket', (row) => row.id === 'b'));
    expect(picked).toEqual(seen[1]);
    expect(picked).not.toBe(seen[1]);
  });

  it('typed scan over an EMPTY type touches no rows (the per-type index skips it)', async () => {
    // Two committed types; scanning the one with zero records must not visit anything —
    // the per-type index names none, and the draft tail holds no rows of that type.
    const store = createMemoryLocalFirstStore({ records: [record('a'), record('b')] });
    let visited = 0;
    await store.read((tx) => tx.scan('chat', () => { visited += 1; }));
    expect(visited).toBe(0);
    // Sanity: the populated type still scans its rows.
    await store.read((tx) => tx.scan('ticket', () => { visited += 1; }));
    expect(visited).toBe(2);
  });

  it('SCAN_STOP ends a typed scan at the first match instead of walking the rest', async () => {
    const store = createMemoryLocalFirstStore({ records: [record('a'), record('b'), record('c'), record('d')] });
    const seen: string[] = [];
    await store.read((tx) => tx.scan('ticket', (row) => {
      seen.push(row.id);
      if (row.id === 'b') return SCAN_STOP;
    }));
    // Stopped at 'b': never visited 'c' or 'd'.
    expect(seen).toEqual(['a', 'b']);
  });

  it('typed scan keeps list order across a delete + re-add (relocated tail), visiting each row once', async () => {
    const store = createMemoryLocalFirstStore({ records: [record('a'), record('b'), record('c')] });
    await store.transact(async (tx) => {
      await tx.delete('ticket', 'b');
      await tx.put(record('b', 'again'));
      await tx.put(record('d'));
    });
    const seen: string[] = [];
    await store.read((tx) => tx.scan('ticket', (row) => { seen.push(row.id); }));
    // Same order `list` produces; no row visited twice.
    expect(seen).toEqual(['a', 'c', 'b', 'd']);
  });

  it('SCAN_STOP ends scanPending at the first match', async () => {
    const store = createMemoryLocalFirstStore();
    await store.transact(async (tx) => {
      await tx.append(event('one'));
      await tx.append(event('two'));
      await tx.append(event('three'));
    });
    const seen: (string | undefined)[] = [];
    await store.read((tx) => tx.scanPending((row) => {
      seen.push(row.idempotencyKey);
      if (row.idempotencyKey === 'two') return SCAN_STOP;
    }));
    expect(seen).toEqual(['one', 'two']);
  });

  it('selects pending events by sequence, for one destination', async () => {
    const store = createMemoryLocalFirstStore();
    await store.transact(async (tx) => {
      await tx.append(event('one'));
      await tx.append(event('two', { destination: { kind: 'bound', accountId: 'x' } }));
      await tx.append(event('three'));
    });
    const unbound = await store.read((tx) => selectPending(tx, undefined, UNBOUND_DESTINATION));
    expect(unbound.map((row) => row.idempotencyKey)).toEqual(['one', 'three']);
    const some = await store.read((tx) => selectPending(tx, (row: Readonly<JournalEvent>) => row.idempotencyKey === 'two'));
    expect(some).toHaveLength(1);
  });
});

describe('the commit hook and the change hint', () => {
  it('hands the hook just what changed, and publishes only after it resolves', async () => {
    const deltas: LocalFirstDelta[] = [];
    let visibleDuringHook: string[] = [];
    const store = createMemoryLocalFirstStore({ records: [record('a')] }, {
      onCommit: async (delta) => {
        deltas.push(delta);
        visibleDuringHook = await ids(store);
      },
    });
    await store.transact(async (tx) => { await tx.put(record('b')); });
    expect(deltas).toHaveLength(1);
    expect(deltas[0]?.records?.map((row) => row.id)).toEqual(['b']);
    expect(deltas[0]?.deletedRecords).toBeUndefined();
    expect(visibleDuringHook).toEqual(['a']);
    expect(await ids(store)).toEqual(['a', 'b']);
  });

  it('publishes nothing when the hook fails, and skips the hook for an empty transaction', async () => {
    const onCommit = vi.fn<(delta: LocalFirstDelta) => Promise<void>>(async () => { throw new Error('disk full'); });
    const store = createMemoryLocalFirstStore({}, { onCommit });
    await expect(store.transact(async (tx) => { await tx.put(record('a')); })).rejects.toThrow('disk full');
    expect(await ids(store)).toEqual([]);
    onCommit.mockClear();
    await store.transact(async (tx) => { await tx.get('ticket', 'a'); });
    expect(onCommit).not.toHaveBeenCalled();
    // A failed commit does not wedge the queue.
    onCommit.mockImplementationOnce(async () => undefined);
    await store.transact(async (tx) => { await tx.put(record('a')); });
    expect(await ids(store)).toEqual(['a']);
  });

  it('tells a listener which entity types and rows changed, and still accepts a bare () => void', async () => {
    const store = createMemoryLocalFirstStore();
    const changes: Array<LocalFirstChange | undefined> = [];
    store.subscribe((change) => { changes.push(change); });
    const bare = vi.fn();
    store.subscribe(() => bare());
    await store.transact(async (tx) => {
      await tx.put(record('t1'));
      await tx.append(event('k'));
    });
    await store.transact(async (tx) => { await tx.setCursor(UNBOUND_DESTINATION, 'c'); });
    expect(bare).toHaveBeenCalledTimes(2);
    expect(changeTouches(changes[0], 'ticket', ['t1'])).toBe(true);
    expect(changeTouches(changes[0], 'ticket', ['other'])).toBe(false);
    expect(changeTouches(changes[0], 'message')).toBe(false);
    expect(changes[0]?.events).toBe(true);
    expect(changes[1]).toMatchObject({ events: false, syncState: true });
    expect(changeTouches(undefined, 'message')).toBe(true);
  });

  it('applies another window\'s delta in place, and a reset replaces everything', async () => {
    const store = createMemoryLocalFirstStore({ records: [record('a'), record('b')] });
    const changes: Array<LocalFirstChange | undefined> = [];
    store.subscribe((change) => { changes.push(change); });
    store.applyDelta({ records: [record('c')], deletedRecords: [{ entityType: 'ticket', id: 'a' }], nextSequence: 5 });
    expect(await ids(store)).toEqual(['b', 'c']);
    expect(changeTouches(changes[0], 'ticket', ['a'])).toBe(true);
    store.applyDelta({ reset: true, records: [record('z')] });
    expect(await ids(store)).toEqual(['z']);
    expect(changes[1]).toBeUndefined();
    expect((await store.export()).nextSequence).toBe(1);
  });

  it('refuses a delta while a transaction is running', async () => {
    const store = createMemoryLocalFirstStore();
    await store.transact(async () => {
      expect(() => store.applyDelta({ records: [record('a')] })).toThrow('local_first_apply_during_transaction');
    });
  });
});
