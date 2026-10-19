import { describe, expect, it } from 'vitest';
import { commitWriteAndEnqueue, type EnqueueEvent } from './atomicWrite.js';
import { UNBOUND_DESTINATION, type LocalRecord } from './records.js';
import { createMemoryLocalFirstStore, type LocalFirstStore } from './store.js';

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

function enqueue(clientEntityId: string, eventId: string, title = 'offline'): EnqueueEvent<{ title: string }> {
  return {
    eventId,
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
    expect(saved.eventId).toBe('evt-1');
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
    expect((await inner.export()).events.map((row) => row.eventId)).not.toContain('evt-2');
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
    expect(snapshot.events.map((row) => row.eventId)).toEqual(['evt-seed', 'evt-3']);
    expect(saved.localSequence).toBe(2);
  });
});
