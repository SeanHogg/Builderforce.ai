import { describe, expect, it } from 'vitest';
import { UNBOUND_DESTINATION, type JournalEvent } from './records.js';
import { createMemoryLocalFirstStore } from './store.js';
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
  it('resolves keys against every pending event, keeps ids, drops acknowledged keys', () => {
    const project = journal(P, 'project:p:v1');
    const ticket = journal(T, 'ticket:t:v1', ['project:p:v1', OTHER, 'execution:start:gone', 'ticket:t:v1']);
    const [wired] = wireDependencies([ticket], [project, ticket]);
    expect(wired?.dependsOn).toEqual([P, OTHER]);
    expect(ticket.dependsOn).toHaveLength(4);
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
