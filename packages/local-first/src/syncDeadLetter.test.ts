import { describe, expect, it } from 'vitest';
import { createPlatformPolicy } from './policy.js';
import type { JournalEvent, SyncReceipt } from './records.js';
import { countPending, createMemoryLocalFirstStore, selectPending, type LocalFirstStore } from './store.js';
import { wireDependencies } from './sync.js';
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
  now?: () => Date,
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
    ...(now ? { now } : {}),
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
    const { coordinator, pushed } = coordinatorFor(store, (batch) => batch.events.map((e) => receiptOf(e.eventId, 'rejected', 'ticket_title_invalid')));
    const first = await coordinator.synchronize(BOUND);
    expect(first?.rejected).toBe(1);
    expect(await store.read((tx) => countPending(tx, BOUND))).toBe(0);
    expect(await store.read((tx) => selectPending(tx, undefined, BOUND))).toEqual([]);
    // Still in the journal, marked, for audit and sync status.
    const kept = await store.read((tx) => tx.pending(BOUND));
    expect(kept).toHaveLength(1);
    expect(kept[0]?.deadLetter).toMatchObject({ reason: 'ticket_title_invalid' });
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

  it('BLOCKS (does not dead-letter) the dependents of a rejected event, and frees them when the key is re-filed', async () => {
    const store = createMemoryLocalFirstStore();
    const parent = await append(store, 'parent');
    await append(store, 'child', ['parent']);
    const { coordinator, pushed } = coordinatorFor(store, (batch) => batch.events.map((e) => (
      e.eventId === parent.eventId ? receiptOf(e.eventId, 'rejected', 'ticket_title_invalid') : receiptOf(e.eventId, 'dependency_pending')
    )));
    await coordinator.synchronize(BOUND);
    // The child went out in the same batch as its parent and was held; it is not dead.
    const all = await store.read((tx) => tx.pending(BOUND));
    expect(all.find((e) => e.idempotencyKey === 'child')?.deadLetter).toBeUndefined();
    // Blocked behind the dead parent: not counted, not sent, so a drain terminates.
    expect(await store.read((tx) => countPending(tx, BOUND))).toBe(0);
    const sent = pushed.length;
    await coordinator.synchronize(BOUND);
    expect(pushed).toHaveLength(sent);
    // The user re-files the parent: a new live event under the key frees the child.
    const refiled = await append(store, 'parent');
    expect(await store.read((tx) => countPending(tx, BOUND))).toBe(2);
    const everyone = await store.read((tx) => tx.pending());
    const wired = wireDependencies(everyone.filter((e) => e.idempotencyKey === 'child'), everyone);
    expect(wired[0]?.dependsOn).toEqual([refiled.eventId]);
  });

  it('a dependency follows a REPLACED write: the key resolves to the new event id at send time', async () => {
    const store = createMemoryLocalFirstStore();
    const old = await append(store, 'k');
    await append(store, 'dependent', ['k']);
    await store.transact(async (tx) => {
      await tx.acknowledge([old.eventId]);
    });
    const next = await append(store, 'k');
    const everyone = await store.read((tx) => tx.pending());
    const wired = wireDependencies(everyone.filter((e) => e.idempotencyKey === 'dependent'), everyone);
    expect(wired[0]?.dependsOn).toEqual([next.eventId]);
  });

  it('holds (never dead-letters) entity_not_imported, unresolved parents, future clocks and unknown codes', async () => {
    const store = createMemoryLocalFirstStore();
    await append(store, 'a');
    await append(store, 'b');
    await append(store, 'c');
    await append(store, 'd');
    const codes = ['entity_not_imported', 'project_unresolved', 'occurred_at_in_future', 'something_new'];
    const { coordinator } = coordinatorFor(store, (batch) => batch.events.map((e, i) => receiptOf(e.eventId, 'rejected', codes[i])));
    await coordinator.synchronize(BOUND);
    expect(await store.read((tx) => countPending(tx, BOUND))).toBe(4);
    expect((await store.read((tx) => tx.pending(BOUND))).some((e) => e.deadLetter)).toBe(false);
  });

  it('turns a NEWER pending import into an update on the mapped version when the in-flight one is accepted', async () => {
    const store = createMemoryLocalFirstStore();
    const first = await store.transact((tx) => tx.append({
      idempotencyKey: 'ticket:t1:import', clientEntityId: 't1', entityType: 'ticket', operation: 'import',
      schemaVersion: 1, occurredAt: AT, dependsOn: [], destination: BOUND, payload: { v: 1 },
    }));
    // While the push is in flight the user edits: the first import is dropped, a newer one queued.
    const racing = createSyncCoordinator({
      store,
      policy: (() => { const p = createPlatformPolicy(); p.set({ synchronize: true }); return p; })(),
      deviceId: 'd',
      lease: { run: (_o, work) => work() },
      transport: {
        async push(batch) {
          await store.transact(async (tx) => {
            await tx.acknowledge([first.eventId]);
            await tx.append({
              idempotencyKey: 'ticket:t1:import', clientEntityId: 't1', entityType: 'ticket', operation: 'import',
              schemaVersion: 1, occurredAt: AT, dependsOn: [], destination: BOUND, payload: { v: 2 },
            });
          });
          return batch.events.map((e) => ({ ...receiptOf(e.eventId, 'accepted'), serverId: '77', serverVersion: 1 }));
        },
        async pull() { return { records: [] }; },
      },
    });
    await racing.synchronize(BOUND);
    const left = await store.read((tx) => tx.pending(BOUND));
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ operation: 'update', baseVersion: 1, idempotencyKey: 'ticket:t1:import', payload: { v: 2 } });
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
    let clock = Date.parse(AT);
    const store = createMemoryLocalFirstStore();
    const parent = await append(store, 'parent');
    await append(store, 'child', ['parent']);
    await append(store, 'free');
    const { coordinator, pushed } = coordinatorFor(store, (batch) => batch.events.map((e) => (
      e.idempotencyKey === 'free' ? receiptOf(e.eventId, 'accepted') : receiptOf(e.eventId, 'dependency_pending')
    )), undefined, () => new Date(clock));
    await coordinator.synchronize(BOUND);
    // The held parent is backed off: nothing is due, and the child stays behind it.
    await coordinator.synchronize(BOUND);
    expect(pushed).toHaveLength(1);
    clock += 31_000;
    await coordinator.synchronize(BOUND);
    expect(pushed[1]?.events.map((e) => e.idempotencyKey)).toEqual(['parent']);
  });
});

