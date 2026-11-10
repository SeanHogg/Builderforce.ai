import { describe, expect, it } from 'vitest';
import { createPlatformPolicy } from './policy.js';
import type { JournalEvent, SyncReceipt } from './records.js';
import { createMemoryLocalFirstStore, newLocalRecord, type LocalFirstStore } from './store.js';
import { countPending, selectPending } from './pendingQueries.js';
import { wireDependencies } from './sync.js';
import { loadMappedEntities } from './dependencyGraph.js';
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

  it('an unlink rejected with link_not_found is settled: no dead letter, no hold, and the local tombstone stays', async () => {
    const store = createMemoryLocalFirstStore();
    const live = newLocalRecord({ id: 'link-1', entityType: 'chat-ticket-link', payload: { chatClientId: 'c', ticketClientId: 't', linkType: 'linked' }, deviceId: 'd', destination: BOUND });
    await store.transact(async (tx) => {
      await tx.put({ ...live, deletedAt: AT });
      await tx.append({
        idempotencyKey: 'link-1', clientEntityId: 'link-1', entityType: 'chat-ticket-link', operation: 'delete',
        schemaVersion: 1, occurredAt: AT, dependsOn: [], destination: BOUND, payload: null,
      });
    });
    const { coordinator, pushed } = coordinatorFor(store, (batch) => batch.events.map((e) => receiptOf(e.eventId, 'rejected', 'link_not_found')));
    await coordinator.synchronize(BOUND);
    expect(await store.read((tx) => countPending(tx, BOUND))).toBe(0);
    expect(await store.read((tx) => tx.pending(BOUND))).toEqual([]);
    expect((await store.read((tx) => tx.get('chat-ticket-link', 'link-1')))?.deletedAt).toBe(AT);
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
  const WEEK = 7 * 24 * 60 * 60 * 1000;

  it('survives a NEW coordinator, backs off, and gives up only on AGE (7 days), never on a count', async () => {
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
    // Many attempts over a few days: still just held.
    for (let attempt = 2; attempt <= 20; attempt += 1) {
      clock += 3_600_001;
      await make().coordinator.synchronize(BOUND);
    }
    [event] = await store.read((tx) => tx.pending(BOUND));
    expect(event?.deadLetter).toBeUndefined();
    expect(event?.holdAttempts).toBe(20);
    clock += WEEK;
    await make().coordinator.synchronize(BOUND);
    [event] = await store.read((tx) => tx.pending(BOUND));
    expect(event?.deadLetter?.reason).toBe('gave_up:project_unresolved');
    expect(await store.read((tx) => countPending(tx, BOUND))).toBe(0);
  });

  it('a dependency_pending hold never gives up, however old', async () => {
    let clock = Date.parse(AT);
    const store = createMemoryLocalFirstStore();
    await append(store, 'waiting');
    const make = () => coordinatorFor(store, (batch) => batch.events.map((e) => receiptOf(e.eventId, 'dependency_pending')), undefined, () => new Date(clock));
    await make().coordinator.synchronize(BOUND);
    clock += 2 * WEEK;
    await make().coordinator.synchronize(BOUND);
    expect((await store.read((tx) => tx.pending(BOUND)))[0]?.deadLetter).toBeUndefined();
    expect(await store.read((tx) => countPending(tx, BOUND))).toBe(1);
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

describe('dependency resolution stays inside the dependency entity creating writes', () => {
  const OTHER_DEST = { kind: 'bound' as const, tenantId: '8' };
  const ev = (
    store: LocalFirstStore,
    type: 'project' | 'chat' | 'ticket' | 'execution',
    id: string,
    key: string,
    operation: 'import' | 'update' | 'delete' | 'create',
    dependsOn: string[] = [],
    destination: typeof BOUND = BOUND,
  ) => store.transact((tx) => tx.append({
    idempotencyKey: key, clientEntityId: id, entityType: type, operation, ...(operation === 'update' || operation === 'delete' ? { baseVersion: 1 } : {}),
    schemaVersion: 1, occurredAt: AT, dependsOn, destination, payload: {},
  }));
  const wiredDeps = async (store: LocalFirstStore, entityId: string, mapped: ReadonlySet<string> = new Set()) => {
    const all = await store.read((tx) => tx.pending());
    return wireDependencies(all.filter((e) => e.clientEntityId === entityId), all, mapped)[0]?.dependsOn;
  };

  it('(b) never waits on an update: a ticket import does not wait on a later chat edit (no cycle)', async () => {
    const store = createMemoryLocalFirstStore();
    const chat = await ev(store, 'chat', 'c', 'chat:c:import', 'import');
    await ev(store, 'ticket', 't', 'ticket:t:import', 'import', ['chat:c:import']);
    await ev(store, 'chat', 'c', 'chat:c:update:1', 'update');
    expect(await wiredDeps(store, 't')).toEqual([chat.eventId]);
  });

  it('(c) ignores creating writes in another destination', async () => {
    const store = createMemoryLocalFirstStore();
    await ev(store, 'project', 'p', 'project:p:import', 'import', [], OTHER_DEST);
    await ev(store, 'ticket', 't', 'ticket:t:import', 'import', ['project:p:import']);
    expect(await wiredDeps(store, 't')).toEqual([]);
  });

  it('(e) an action-first key (execution:start:run) resolves by exact key, not as an entity', async () => {
    const store = createMemoryLocalFirstStore();
    const start = await ev(store, 'execution', 'run-1', 'execution:start:run-1', 'create');
    await ev(store, 'execution', 'start', 'execution:start:other', 'update');
    await ev(store, 'ticket', 't', 'ticket:t:import', 'import', ['execution:start:run-1']);
    expect(await wiredDeps(store, 't')).toEqual([start.eventId]);
  });

  it('(a) a dependency the server already holds (mapping in the dependent destination) is satisfied', async () => {
    const store = createMemoryLocalFirstStore();
    await ev(store, 'project', 'p', 'project:p:import', 'import');
    await ev(store, 'ticket', 't', 'ticket:t:import', 'import', ['project:p:import']);
    await store.transact((tx) => tx.putMapping({ destination: BOUND, entityType: 'project', clientEntityId: 'p', serverId: '5', serverVersion: 1 }));
    const all = await store.read((tx) => tx.pending());
    const mapped = await store.read((tx) => loadMappedEntities(tx, all));
    expect(await wiredDeps(store, 't', mapped)).toEqual([]);
  });
});

describe('destination isolation and hold-kind clock', () => {
  const OTHER = { kind: 'bound' as const, tenantId: '8' };
  const WEEK = 7 * 24 * 60 * 60 * 1000;

  it('a mapping accepted in destination A does not rebase the same row pending in destination B', async () => {
    const store = createMemoryLocalFirstStore();
    const mk = (destination: typeof BOUND, key: string, payload: unknown) => store.transact((tx) => tx.append({
      idempotencyKey: key, clientEntityId: 't1', entityType: 'ticket', operation: 'import',
      schemaVersion: 1, occurredAt: AT, dependsOn: [], destination, payload,
    }));
    const first = await mk(BOUND, 'a:import', { v: 1 });
    await mk(OTHER, 'b:import', { v: 2 });
    void first;
    const { coordinator } = coordinatorFor(store, (batch) => batch.events.map((e) => ({ ...receiptOf(e.eventId, 'accepted'), serverId: '9', serverVersion: 1 })));
    await coordinator.synchronize(BOUND);
    const left = await store.read((tx) => tx.pending(OTHER));
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ operation: 'import', idempotencyKey: 'b:import', payload: { v: 2 } });
  });

  it('a change of hold kind restarts the give-up clock', async () => {
    let clock = Date.parse(AT);
    const store = createMemoryLocalFirstStore();
    await append(store, 'e');
    let status: SyncReceipt['status'] = 'dependency_pending';
    const make = () => coordinatorFor(store, (batch) => batch.events.map((x) => receiptOf(x.eventId, status, status === 'rejected' ? 'project_unresolved' : undefined)), undefined, () => new Date(clock));
    await make().coordinator.synchronize(BOUND);
    clock += 2 * WEEK;
    status = 'rejected';
    await make().coordinator.synchronize(BOUND);
    const [event] = await store.read((tx) => tx.pending(BOUND));
    expect(event?.deadLetter).toBeUndefined();
    expect(event).toMatchObject({ holdKind: 'rejected', holdAttempts: 1 });
  });
});
