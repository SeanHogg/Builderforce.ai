import { indexedDB } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createIndexedDbLocalFirstStore } from './indexedDb.js';
import { newLocalRecord } from './store.js';

const options = (name: string, ownerId: string) => ({ indexedDB, dbName: name, ownerId, leaseMs: 60_000 });

describe('IndexedDB local-first store', () => {
  it('acknowledges a record and its journal only after a restart-safe commit', async () => {
    const name = `local-first-${crypto.randomUUID()}`;
    const first = createIndexedDbLocalFirstStore(options(name, 'owner-a'));
    const ticket = newLocalRecord({
      id: crypto.randomUUID(),
      entityType: 'ticket',
      payload: { title: 'Durable offline' },
      deviceId: 'device-a',
    });
    await first.transact(async (tx) => {
      await tx.put(ticket);
      await tx.append({
        eventId: crypto.randomUUID(),
        clientEntityId: ticket.id,
        entityType: ticket.entityType,
        operation: 'create',
        schemaVersion: 1,
        occurredAt: ticket.occurredAt,
        dependsOn: [],
        destination: ticket.destination,
        payload: ticket.payload,
      });
    });
    first.close();

    const reopened = createIndexedDbLocalFirstStore(options(name, 'owner-b'));
    expect((await reopened.read((tx) => tx.get('ticket', ticket.id)))?.payload).toEqual({ title: 'Durable offline' });
    expect(await reopened.read((tx) => tx.pending())).toHaveLength(1);
    reopened.close();
  });

  it('prevents a second owner from overwriting a transaction in progress', async () => {
    const name = `local-first-${crypto.randomUUID()}`;
    const first = createIndexedDbLocalFirstStore(options(name, 'owner-a'));
    const second = createIndexedDbLocalFirstStore(options(name, 'owner-b'));
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const running = first.withLease(() => held);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(second.transact(async () => undefined)).rejects.toThrow('local_first_store_busy');
    release();
    await running;
    first.close();
    second.close();
  });
});
