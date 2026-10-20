import { describe, expect, it } from 'vitest';
import { commitWriteAndEnqueue, type EnqueueEvent } from './atomicWrite.js';
import { UNBOUND_DESTINATION, type JournalEvent, type LocalRecord } from './records.js';
import {
  createMemoryLocalFirstStore,
  type LocalFirstSnapshot,
  type LocalFirstStore,
  type LocalFirstTransaction,
} from './store.js';

const AT = '2026-10-19T12:00:00.000Z';

function ticket(id = 'ticket-1', title = 'offline'): LocalRecord<{ title: string }> {
  return {
    id,
    entityType: 'ticket',
    schemaVersion: 1,
    version: 1,
    destination: UNBOUND_DESTINATION,
    occurredAt: AT,
    updatedAt: AT,
    payload: { title },
    provenance: { deviceId: 'device-1', source: 'local' },
  };
}

/** `key` names the logical write; the store mints the wire `eventId`. */
function enqueue(clientEntityId: string, key: string, title = 'offline'): EnqueueEvent<{ title: string }> {
  return {
    idempotencyKey: key,
    clientEntityId,
    entityType: 'ticket',
    operation: 'create',
    schemaVersion: 1,
    occurredAt: AT,
    dependsOn: [],
    destination: UNBOUND_DESTINATION,
    payload: { title },
  };
}

async function seed(store: LocalFirstStore): Promise<void> {
  await store.transact(async (tx) => {
    await tx.put(ticket('seed-ticket', 'already here'));
    await tx.append(enqueue('seed-ticket', 'evt-seed', 'already here'));
  });
}

