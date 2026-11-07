import { describe, expect, it } from 'vitest';
import { createPlatformPolicy } from './policy.js';
import type { JournalEvent, SyncReceipt } from './records.js';
import { countPending, createMemoryLocalFirstStore, selectPending, type LocalFirstStore } from './store.js';
import { createSyncCoordinator, type SyncPushBatch } from './sync.js';

const AT = '2026-10-19T00:00:00.000Z';
const BOUND = { kind: 'bound' as const, tenantId: '7' };

async function append(
  store: LocalFirstStore,
  key: string,
  dependsOn: string[] = [],
): Promise<JournalEvent> {
  return store.transact((tx) => tx.append({
    idempotencyKey: key, clientEntityId: key, entityType: 'ticket', operation: 'create',
    schemaVersion: 1, occurredAt: AT, dependsOn, destination: BOUND, payload: { key },
  }));
}

function coordinatorFor(
  store: LocalFirstStore,
  answer: (batch: SyncPushBatch) => SyncReceipt[],
  maxEvents?: number,
) {
  const policy = createPlatformPolicy();
  policy.set({ synchronize: true });
  const pushed: SyncPushBatch[] = [];
  const coordinator = createSyncCoordinator({
    store,
    policy,
    deviceId: 'd',
    lease: { run: (_owner, work) => work() },
    ...(maxEvents ? { maxEvents } : {}),
    transport: {
      async push(batch) {
        pushed.push(batch);
        return answer(batch);
      },
      async pull() {
        return { records: [] };
      },
    },
  });
  return { coordinator, pushed };
}

const receiptOf = (eventId: string, status: SyncReceipt['status'], detail?: string): SyncReceipt => ({
  eventId, status, receivedAt: AT, ...(detail ? { detail } : {}),
});

describe('sync dead-letters permanent refusals', () => {
  it('dead-letters a rejected event: it is no longer pending work, so the count reaches 0 and it is not re-sent', async () => {
    const store = createMemoryLocalFirstStore();
    await append(store, 'bad');
    const { coordinator, pushed } = coordinatorFor(store, (batch) => batch.events.map((e) => receiptOf(e.eventId, 'rejected', 'project_unresolved')));
    const first = await coordinator.synchronize(BOUND);
    expect(first?.rejected).toBe(1);
    expect(await store.read((tx) => countPending(tx, BOUND))).toBe(0);
    expect(await store.read((tx) => selectPending(tx, undefined, BOUND))).toEqual([]);
    // Still in the journal, marked, for audit and sync status.
    const kept = await store.read((tx) => tx.pending(BOUND));
    expect(kept).toHaveLength(1);
    expect(kept[0]?.deadLetter).toMatchObject({ reason: 'project_unresolved' });
    await coordinator.synchronize(BOUND);
    expect(pushed).toHaveLength(1);
  });

  it('a rejected head does not starve the events behind it', async () => {
    const store = createMemoryLocalFirstStore();
    const head = await append(store, 'head');
    await append(store, 'next');
    const { coordinator, pushed } = coordinatorFor(store, (batch) => batch.events.map((e) => (
      e.eventId === head.eventId ? receiptOf(e.eventId, 'rejected', 'ticket_title_invalid') : receiptOf(e.eventId, 'accepted')
    )));
    await coordinator.synchronize(BOUND);
    await coordinator.synchronize(BOUND);
    expect(await store.read((tx) => countPending(tx, BOUND))).toBe(0);
    expect(pushed.flatMap((b) => b.events).filter((e) => e.eventId === head.eventId)).toHaveLength(1);
  });

  it('dead-letters the dependents of a rejected event with it', async () => {
    const store = createMemoryLocalFirstStore();
    const parent = await append(store, 'parent');
    await append(store, 'child', ['parent']);
    const { coordinator } = coordinatorFor(store, (batch) => batch.events.map((e) => (
      e.eventId === parent.eventId ? receiptOf(e.eventId, 'rejected', 'project_unresolved') : receiptOf(e.eventId, 'dependency_pending')
    )));
    await coordinator.synchronize(BOUND);
    expect(await store.read((tx) => countPending(tx, BOUND))).toBe(0);
    const all = await store.read((tx) => tx.pending(BOUND));
    expect(all.find((e) => e.idempotencyKey === 'child')?.deadLetter?.reason).toBe('dependency_dead_lettered');
  });

  it('keeps a server-fault refusal pending instead of dead-lettering it', async () => {
    const store = createMemoryLocalFirstStore();
    await append(store, 'flaky');
    const { coordinator } = coordinatorFor(store, (batch) => batch.events.map((e) => receiptOf(e.eventId, 'rejected', 'ticket_write_failed')));
    await coordinator.synchronize(BOUND);
    expect(await store.read((tx) => countPending(tx, BOUND))).toBe(1);
  });

  it('a new event under a dead-lettered key is a new event, not the dead one', async () => {
    const store = createMemoryLocalFirstStore();
    const dead = await append(store, 'k');
    const { coordinator } = coordinatorFor(store, (batch) => batch.events.map((e) => receiptOf(e.eventId, 'rejected', 'ticket_title_invalid')));
    await coordinator.synchronize(BOUND);
    const again = await append(store, 'k');
    expect(again.eventId).not.toBe(dead.eventId);
  });
});

describe('sync does not let held events starve independent ones', () => {
  it('re-sends dependency_pending events after fresh work and fills the batch past them', async () => {
    const store = createMemoryLocalFirstStore();
    const heldA = await append(store, 'held-a');
    const heldB = await append(store, 'held-b');
    const heldIds = new Set([heldA.eventId, heldB.eventId]);
    const { coordinator, pushed } = coordinatorFor(store, (batch) => batch.events.map((e) => (
      heldIds.has(e.eventId) ? receiptOf(e.eventId, 'dependency_pending', 'ticket_chat_pending') : receiptOf(e.eventId, 'accepted')
    )), 2);
    await coordinator.synchronize(BOUND); // both held, batch of 2 went out
    await append(store, 'fresh-1');
    await append(store, 'fresh-2');
    await coordinator.synchronize(BOUND);
    const second = pushed[1]?.events.map((e) => e.idempotencyKey);
    expect(second).toEqual(['fresh-1', 'fresh-2']);
    expect(await store.read((tx) => countPending(tx, BOUND))).toBe(2);
  });

  it('skips the dependents of a held event this round', async () => {
    const store = createMemoryLocalFirstStore();
    const parent = await append(store, 'parent');
    await append(store, 'child', ['parent']);
    await append(store, 'free');
    const { coordinator, pushed } = coordinatorFor(store, (batch) => batch.events.map((e) => (
      e.idempotencyKey === 'free' ? receiptOf(e.eventId, 'accepted') : receiptOf(e.eventId, 'dependency_pending')
    )));
    await coordinator.synchronize(BOUND);
    await coordinator.synchronize(BOUND);
    expect(pushed[1]?.events.map((e) => e.idempotencyKey)).toEqual(['parent']);
  });
});
