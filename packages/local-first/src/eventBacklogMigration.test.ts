import { describe, expect, it } from 'vitest';
import {
  createMemoryLocalFirstStore,
  createSyncCoordinator,
  newLocalRecord,
  planEventBacklogMigration,
  queueImport,
  type EntityDestination,
  MARKER_NOT_BEFORE,
  type JournalEvent,
  type LocalFirstSnapshot,
  type LocalRecord,
  type MemoryLocalFirstStore,
  type SyncPushBatch,
  type SyncReceipt,
  type SyncTransport,
} from './index.js';
import { hashPayload } from './payloadHash.js';
import { recordPayloadMarker } from './recordPayloadMarker.js';
import { batchEvents } from './syncBatch.js';

const BOUND: EntityDestination = { kind: 'bound', platformInstance: 'https://example.test', tenantId: '1' };
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** A store as a pre-marker build left it: unbound message rows, each with an event carrying its payload. */
async function legacyStore(count: number): Promise<MemoryLocalFirstStore> {
  const store = createMemoryLocalFirstStore();
  await store.transact(async (tx) => {
    for (let index = 0; index < count; index += 1) {
      const record = newLocalRecord({ id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, entityType: 'message', payload: { chatId: 1, message: { id: index, content: `m${index}` } }, deviceId: 'd1' });
      await tx.put(record);
      await tx.append({
        idempotencyKey: `message:${index}`,
        clientEntityId: record.id,
        entityType: 'message',
        operation: 'create',
        schemaVersion: 1,
        occurredAt: record.occurredAt,
        dependsOn: [],
        destination: { kind: 'unbound' },
        payload: record.payload,
      });
    }
  });
  return store;
}

const apply = (store: MemoryLocalFirstStore, plan: ReturnType<typeof planEventBacklogMigration>): void => {
  for (const delta of plan.deltas) store.applyDelta(delta);
};