describe('hold backoff is persisted on the journal event', () => {
  it('survives a NEW coordinator, backs off exponentially, and gives up after 12 attempts', async () => {
    let clock = Date.parse(AT);
    const store = createMemoryLocalFirstStore();
    await append(store, 'stuck');
    const make = () => coordinatorFor(store, (batch) => batch.events.map((e) => receiptOf(e.eventId, 'rejected', 'project_unresolved')), undefined, () => new Date(clock));
    await make().coordinator.synchronize(BOUND);
    let [event] = await store.read((tx) => tx.pending(BOUND));
    expect(event).toMatchObject({ holdAttempts: 1, nextAttemptAt: new Date(clock + 30_000).toISOString() });
    // A fresh coordinator (chatSyncHost builds one per pass) does not resend before the backoff.
    const early = make();
    await early.coordinator.synchronize(BOUND);
    expect(early.pushed).toHaveLength(0);
    for (let attempt = 2; attempt <= 11; attempt += 1) {
      clock += 3_600_001;
      await make().coordinator.synchronize(BOUND);
    }
    [event] = await store.read((tx) => tx.pending(BOUND));
    expect(event?.holdAttempts).toBe(11);
    clock += 3_600_001;
    await make().coordinator.synchronize(BOUND);
    [event] = await store.read((tx) => tx.pending(BOUND));
    expect(event?.deadLetter?.reason).toBe('gave_up:project_unresolved');
    expect(await store.read((tx) => countPending(tx, BOUND))).toBe(0);
  });

  it('a backed-off event stays counted but a drain makes no progress and stops', async () => {
    const store = createMemoryLocalFirstStore();
    await append(store, 'stuck');
    const { coordinator } = coordinatorFor(store, (batch) => batch.events.map((e) => receiptOf(e.eventId, 'dependency_pending')));
    await coordinator.synchronize(BOUND);
    const summary = await coordinator.synchronize(BOUND);
    expect(summary?.pushed).toBe(0);
    expect(await store.read((tx) => countPending(tx, BOUND))).toBe(1);
  });
});