function watch(inner: LocalFirstStore, fail?: 'put' | 'append'): {
  store: LocalFirstStore;
  calls: { transact: number; put: number; append: number };
} {
  const calls = { transact: 0, put: 0, append: 0 };
  const store: LocalFirstStore = {
    read: (work) => inner.read(work),
    export: () => inner.export(),
    subscribe: (listener) => inner.subscribe(listener),
    transact(work) {
      calls.transact += 1;
      return inner.transact((tx) => {
        // Delegate through a proxy: the store's transaction methods live on a
        // prototype, so spreading tx would strip their `this` binding.
        const wrapped = new Proxy(tx, {
          get(target, property, receiver) {
            if (property === 'put') {
              return async (record: LocalRecord, expectedVersion?: number) => {
                calls.put += 1;
                if (fail === 'put') throw new Error('put_failed');
                return target.put(record, expectedVersion);
              };
            }
            if (property === 'append') {
              return async (event: EnqueueEvent) => {
                calls.append += 1;
                if (fail === 'append') throw new Error('append_failed');
                return target.append(event);
              };
            }
            const value = Reflect.get(target, property, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        return work(wrapped);
      });
    },
  };
  return { store, calls };
}

/**
 * Record which transaction steps ran, so a test can assert the kill landed
 * after exactly the work the crash point names — not before it, not past it.
 */
function guardCalls(tx: LocalFirstTransaction, calls: string[]): LocalFirstTransaction {
  return new Proxy(tx, {
    get(target, property, receiver) {
      if (property === 'put') {
        return async (record: LocalRecord, expectedVersion?: number) => {
          calls.push('put');
          return target.put(record, expectedVersion);
        };
      }
      if (property === 'append') {
        return async (event: EnqueueEvent) => {
          calls.push('append');
          return target.append(event);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** Stands in for the process dying: nothing in flight can reach disk. */
const CRASH = new Error('process_killed');

type CrashPoint = 'after-put' | 'after-append' | 'before-publish';

/**
 * A store whose durability boundary is ONE indivisible snapshot write, the
 * way the IndexedDB store publishes: the transaction builds a draft and the
 * draft is written once. `control.crashAt` arms a kill at one point of that
 * path, so the durable snapshot is whatever was last published.
 */
function crashableStore(seed?: Partial<LocalFirstSnapshot>) {
  const empty: LocalFirstSnapshot = {
    records: [],
    events: [],
    mappings: [],
    receipts: [],
    conflicts: [],
    cursors: {},
    nextSequence: 1,
  };
  let durable: LocalFirstSnapshot = structuredClone({ ...empty, ...seed });
  let tail: Promise<unknown> = Promise.resolve();
  const control = { crashAt: null as CrashPoint | null };

  // Delegate through a proxy: the transaction methods live on a prototype,
  // so spreading or rebinding tx would strip their `this`.
  const guard = (tx: LocalFirstTransaction): LocalFirstTransaction =>
    new Proxy(tx, {
      get(target, property, receiver) {
        if (property === 'put') {
          return async (record: LocalRecord, expectedVersion?: number) => {
            const done = await target.put(record, expectedVersion);
            if (control.crashAt === 'after-put') {
              control.crashAt = null;
              throw CRASH;
            }
            return done;
          };
        }
        if (property === 'append') {
          return async (event: EnqueueEvent) => {
            const done = await target.append(event);
            if (control.crashAt === 'after-append') {
              control.crashAt = null;
              throw CRASH;
            }
            return done;
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

  const store: LocalFirstStore = {
    read: (work) => createMemoryLocalFirstStore(structuredClone(durable)).read(work),
    transact(work) {
      const run = tail.then(async () => {
        const memory = createMemoryLocalFirstStore(structuredClone(durable));
        const result = await memory.transact((tx) => work(guard(tx)));
        if (control.crashAt === 'before-publish') {
          control.crashAt = null;
          throw CRASH;
        }
        durable = await memory.export();
        return result;
      });
      tail = run.catch(() => undefined);
      return run;
    },
    export: async () => structuredClone(durable),
    subscribe: () => () => undefined,
  };

  return { store, control, durable: () => structuredClone(durable) };
}

/** The two failure shapes G14 forbids: a record with no sync row, or a sync row with no record. */
function orphans(snapshot: LocalFirstSnapshot): { records: string[]; syncRows: string[] } {
  const synced = new Set(snapshot.events.map((event: JournalEvent) => event.clientEntityId));
  const recorded = new Set(snapshot.records.map((record: LocalRecord) => record.id));
  return {
    records: snapshot.records.filter((record: LocalRecord) => !synced.has(record.id)).map((record: LocalRecord) => record.id),
    syncRows: snapshot.events
      .filter((event: JournalEvent) => !recorded.has(event.clientEntityId))
      .map((event: JournalEvent) => event.eventId),
  };
}

describe('commitWriteAndEnqueue crash between the record and the enqueue', () => {
  const points: readonly { point: CrashPoint; reached: string[] }[] = [
    { point: 'after-put', reached: ['put'] },
    { point: 'after-append', reached: ['put', 'append'] },
    { point: 'before-publish', reached: ['put', 'append'] },
  ];

  for (const { point, reached } of points) {
    it(`a kill ${point} commits neither the record nor the sync row`, async () => {
      const host = crashableStore();
      await seed(host.store);
      const before = await host.store.export();
      const calls: string[] = [];
      const watched: LocalFirstStore = {
        read: (work) => host.store.read(work),
        export: () => host.store.export(),
        subscribe: (listener) => host.store.subscribe(listener),
        transact: (work) => host.store.transact((tx) => work(guardCalls(tx, calls))),
      };
      host.control.crashAt = point;

      await expect(commitWriteAndEnqueue(watched, ticket('ticket-2'), enqueue('ticket-2', 'evt-2'))).rejects.toThrow(
        'process_killed',
      );

      // The kill happened, and it happened after the work the point names.
      expect(calls).toEqual(reached);
      // Nothing reached the durable snapshot from the killed attempt.
      expect(await host.store.export()).toEqual(before);
      expect((await host.store.export()).records.map((row) => row.id)).not.toContain('ticket-2');
      expect((await host.store.export()).events.map((row) => row.idempotencyKey)).not.toContain('evt-2');
      // No sequence was burned either, so the retry takes the identity it would have taken.
      expect((await host.store.export()).nextSequence).toBe(before.nextSequence);
    });
  }

  it('a restarted store sees neither side of a killed attempt, and the retry commits both', async () => {
    const host = crashableStore();
    await seed(host.store);
    host.control.crashAt = 'after-put';

    await expect(commitWriteAndEnqueue(host.store, ticket('ticket-2'), enqueue('ticket-2', 'evt-2'))).rejects.toThrow(
      'process_killed',
    );

    // Restart: a fresh store over the last published snapshot.
    const restarted = createMemoryLocalFirstStore(host.durable());
    expect(orphans(await restarted.export())).toEqual({ records: [], syncRows: [] });
    expect((await restarted.export()).records.map((row) => row.id)).toEqual(['seed-ticket']);
    expect((await restarted.export()).events.map((row) => row.idempotencyKey)).toEqual(['evt-seed']);

    const saved = await commitWriteAndEnqueue(
      restarted,
      ticket('ticket-2', 'after restart'),
      enqueue('ticket-2', 'evt-2', 'after restart'),
    );
    const after = await restarted.export();

    expect(after.records.map((row) => row.id)).toEqual(['seed-ticket', 'ticket-2']);
    expect(after.events.map((row) => row.idempotencyKey)).toEqual(['evt-seed', 'evt-2']);
    expect(saved.localSequence).toBe(2);
    expect(orphans(after)).toEqual({ records: [], syncRows: [] });
  });

  it('never leaves one side behind at any kill point, only both or neither', async () => {
    for (const { point } of points) {
      const host = crashableStore();
      await seed(host.store);
      host.control.crashAt = point;
      await commitWriteAndEnqueue(host.store, ticket('ticket-2'), enqueue('ticket-2', 'evt-2')).catch(() => undefined);

      const snapshot = await host.store.export();
      expect(orphans(snapshot)).toEqual({ records: [], syncRows: [] });
      const hasRecord = snapshot.records.some((row) => row.id === 'ticket-2');
      const hasSyncRow = snapshot.events.some((row) => row.idempotencyKey === 'evt-2');
      expect(hasRecord).toBe(hasSyncRow);
    }
  });
});

describe('commitWriteAndEnqueue', () => {
  it('commits the record and the journal event in one transaction', async () => {
    const inner = createMemoryLocalFirstStore();
    const { store, calls } = watch(inner);
    const written = ticket('ticket-1', 'offline');
    const queued = enqueue('ticket-1', 'evt-1', 'offline');

    const saved = await commitWriteAndEnqueue(store, written, queued);

    expect(calls.transact).toBe(1);
    expect(calls.put).toBe(1);
    expect(calls.append).toBe(1);
    expect(saved.idempotencyKey).toBe('evt-1');
    expect(saved.eventId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(saved.clientEntityId).toBe('ticket-1');
    expect(saved.localSequence).toBe(1);
    expect(saved.payloadHash).toMatch(/^fnv1a:/);

    const snapshot = await inner.export();
    expect(snapshot.records).toEqual([written]);
    expect(snapshot.events).toEqual([saved]);
    expect(snapshot.nextSequence).toBe(2);
  });

  it('does not append when put throws, and leaves the store unchanged', async () => {
    const inner = createMemoryLocalFirstStore();
    await seed(inner);
    const before = await inner.export();
    const { store, calls } = watch(inner, 'put');

    await expect(commitWriteAndEnqueue(store, ticket('ticket-2'), enqueue('ticket-2', 'evt-2'))).rejects.toThrow(
      'put_failed',
    );

    expect(calls.transact).toBe(1);
    expect(calls.put).toBe(1);
    expect(calls.append).toBe(0);
    expect(await inner.export()).toEqual(before);
  });

  it('does not commit the put when append throws', async () => {
    const inner = createMemoryLocalFirstStore();
    await seed(inner);
    const before = await inner.export();
    const { store, calls } = watch(inner, 'append');

    await expect(commitWriteAndEnqueue(store, ticket('ticket-2'), enqueue('ticket-2', 'evt-2'))).rejects.toThrow(
      'append_failed',
    );

    expect(calls.transact).toBe(1);
    expect(calls.put).toBe(1);
    expect(calls.append).toBe(1);
    expect(await inner.export()).toEqual(before);
    expect((await inner.export()).records.map((row) => row.id)).not.toContain('ticket-2');
    expect((await inner.export()).events.map((row) => row.idempotencyKey)).not.toContain('evt-2');
  });

  it('rolls back a real append failure inside the memory store transaction', async () => {
    const store = createMemoryLocalFirstStore();
    await seed(store);
    const before = await store.export();
    const badEvent = enqueue('ticket-2', 'evt-2');
    badEvent.payload = { explode: () => 'no' } as unknown as { title: string };

    await expect(commitWriteAndEnqueue(store, ticket('ticket-2'), badEvent)).rejects.toThrow(/could not be cloned/);
    expect(await store.export()).toEqual(before);
  });

  it('still rejects on the put error when the event itself cannot be cloned', async () => {
    const store = createMemoryLocalFirstStore();
    await seed(store);
    const before = await store.export();
    const badRecord = ticket('');
    const badEvent = enqueue('ticket-2', 'evt-2');
    badEvent.payload = { explode: () => 'no' } as unknown as { title: string };

    await expect(commitWriteAndEnqueue(store, badRecord, badEvent)).rejects.toThrow(
      'client_entity_id_must_be_stable_uuid',
    );
    expect(await store.export()).toEqual(before);
  });

  it('accepts a later write after a failed enqueue', async () => {
    const store = createMemoryLocalFirstStore();
    await seed(store);
    const failing = watch(store, 'append');
    await expect(
      commitWriteAndEnqueue(failing.store, ticket('ticket-2'), enqueue('ticket-2', 'evt-2')),
    ).rejects.toThrow('append_failed');

    const saved = await commitWriteAndEnqueue(
      store,
      ticket('ticket-3', 'recovered'),
      enqueue('ticket-3', 'evt-3', 'recovered'),
    );
    const snapshot = await store.export();
    expect(snapshot.records.map((row) => row.id)).toEqual(['seed-ticket', 'ticket-3']);
    expect(snapshot.events.map((row) => row.idempotencyKey)).toEqual(['evt-seed', 'evt-3']);
    expect(saved.localSequence).toBe(2);
  });
});
