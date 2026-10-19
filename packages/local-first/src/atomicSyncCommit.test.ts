import { describe, expect, it } from 'vitest';
import {
  applyAtomicSyncCommit,
  planAtomicSyncCommit,
  stableSyncEventId,
  type PlannedSyncEvent,
} from './atomicSyncCommit.js';
import { type JournalEvent, type LocalRecord } from './records.js';
import {
  createMemoryLocalFirstStore,
  newLocalRecord,
  type LocalFirstStore,
  type LocalFirstTransaction,
} from './store.js';

const AT = '2026-10-19T12:00:00.000Z';

function ticket(id = 'ticket-1', version = 1, title = 'offline'): LocalRecord<{ title: string }> {
  const record = newLocalRecord({
    id,
    entityType: 'ticket',
    payload: { title },
    deviceId: 'device-1',
    occurredAt: AT,
  });
  return { ...record, version, ...(version > 1 ? { baseVersion: version - 1 } : {}) };
}

function failingAppendStore(seed?: { records: LocalRecord[]; events: JournalEvent[] }): {
  store: Pick<LocalFirstStore, 'transact'>;
  committed: { records: LocalRecord[]; events: JournalEvent[] };
  calls: { transact: number; put: number; append: number };
} {
  const committed = {
    records: [...(seed?.records ?? [])],
    events: [...(seed?.events ?? [])],
  };
  const calls = { transact: 0, put: 0, append: 0 };
  const store = {
    async transact<R>(work: (tx: LocalFirstTransaction) => Promise<R>): Promise<R> {
      calls.transact += 1;
      const draft = {
        records: [...committed.records],
        events: [...committed.events],
      };
      const tx = {
        async put(record: LocalRecord) {
          calls.put += 1;
          const index = draft.records.findIndex((row) => row.entityType === record.entityType && row.id === record.id);
          if (index >= 0) draft.records[index] = record;
          else draft.records.push(record);
        },
        async append() {
          calls.append += 1;
          throw new Error('append_failed');
        },
      } as unknown as LocalFirstTransaction;
      const result = await work(tx);
      committed.records = draft.records;
      committed.events = draft.events;
      return result;
    },
  };
  return { store, committed, calls };
}

describe('planAtomicSyncCommit', () => {
  it('plans a stable event id of entityType:clientId:version', () => {
    const first = planAtomicSyncCommit({ record: ticket('abc', 2, 'retry') });
    const second = planAtomicSyncCommit({ record: ticket('abc', 2, 'retry') });

    expect(first.event.eventId).toBe('ticket:abc:2');
    expect(first.event.eventId).toBe(stableSyncEventId('ticket', 'abc', 2));
    expect(second.event.eventId).toBe(first.event.eventId);
    expect(second.event.clientEntityId).toBe('abc');
    expect(second.event.operation).toBe('update');
    expect(first.record).toEqual(second.record);
    expect(planAtomicSyncCommit({ record: ticket('abc', 3) }).event.eventId).toBe('ticket:abc:3');
  });
});

describe('applyAtomicSyncCommit', () => {
  it('commits the record and the journal event in one transaction', async () => {
    const store = createMemoryLocalFirstStore();
    let transacts = 0;
    const watched: Pick<LocalFirstStore, 'transact'> = {
      transact(work) {
        transacts += 1;
        return store.transact(work);
      },
    };
    const plan = planAtomicSyncCommit({ record: ticket('ticket-1', 1, 'offline') });

    const saved = await applyAtomicSyncCommit(watched, plan);

    expect(transacts).toBe(1);
    expect(saved.eventId).toBe('ticket:ticket-1:1');
    expect(saved.clientEntityId).toBe('ticket-1');
    expect(saved.localSequence).toBe(1);
    expect(saved.payloadHash).toMatch(/^fnv1a:/);
    const snapshot = await store.export();
    expect(snapshot.records).toEqual([plan.record]);
    expect(snapshot.events).toEqual([saved]);
    expect(snapshot.events.map((event) => event.eventId)).toEqual(['ticket:ticket-1:1']);
  });

  it('leaves neither the record nor the event when append throws', async () => {
    const seedRecord = ticket('seed-ticket', 1, 'already here');
    const seedPlan = planAtomicSyncCommit({ record: seedRecord });
    const seedEvent = { ...seedPlan.event, localSequence: 1, payloadHash: 'fnv1a:seed' };
    const before = { records: [seedRecord], events: [seedEvent] };
    const { store, committed, calls } = failingAppendStore(before);

    await expect(applyAtomicSyncCommit(store, planAtomicSyncCommit({ record: ticket('ticket-2') }))).rejects.toThrow(
      'append_failed',
    );

    expect(calls.transact).toBe(1);
    expect(calls.put).toBe(1);
    expect(calls.append).toBe(1);
    expect(committed).toEqual(before);
    expect(committed.records.map((row) => row.id)).not.toContain('ticket-2');
    expect(committed.events.map((row) => row.eventId)).not.toContain('ticket:ticket-2:1');
  });

  it('keeps the same event id when the same version is retried', async () => {
    const store = createMemoryLocalFirstStore();
    const plan = planAtomicSyncCommit({ record: ticket('ticket-9', 4, 'same') });
    const again = planAtomicSyncCommit({ record: ticket('ticket-9', 4, 'same') });

    expect(again.event.eventId).toBe(plan.event.eventId);
    expect(again.event.eventId).toBe('ticket:ticket-9:4');

    const saved = await applyAtomicSyncCommit(store, plan);
    const retried = await applyAtomicSyncCommit(store, again);
    const snapshot = await store.export();

    expect(retried.eventId).toBe(saved.eventId);
    expect(snapshot.records).toHaveLength(1);
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.events[0]?.eventId).toBe('ticket:ticket-9:4');
    expect(snapshot.nextSequence).toBe(2);
  });

  it('refuses a store with no transaction instead of writing the record alone', async () => {
    const plan = planAtomicSyncCommit({ record: ticket('ticket-1') });
    await expect(applyAtomicSyncCommit({} as LocalFirstStore, plan)).rejects.toThrow(
      'atomic_sync_commit_requires_transact',
    );
  });

  it('does not open a transaction when the planned event id is not the stable id', async () => {
    const store = createMemoryLocalFirstStore();
    const plan = planAtomicSyncCommit({ record: ticket('ticket-1', 1) });
    const tampered = { ...plan, event: { ...plan.event, eventId: 'evt-random' } satisfies PlannedSyncEvent };

    await expect(applyAtomicSyncCommit(store, tampered)).rejects.toThrow('atomic_sync_event_id_unstable');
    expect(await store.export()).toEqual(await createMemoryLocalFirstStore().export());
  });
});
