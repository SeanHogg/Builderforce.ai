import { describe, expect, it, vi } from 'vitest';
import { createPlatformPolicy } from './policy.js';
import type { EntityDestination, SyncReceipt } from './records.js';
import { createMemoryLocalFirstStore, newLocalRecord } from './store.js';
import { SYNC_LEASE_LOST, createSyncCoordinator, type SyncLease, type SyncTransport, type SyncTransportInit } from './sync.js';
import { createDeviceStoreCoordinatorLease, type CoordinatorLeaseFence } from './syncLease.js';

const destination: EntityDestination = {
  kind: 'bound',
  platformInstance: 'https://builderforce.example',
  accountId: 'account-a',
  tenantId: 'tenant-a',
  projectId: 'project-a',
};

const remoteTicket = () =>
  newLocalRecord({ id: crypto.randomUUID(), entityType: 'ticket', payload: { title: 'Remote' }, deviceId: 'remote', destination });

function grantedPolicy() {
  const policy = createPlatformPolicy();
  policy.set({ synchronize: true });
  return policy;
}

/** A lease whose fence the test flips; `lose()` makes `holds()` false and aborts the signal. */
function controllableLease(): SyncLease & { lose(): void } {
  const controller = new AbortController();
  let held = true;
  const fence: CoordinatorLeaseFence = { signal: controller.signal, holds: () => held };
  return {
    run: async (_owner, work) => work(fence),
    lose() {
      held = false;
      controller.abort(new Error('lost'));
    },
  };
}

describe('sync coordinator honours the lease fence', () => {
  it('passes the fence signal to every transport request', async () => {
    const signals: Array<AbortSignal | undefined> = [];
    const store = createMemoryLocalFirstStore();
    const ticket = remoteTicket();
    await store.transact(async (tx) => {
      await tx.put(ticket);
      await tx.append({
        idempotencyKey: `ticket:${ticket.id}:v1`,
        clientEntityId: ticket.id,
        entityType: 'ticket',
        operation: 'create',
        schemaVersion: ticket.schemaVersion,
        occurredAt: ticket.occurredAt,
        dependsOn: [],
        destination,
        payload: ticket.payload,
      });
    });
    const transport: SyncTransport = {
      async pull(_input, init?: SyncTransportInit) {
        signals.push(init?.signal);
        return { records: [] };
      },
      async push(batch, init?: SyncTransportInit) {
        signals.push(init?.signal);
        return batch.events.map((event): SyncReceipt => ({ eventId: event.eventId, status: 'accepted', receivedAt: 'now' }));
      },
    };
    const lease = createDeviceStoreCoordinatorLease({ deviceStore: `fence-${crypto.randomUUID()}`, now: () => 1_000, ttlMs: 30_000 });
    const coordinator = createSyncCoordinator({ store, transport, policy: grantedPolicy(), deviceId: 'device-a', lease });

    const summary = await coordinator.synchronize(destination);

    expect(summary?.pushed).toBe(1);
    expect(signals).toHaveLength(3); // pull, push, catch-up pull
    for (const signal of signals) expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('refuses to commit pulled records once the lease is lost', async () => {
    const store = createMemoryLocalFirstStore();
    const lease = controllableLease();
    const pulled = remoteTicket();
    const transport: SyncTransport = {
      async pull() {
        lease.lose();
        return { records: [pulled], cursor: 'cursor-1' };
      },
      push: vi.fn(async () => []),
    };
    const coordinator = createSyncCoordinator({ store, transport, policy: grantedPolicy(), deviceId: 'device-a', lease });

    await expect(coordinator.synchronize(destination)).rejects.toThrow(SYNC_LEASE_LOST);

    const snapshot = await store.export();
    expect(snapshot.records).toEqual([]);
    expect(await store.read((tx) => tx.cursor(destination))).toBeUndefined();
    expect(transport.push).not.toHaveBeenCalled();
  });

  it('refuses to acknowledge pushed events once the lease is lost, leaving them pending', async () => {
    const store = createMemoryLocalFirstStore();
    const lease = controllableLease();
    const ticket = remoteTicket();
    await store.transact(async (tx) => {
      await tx.put(ticket);
      await tx.append({
        idempotencyKey: `ticket:${ticket.id}:v1`,
        clientEntityId: ticket.id,
        entityType: 'ticket',
        operation: 'create',
        schemaVersion: ticket.schemaVersion,
        occurredAt: ticket.occurredAt,
        dependsOn: [],
        destination,
        payload: ticket.payload,
      });
    });
    const transport: SyncTransport = {
      async pull() {
        return { records: [] };
      },
      async push(batch) {
        lease.lose();
        return batch.events.map((event): SyncReceipt => ({ eventId: event.eventId, status: 'accepted', receivedAt: 'now' }));
      },
    };
    const coordinator = createSyncCoordinator({ store, transport, policy: grantedPolicy(), deviceId: 'device-a', lease });

    await expect(coordinator.synchronize(destination)).rejects.toThrow(SYNC_LEASE_LOST);

    const snapshot = await store.export();
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.receipts).toEqual([]);
  });

  it('discards a timed-out run\'s late pull and reports the refusal', async () => {
    const store = createMemoryLocalFirstStore();
    const onLateError = vi.fn();
    let finishPull: () => void = () => {};
    const pulled = remoteTicket();
    const transport: SyncTransport = {
      // A transport that ignores the abort and answers after the lease timed out.
      pull: () => new Promise((resolve) => {
        finishPull = () => resolve({ records: [pulled], cursor: 'late' });
      }),
      push: vi.fn(async () => []),
    };
    const lease = createDeviceStoreCoordinatorLease({
      deviceStore: `fence-timeout-${crypto.randomUUID()}`,
      now: () => 1_000,
      ttlMs: 30_000,
      workTimeoutMs: 10,
      onLateError,
    });
    const coordinator = createSyncCoordinator({ store, transport, policy: grantedPolicy(), deviceId: 'device-a', lease });

    await expect(coordinator.synchronize(destination)).rejects.toThrow('sync_lease_work_timeout');
    finishPull();
    await vi.waitFor(() => expect(onLateError).toHaveBeenCalledTimes(1));

    expect((onLateError.mock.calls[0]![0] as Error).message).toBe(SYNC_LEASE_LOST);
    expect((await store.export()).records).toEqual([]);
    expect(await store.read((tx) => tx.cursor(destination))).toBeUndefined();
  });
});
