import { describe, expect, it, vi } from 'vitest';
import { createPlatformPolicy } from './policy.js';
import { destinationKey, type EntityDestination, type LocalRecord, type SyncReceipt } from './records.js';
import { createMemoryLocalFirstStore, newLocalRecord } from './store.js';
import { createSyncCoordinator, type SyncTransport } from './sync.js';

const destination: EntityDestination = {
  kind: 'bound',
  platformInstance: 'https://builderforce.example',
  accountId: 'account-a',
  tenantId: 'tenant-a',
  projectId: 'project-a',
};

const record = (id = crypto.randomUUID()): LocalRecord<{ title: string; status?: string }> =>
  newLocalRecord({ id, entityType: 'ticket', payload: { title: 'Offline ticket', status: 'open' }, deviceId: 'device-a', destination });

const eventFor = (value: LocalRecord, eventId = crypto.randomUUID()) => ({
  eventId,
  clientEntityId: value.id,
  entityType: value.entityType,
  operation: 'create' as const,
  schemaVersion: value.schemaVersion,
  occurredAt: value.occurredAt,
  dependsOn: [],
  destination: value.destination,
  payload: value.payload,
});

const immediateLease = { run: async <R>(_owner: string, work: () => Promise<R>): Promise<R> => work() };

describe('platform policy', () => {
  it('starts API-denied and requires explicit permission for each capability', () => {
    const policy = createPlatformPolicy();
    expect(policy.allows('synchronize')).toBe(false);
    expect(policy.allows('gateway-inference')).toBe(false);
    expect(() => policy.assert('synchronize')).toThrow('platform_synchronize_disabled');
    policy.set({ synchronize: true });
    expect(policy.allows('synchronize')).toBe(true);
    expect(policy.allows('gateway-inference')).toBe(false);
  });
});

describe('transactional local store', () => {
  it('commits records and stable journal events atomically and retains over 1,000 events', async () => {
    const store = createMemoryLocalFirstStore();
    const ticket = record();
    await store.transact(async (tx) => {
      await tx.put(ticket);
      await tx.append(eventFor(ticket));
    });
    await store.transact(async (tx) => {
      for (let index = 0; index < 1_050; index += 1) {
        const message = newLocalRecord({
          id: crypto.randomUUID(),
          entityType: 'message',
          payload: { content: `message ${index}` },
          deviceId: 'device-a',
          destination,
        });
        await tx.append(eventFor(message));
      }
    });
    expect((await store.read((tx) => tx.get('ticket', ticket.id)))?.payload.title).toBe('Offline ticket');
    expect(await store.read((tx) => tx.pending(destination))).toHaveLength(1_051);
  });

  it('does not commit a record when its journal mutation fails', async () => {
    const store = createMemoryLocalFirstStore();
    const ticket = record();
    await expect(store.transact(async (tx) => {
      await tx.put(ticket);
      throw new Error('journal_full');
    })).rejects.toThrow('journal_full');
    expect(await store.read((tx) => tx.get('ticket', ticket.id))).toBeUndefined();
  });

  it('keeps work bound to its original destination', async () => {
    const store = createMemoryLocalFirstStore();
    const first = record();
    const second = { ...record(), destination: { ...destination, accountId: 'account-b' } as EntityDestination };
    await store.transact(async (tx) => {
      await tx.append(eventFor(first));
      await tx.append(eventFor(second));
    });
    expect(await store.read((tx) => tx.pending(destination))).toHaveLength(1);
    expect(destinationKey(second.destination)).not.toBe(destinationKey(destination));
  });
});

describe('sync coordinator', () => {
  it('persists mappings and receipts before acknowledging a batch', async () => {
    const store = createMemoryLocalFirstStore();
    const ticket = record();
    await store.transact((tx) => tx.append(eventFor(ticket)));
    const transport: SyncTransport = {
      pull: async () => ({ records: [], cursor: 'cursor-2' }),
      push: async (batch) => batch.events.map((event): SyncReceipt => ({
        eventId: event.eventId,
        status: 'accepted',
        receivedAt: new Date().toISOString(),
        serverId: '9001',
        serverVersion: 1,
      })),
    };
    const coordinator = createSyncCoordinator({
      store,
      transport,
      policy: createPlatformPolicy({ synchronize: true }),
      deviceId: 'device-a',
      lease: immediateLease,
      newId: () => 'batch-id',
    });
    const summary = await coordinator.synchronize(destination);
    expect(summary).toMatchObject({ pushed: 1, pulled: 0 });
    expect(await store.read((tx) => tx.pending(destination))).toEqual([]);
    expect(await store.read((tx) => tx.mapping('ticket', ticket.id, destination))).toMatchObject({ serverId: '9001' });
    expect(await store.read((tx) => tx.cursor(destination))).toBe('cursor-2');
  });

  it('reports an overlapping pull as a conflict without overwriting pending local work', async () => {
    const store = createMemoryLocalFirstStore();
    const local = record();
    await store.transact(async (tx) => {
      await tx.put(local);
      await tx.append(eventFor(local));
    });
    const remote = { ...local, version: 3, payload: { title: 'Remote edit', status: 'closed' } };
    const transport: SyncTransport = {
      pull: async () => ({ records: [remote], cursor: 'cursor-3' }),
      push: async () => [],
    };
    const coordinator = createSyncCoordinator({
      store,
      transport,
      policy: createPlatformPolicy({ synchronize: true }),
      deviceId: 'device-a',
      lease: immediateLease,
    });
    await coordinator.synchronize(destination);
    expect((await store.read((tx) => tx.get('ticket', local.id)))?.payload.title).toBe('Offline ticket');
    expect(await store.read((tx) => tx.conflicts())).toHaveLength(1);
  });

  it('makes no transport call when sync permission is disabled', async () => {
    const store = createMemoryLocalFirstStore();
    const transport = { push: vi.fn(), pull: vi.fn() } satisfies SyncTransport;
    const coordinator = createSyncCoordinator({
      store,
      transport,
      policy: createPlatformPolicy(),
      deviceId: 'device-a',
      lease: immediateLease,
    });
    await expect(coordinator.synchronize(destination)).rejects.toThrow('platform_synchronize_disabled');
    expect(transport.push).not.toHaveBeenCalled();
    expect(transport.pull).not.toHaveBeenCalled();
  });

  it('deletes a local row for a tombstoned pull instead of merging its body back', async () => {
    const store = createMemoryLocalFirstStore();
    const local = record('ticket-deleted');
    await store.transact((tx) => tx.put(local));
    const tombstone = {
      ...local,
      version: 4,
      deletedAt: '2026-10-18T12:00:00.000Z',
      payload: { title: 'must-not-survive', status: 'open' },
    };
    const transport: SyncTransport = {
      pull: async () => ({ records: [tombstone], cursor: 'cursor-4' }),
      push: async () => [],
    };
    const coordinator = createSyncCoordinator({
      store,
      transport,
      policy: createPlatformPolicy({ synchronize: true }),
      deviceId: 'device-a',
      lease: immediateLease,
    });

    const summary = await coordinator.synchronize(destination);

    expect(summary).toMatchObject({ pulled: 1 });
    expect(await store.read((tx) => tx.get('ticket', 'ticket-deleted'))).toBeUndefined();
    const remaining = await store.read((tx) => tx.list());
    expect(remaining.find((row) => row.id === 'ticket-deleted')).toBeUndefined();
    expect(JSON.stringify(remaining)).not.toContain('must-not-survive');
    expect(await store.read((tx) => tx.cursor(destination))).toBe('cursor-4');
  });
});