describe('dependencies follow the dependency ENTITY, whatever its key', () => {
  const entity = (store: LocalFirstStore, type: 'project' | 'chat' | 'ticket', id: string, key: string, dependsOn: string[] = []) =>
    store.transact((tx) => tx.append({
      idempotencyKey: key, clientEntityId: id, entityType: type, operation: 'import',
      schemaVersion: 1, occurredAt: AT, dependsOn, destination: BOUND, payload: { id },
    }));

  it('a dead-lettered project:p:v1 re-filed as project:p:import unblocks its ticket', async () => {
    const store = createMemoryLocalFirstStore();
    const project = await entity(store, 'project', 'p', 'project:p:v1');
    await entity(store, 'ticket', 't', 'ticket:t:import', ['project:p:v1']);
    await store.transact((tx) => tx.deadLetter(project.eventId, 'ticket_title_invalid', AT));
    expect(await store.read((tx) => countPending(tx, BOUND))).toBe(0); // ticket blocked
    const refiled = await entity(store, 'project', 'p', 'project:p:import');
    expect(await store.read((tx) => countPending(tx, BOUND))).toBe(2);
    const all = await store.read((tx) => tx.pending());
    const wired = wireDependencies(all.filter((e) => e.clientEntityId === 't'), all);
    expect(wired[0]?.dependsOn).toEqual([refiled.eventId]);
  });

  it('a chat rebound to chat:c:import keeps the ticket to chat edge', async () => {
    const store = createMemoryLocalFirstStore();
    const marker = await entity(store, 'chat', 'c', 'chat:c:v1');
    await entity(store, 'ticket', 't', 'ticket:t:import', ['chat:c:v1']);
    await store.transact((tx) => tx.acknowledge([marker.eventId]));
    const rebound = await entity(store, 'chat', 'c', 'chat:c:import');
    const all = await store.read((tx) => tx.pending());
    const wired = wireDependencies(all.filter((e) => e.clientEntityId === 't'), all);
    expect(wired[0]?.dependsOn).toEqual([rebound.eventId]);
  });
});

describe('receipts rebase edits made while a push was in flight', () => {
  const write = (store: LocalFirstStore, key: string, operation: 'import' | 'update', baseVersion?: number, payload: unknown = {}) =>
    store.transact((tx) => tx.append({
      idempotencyKey: key, clientEntityId: 't1', entityType: 'ticket', operation, ...(baseVersion !== undefined ? { baseVersion } : {}),
      schemaVersion: 1, occurredAt: AT, dependsOn: [], destination: BOUND, payload,
    }));

  it('an accepted UPDATE rebases a newer update with the same base onto the new server version', async () => {
    const store = createMemoryLocalFirstStore();
    const first = await write(store, 'u1', 'update', 2, { v: 1 });
    const racing = createSyncCoordinator({
      store,
      policy: (() => { const p = createPlatformPolicy(); p.set({ synchronize: true }); return p; })(),
      deviceId: 'd',
      lease: { run: (_o, work) => work() },
      transport: {
        async push(batch) {
          await write(store, 'u2', 'update', 2, { v: 2 });
          return batch.events.map((e) => ({ ...receiptOf(e.eventId, 'accepted'), serverId: '9', serverVersion: 3 }));
        },
        async pull() { return { records: [] }; },
      },
    });
    await racing.synchronize(BOUND);
    const left = await store.read((tx) => tx.pending(BOUND));
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ idempotencyKey: 'u2', operation: 'update', baseVersion: 3, payload: { v: 2 } });
    void first;
  });

  it('an import the server already holds (conflict entity_already_imported) is rebased into an update itself', async () => {
    const store = createMemoryLocalFirstStore();
    await write(store, 'ticket:t1:import', 'import', undefined, { v: 1 });
    const { coordinator } = coordinatorFor(store, (batch) => batch.events.map((e) => ({
      ...receiptOf(e.eventId, 'conflict', 'entity_already_imported'), serverId: '9', serverVersion: 4,
    })));
    await coordinator.synchronize(BOUND);
    const left = await store.read((tx) => tx.pending(BOUND));
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ operation: 'update', baseVersion: 4, idempotencyKey: 'ticket:t1:import', payload: { v: 1 } });
  });
});
