import { describe, expect, it } from 'vitest';
import { UNBOUND_DESTINATION, type EntityDestination, type JournalEvent } from './records.js';
import { createMemoryLocalFirstStore, newLocalRecord } from './store.js';
import { dependencyIndex, loadMappedEntities, resolveDependency, unsendableEventIds } from './dependencyGraph.js';
import { importKey } from './journalRules.js';
import { createSyncCoordinator, wireDependencies, type SyncPushBatch } from './sync.js';
import { createPlatformPolicy } from './policy.js';

const AT = '2026-10-19T00:00:00.000Z';
const BOUND = { kind: 'bound' as const, tenantId: '7' };

function journal(eventId: string, idempotencyKey: string | undefined, dependsOn: string[] = []): JournalEvent {
  return {
    eventId,
    ...(idempotencyKey ? { idempotencyKey } : {}),
    clientEntityId: 'c',
    entityType: 'ticket',
    operation: 'create',
    schemaVersion: 1,
    localSequence: 1,
    occurredAt: AT,
    dependsOn,
    destination: UNBOUND_DESTINATION,
    payload: {},
    payloadHash: 'fnv1a:0',
  };
}

const P = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

describe('wireDependencies', () => {
  it('resolves keys against every live pending event; drops ids and keys nothing pending names', () => {
    const project = journal(P, 'project:p:v1');
    const ticket = journal(T, 'ticket:t:v1', ['project:p:v1', OTHER, 'execution:start:gone', 'ticket:t:v1']);
    const [wired] = wireDependencies([ticket], [project, ticket]);
    // OTHER is an id no pending event carries (acknowledged, or replaced away): nothing to wait for.
    expect(wired?.dependsOn).toEqual([P]);
    expect(ticket.dependsOn).toHaveLength(4);
  });
});

describe('resolveDependency across the unbound partition', () => {
  const TICKET = '44444444-4444-4444-8444-444444444444';
  const LINK = '55555555-5555-4555-8555-555555555555';

  /** A ticket record in `ticketAt` and a BOUND link import waiting on the ticket's import key. */
  async function setup(ticketAt: EntityDestination, mapped: boolean) {
    const store = createMemoryLocalFirstStore();
    await store.transact(async (tx) => {
      await tx.put(newLocalRecord<unknown>({ id: TICKET, entityType: 'ticket', payload: {}, deviceId: 'd', destination: ticketAt, occurredAt: AT }));
      if (mapped) await tx.putMapping({ destination: BOUND, entityType: 'ticket', clientEntityId: TICKET, serverId: '9', serverVersion: 1 });
      await tx.append({
        idempotencyKey: importKey('chat-ticket-link', LINK), clientEntityId: LINK, entityType: 'chat-ticket-link', operation: 'import',
        schemaVersion: 1, occurredAt: AT, dependsOn: [importKey('ticket', TICKET)], destination: BOUND, payload: {},
      });
    });
    return store.read(async (tx) => {
      const all = await tx.pending();
      const facts = await loadMappedEntities(tx, all);
      const link = all.find((event) => event.clientEntityId === LINK)!;
      return {
        resolved: resolveDependency(importKey('ticket', TICKET), dependencyIndex(all, facts), link),
        unsendable: unsendableEventIds(all, facts).has(link.eventId),
      };
    });
  }

  it('regression: a bound dependent on an entity whose record is still unbound awaits the bind (not satisfied)', async () => {
    expect(await setup(UNBOUND_DESTINATION, false)).toEqual({ resolved: { kind: 'awaiting-bind' }, unsendable: true });
  });

  it('regression: a bound dependent on an entity with an imported mapping stays satisfied', async () => {
    expect(await setup(BOUND, true)).toEqual({ resolved: { kind: 'satisfied' }, unsendable: false });
    // The mapping wins even over an unbound local record.
    expect(await setup(UNBOUND_DESTINATION, true)).toEqual({ resolved: { kind: 'satisfied' }, unsendable: false });
  });

  it('regression: a dependency on an entity that does not exist locally stays satisfied', async () => {
    const store = createMemoryLocalFirstStore();
    await store.transact(async (tx) => {
      await tx.append({
        clientEntityId: LINK, entityType: 'chat-ticket-link', operation: 'import',
        schemaVersion: 1, occurredAt: AT, dependsOn: [importKey('ticket', TICKET)], destination: BOUND, payload: {},
      });
    });
    const resolved = await store.read(async (tx) => {
      const all = await tx.pending();
      return resolveDependency(importKey('ticket', TICKET), dependencyIndex(all, await loadMappedEntities(tx, all)), all[0]!);
    });
    expect(resolved).toEqual({ kind: 'satisfied' });
  });
});

describe('createSyncCoordinator pushes wire dependencies', () => {
  it('holds a forward-referenced child behind its parent, then drops the landed key', async () => {
    const store = createMemoryLocalFirstStore();
    await store.transact(async (tx) => {
      // The child is written FIRST and names its parent by key.
      await tx.append({
        idempotencyKey: 'ticket:t:delete', clientEntityId: 't', entityType: 'ticket', operation: 'delete',
        schemaVersion: 1, occurredAt: AT, dependsOn: ['project:p:delete'], destination: BOUND, payload: null,
      });
      await tx.append({
        idempotencyKey: 'project:p:delete', clientEntityId: 'p', entityType: 'project', operation: 'delete',
        schemaVersion: 1, occurredAt: AT, dependsOn: [], destination: BOUND, payload: null,
      });
    });
    const pushed: SyncPushBatch[] = [];
    const policy = createPlatformPolicy();
    policy.set({ synchronize: true });
    const coordinator = createSyncCoordinator({
      store,
      policy,
      deviceId: 'd',
      lease: { run: (_owner, work) => work() },
      transport: {
        async push(batch) {
          pushed.push(batch);
          return batch.events.map((event) => ({ eventId: event.eventId, status: 'accepted' as const, receivedAt: AT }));
        },
        async pull() {
          return { records: [] };
        },
      },
    });

    // The child's key resolves to the pending parent's minted id, so the batch
    // planner holds the child back: only the parent goes in the first push.
    const pending = await store.read((tx) => tx.pending());
    const parent = pending.find((event) => event.idempotencyKey === 'project:p:delete');
    expect(wireDependencies(pending, pending).find((event) => event.idempotencyKey === 'ticket:t:delete')?.dependsOn)
      .toEqual([parent?.eventId]);

    await coordinator.synchronize(BOUND);
    expect(pushed[0]?.events.map((event) => event.idempotencyKey)).toEqual(['project:p:delete']);

    // The parent was acknowledged; its key no longer names a pending event.
    await coordinator.synchronize(BOUND);
    expect(pushed[1]?.events.map((event) => event.idempotencyKey)).toEqual(['ticket:t:delete']);
    expect(pushed[1]?.events[0]?.dependsOn).toEqual([]);
  });
});
