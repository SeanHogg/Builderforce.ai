import { describe, expect, it } from 'vitest';
import { commitRecordAndEnqueue, type CommitPair } from './commitWithEnqueue.js';

type Rec = { id: string };
type SyncRow = { id: string; recordId: string };

/**
 * Two in-memory stores. `records` stands in for the local-first snapshot.
 * `sync` stands in for the outbox file. They are different arrays. Only
 * `commit` publishes, and it publishes both in one call.
 */
function fakeStores(options?: {
  failWrite?: boolean;
  failEnqueue?: boolean;
  failCommit?: 'before' | 'after-record';
}) {
  const records: Rec[] = [{ id: 'kept' }];
  const sync: SyncRow[] = [];
  const calls: string[] = [];
  let stagedRecord: Rec | null = null;
  let stagedSync: SyncRow | null = null;

  const store = {
    read: () => (stagedRecord ? [...records, stagedRecord] : records.slice()),
    write(): Rec {
      calls.push('write');
      if (options?.failWrite) throw new Error('record_write_failed');
      stagedRecord = { id: 'new' };
      records.push(stagedRecord);
      return stagedRecord;
    },
    restore(next: readonly Rec[]) {
      calls.push('restore-record');
      records.splice(0, records.length, ...next);
      stagedRecord = null;
    },
    rollback() {
      calls.push('rollback-record');
      stagedRecord = null;
    },
    commit(pair: CommitPair<Rec, SyncRow>) {
      calls.push('commit');
      if (options?.failCommit === 'before') throw new Error('commit_failed');
      if (!records.some((row) => row.id === pair.record.id)) records.push(pair.record);
      stagedRecord = null;
      if (options?.failCommit === 'after-record') throw new Error('commit_failed');
      if (!sync.some((row) => row.id === pair.sync.id)) sync.push(pair.sync);
      stagedSync = null;
    },
  };

  const enqueue = {
    read: () => (stagedSync ? [...sync, stagedSync] : sync.slice()),
    enqueue(record: Rec): SyncRow {
      calls.push('enqueue');
      if (options?.failEnqueue) throw new Error('enqueue_failed');
      stagedSync = { id: `sync-${record.id}`, recordId: record.id };
      sync.push(stagedSync);
      return stagedSync;
    },
    restore(next: readonly SyncRow[]) {
      calls.push('restore-sync');
      sync.splice(0, sync.length, ...next);
      stagedSync = null;
    },
    rollback() {
      calls.push('rollback-sync');
      stagedSync = null;
    },
  };

  return { records, sync, calls, store, enqueue };
}

describe('commitRecordAndEnqueue', () => {
  it('success leaves the record and the sync row from one commit', async () => {
    const fake = fakeStores();

    const pair = await commitRecordAndEnqueue(fake.store, fake.enqueue);

    expect(pair).toEqual({ record: { id: 'new' }, sync: { id: 'sync-new', recordId: 'new' } });
    expect(fake.calls).toEqual(['write', 'restore-record', 'enqueue', 'restore-sync', 'commit']);
    expect(fake.records.map((row) => row.id)).toEqual(['kept', 'new']);
    expect(fake.sync).toEqual([{ id: 'sync-new', recordId: 'new' }]);
    expect(fake.records).not.toBe(fake.sync);
    expect(fake.store.read().some((row) => row.id === 'sync-new')).toBe(false);
    expect(fake.enqueue.read().some((row) => row.recordId === 'kept')).toBe(false);
  });

  it('a throw from enqueue rolls back the record and leaves no sync row', async () => {
    const fake = fakeStores({ failEnqueue: true });

    await expect(commitRecordAndEnqueue(fake.store, fake.enqueue)).rejects.toThrow('enqueue_failed');

    expect(fake.calls).toContain('write');
    expect(fake.calls).toContain('enqueue');
    expect(fake.calls).toContain('rollback-record');
    expect(fake.calls).not.toContain('commit');
    expect(fake.records.map((row) => row.id)).toEqual(['kept']);
    expect(fake.sync).toEqual([]);
    expect(fake.store.read().map((row) => row.id)).toEqual(['kept']);
    expect(fake.enqueue.read()).toEqual([]);
  });

  it('a throw from the record write leaves no enqueue', async () => {
    const fake = fakeStores({ failWrite: true });

    await expect(commitRecordAndEnqueue(fake.store, fake.enqueue)).rejects.toThrow('record_write_failed');

    expect(fake.calls).toContain('write');
    expect(fake.calls).not.toContain('enqueue');
    expect(fake.calls).not.toContain('commit');
    expect(fake.records.map((row) => row.id)).toEqual(['kept']);
    expect(fake.sync).toEqual([]);
    expect(fake.enqueue.read()).toEqual([]);
  });

  it('does not publish either side until commit, and a failed commit restores both', async () => {
    const before = fakeStores({ failCommit: 'before' });
    await expect(commitRecordAndEnqueue(before.store, before.enqueue)).rejects.toThrow('commit_failed');
    expect(before.calls).toContain('commit');
    expect(before.records.map((row) => row.id)).toEqual(['kept']);
    expect(before.sync).toEqual([]);

    const partial = fakeStores({ failCommit: 'after-record' });
    await expect(commitRecordAndEnqueue(partial.store, partial.enqueue)).rejects.toThrow('commit_failed');
    expect(partial.records.map((row) => row.id)).toEqual(['kept']);
    expect(partial.sync).toEqual([]);
    expect(partial.store.read().some((row) => row.id === 'new')).toBe(false);
    expect(partial.enqueue.read()).toEqual([]);
  });

  it('keeps an earlier pair when a later enqueue fails', async () => {
    const fake = fakeStores();
    await commitRecordAndEnqueue(fake.store, fake.enqueue);
    fake.calls.length = 0;

    const failingEnqueue = {
      ...fake.enqueue,
      enqueue() {
        fake.calls.push('enqueue');
        throw new Error('enqueue_failed');
      },
    };
    const secondWrite = {
      ...fake.store,
      write() {
        fake.calls.push('write');
        const staged = { id: 'second' };
        fake.records.push(staged);
        return staged;
      },
    };

    await expect(commitRecordAndEnqueue(secondWrite, failingEnqueue)).rejects.toThrow('enqueue_failed');

    expect(fake.records.map((row) => row.id)).toEqual(['kept', 'new']);
    expect(fake.sync).toEqual([{ id: 'sync-new', recordId: 'new' }]);
  });
});