describe('planEventBacklogMigration', () => {
  it('turns a payload copy into the marker the live path writes, only when the row matches', async () => {
    const store = await legacyStore(3);
    const before = store.view();
    // The second row moved on after its event: its copy is NOT the row's, so it is kept.
    const moved = { ...before.records[1]!, payload: { chatId: 1, message: { id: 1, content: 'edited' } } };
    store.applyDelta({ records: [moved] });

    const plan = planEventBacklogMigration(store.view());
    expect(plan).toMatchObject({ stripped: 2, dropped: 0, kept: 1 });
    apply(store, plan);

    const after = store.view();
    const byRow = new Map(after.events.map((event) => [event.clientEntityId, event]));
    for (const index of [0, 2]) {
      const original = before.events[index]!;
      const marker = byRow.get(original.clientEntityId)!;
      const row = after.records.find((record) => record.id === original.clientEntityId)!;
      // Same identity and place in the journal; payload replaced by size + hash of the row's payload.
      expect(marker).toMatchObject({
        eventId: original.eventId,
        localSequence: original.localSequence,
        idempotencyKey: original.idempotencyKey,
        payload: null,
        payloadSize: JSON.stringify(row.payload).length,
        payloadHash: hashPayload(row.payload),
      });
    }
    expect(byRow.get(before.events[1]!.clientEntityId)!.payload).toEqual(before.events[1]!.payload);
    expect(after.events.map((event) => event.eventId)).toEqual(before.events.map((event) => event.eventId));
  });

  it('drops an orphan (its row is gone) and an event a receipt already settled', async () => {
    const store = await legacyStore(3);
    const [first, second] = store.view().events;
    store.applyDelta({ deletedRecords: [{ entityType: 'message', id: first!.clientEntityId }] });
    const receipt: SyncReceipt = { eventId: second!.eventId, status: 'accepted' } as SyncReceipt;
    store.applyDelta({ receipts: [receipt] });

    const plan = planEventBacklogMigration(store.view());
    expect(plan).toMatchObject({ stripped: 1, dropped: 2, kept: 0 });
    apply(store, plan);
    expect(store.view().events).toHaveLength(1);
  });

  it('is idempotent: the migrated state plans nothing', async () => {
    const store = await legacyStore(5);
    apply(store, planEventBacklogMigration(store.view()));
    expect(planEventBacklogMigration(store.view())).toEqual({ deltas: [], stripped: 0, dropped: 0, kept: 0 });
  });

  const event = (over: Partial<JournalEvent>): JournalEvent => ({
    eventId: over.eventId ?? 'e', clientEntityId: 'row', entityType: 'message', operation: 'import', schemaVersion: 1,
    occurredAt: '2026-01-01T00:00:00.000Z', dependsOn: [], destination: BOUND, payload: { a: 1 }, payloadHash: 'h', localSequence: 1, ...over,
  } as JournalEvent);
  const boundRow = (payload: unknown, over: Partial<LocalRecord> = {}): LocalRecord =>
    ({ ...newLocalRecord({ id: 'row', entityType: 'message', payload, deviceId: 'd' }), destination: BOUND, ...over });

  it('leaves bound writes that are not imports, and types whose live writes still carry payloads, alone', () => {
    const snapshot: Pick<LocalFirstSnapshot, 'records' | 'events' | 'receipts'> = {
      records: [boundRow({ a: 1 })],
      events: [event({ eventId: 'update', operation: 'update' }), event({ eventId: 'ticket', entityType: 'ticket', destination: { kind: 'unbound' } })],
      receipts: [],
    };
    expect(planEventBacklogMigration(snapshot).deltas).toEqual([]);
  });

  it('turns a bound import carrying the row\'s payload into a record-payload marker; a sent (held) or stale one keeps its copy', () => {
    const plan = planEventBacklogMigration({
      records: [boundRow({ a: 1 }), { ...boundRow({ a: 2 }), id: 'stale' }, { ...boundRow({ a: 3 }), id: 'held' }, { ...boundRow({ a: 4 }), id: 'gone', deletedAt: 'x' }],
      events: [
        event({ eventId: 'fresh' }),
        event({ eventId: 'stale', clientEntityId: 'stale', payload: { a: 'old' } }),
        event({ eventId: 'held', clientEntityId: 'held', payload: { a: 3 }, holdAttempts: 1 }),
        event({ eventId: 'gone', clientEntityId: 'gone', payload: { a: 4 } }),
      ],
      receipts: [],
    });
    expect(plan).toMatchObject({ stripped: 1, dropped: 1, kept: 2 });
    expect(plan.deltas).toEqual([
      { acknowledgedEvents: ['gone'] },
      { events: [expect.objectContaining({ eventId: 'fresh', localSequence: 1, payload: null, payloadFrom: 'record', nextAttemptAt: MARKER_NOT_BEFORE })] },
    ]);
  });

  it('an older build never sends a record-payload marker: its batcher skips an event still backing off', () => {
    const marker = { ...event({ eventId: 'm' }), ...recordPayloadMarker() } as JournalEvent;
    // The rule every shipped `batchEvents` applies before this build: skip while `nextAttemptAt` is ahead.
    const olderBuildSkips = (candidate: JournalEvent, at: number): boolean =>
      candidate.nextAttemptAt !== undefined && Date.parse(candidate.nextAttemptAt) > at;
    expect(olderBuildSkips(marker, Date.now() + 100 * 365 * 24 * 3600 * 1000)).toBe(true);
    // This build reads the payload from the record instead, so the backoff does not hold it.
    expect(batchEvents([marker], 100, 1 << 20, Date.now()).batch).toHaveLength(1);
  });

  it('a migrated bound import goes up with the row\'s payload, committed to the event BEFORE the push', async () => {
    const store = createMemoryLocalFirstStore({ records: [boundRow({ a: 1 })], events: [event({ eventId: uuid(1), clientEntityId: 'row', payloadHash: hashPayload({ a: 1 }) })] });
    apply(store, planEventBacklogMigration(store.view()));
    expect(store.view().events[0]).toMatchObject({ payload: null, payloadFrom: 'record' });
    // The push fails after the payload was materialized: a resend must carry the SAME bytes.
    let attempt = 0;
    const pushed: SyncPushBatch[] = [];
    const transport: SyncTransport = {
      async push(batch) {
        pushed.push(structuredClone(batch));
        attempt += 1;
        if (attempt === 1) throw new Error('network');
        return batch.events.map((sent) => ({ eventId: sent.eventId, status: 'accepted', serverVersion: 1 }) as SyncReceipt);
      },
      async pull() { return { records: [] }; },
    };
    const coordinator = createSyncCoordinator({ store, transport, deviceId: 'd1', policy: { assert: () => undefined } as never, lease: { run: (_owner, work) => work() } });
    await expect(coordinator.synchronize(BOUND)).rejects.toThrow('network');
    expect(store.view().events[0]).toMatchObject({ payload: { a: 1 }, payloadHash: hashPayload({ a: 1 }) });
    expect(store.view().events[0]!.payloadFrom).toBeUndefined();
    // The row changes without a journal write; the resend still carries what was first sent.
    store.applyDelta({ records: [boundRow({ a: 'changed' })] });
    await coordinator.synchronize(BOUND);
    expect(pushed.map((batch) => batch.events[0]!.payload)).toEqual([{ a: 1 }, { a: 1 }]);
    expect(pushed.every((batch) => batch.events[0]!.payloadHash === hashPayload({ a: 1 }) && !('payloadFrom' in batch.events[0]!))).toBe(true);
    expect(store.view().events).toEqual([]);
  });

  it('slices the work into bounded deltas', async () => {
    const store = await legacyStore(5);
    const plan = planEventBacklogMigration(store.view(), 2);
    expect(plan.deltas.map((delta) => delta.events?.length)).toEqual([2, 2, 1]);
  });

  it('sync still binds and sends the rows after the migration (the import is read from the record)', async () => {
    const store = await legacyStore(2);
    apply(store, planEventBacklogMigration(store.view()));
    await store.transact(async (tx) => {
      for (const row of await tx.list('message')) {
        const moved = { ...row, destination: BOUND };
        await tx.put(moved);
        await queueImport(tx, moved);
      }
    });
    const pushed: SyncPushBatch[] = [];
    const transport: SyncTransport = {
      async push(batch) {
        pushed.push(batch);
        return batch.events.map((event) => ({ eventId: event.eventId, status: 'accepted', serverVersion: 1 }) as SyncReceipt);
      },
      async pull() { return { records: [] }; },
    };
    const coordinator = createSyncCoordinator({
      store, transport, deviceId: 'd1',
      policy: { assert: () => undefined } as never,
      lease: { run: (_owner, work) => work() },
    });
    await coordinator.synchronize(BOUND);
    const sent = pushed.flatMap((batch) => batch.events);
    expect(sent).toHaveLength(2);
    const rows = store.view().records;
    for (const event of sent) {
      expect(event.operation).toBe('import');
      expect(event.payload).toEqual(rows.find((row) => row.id === event.clientEntityId)!.payload);
    }
    // Every event is settled: the markers went with the bind, the imports with their receipts.
    expect(store.view().events).toEqual([]);
  });
});
