import { describe, expect, it } from 'vitest';
import { applySyncEvent, createMemorySyncApplyStore, type SyncApplyEvent } from './idempotentApply';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const DEPENDENCY_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_DEPENDENCY = '44444444-4444-4444-8444-444444444444';
const ENTITY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function event(overrides: Partial<SyncApplyEvent> = {}): SyncApplyEvent {
  return {
    tenantId: 7,
    deviceId: 'device-a',
    eventId: EVENT_ID,
    clientEntityId: ENTITY_ID,
    entityType: 'ticket',
    payload: { title: 'once' },
    dependsOn: [],
    ...overrides,
  };
}

describe('applySyncEvent', () => {
  it('returns the first receipt as duplicate and does not apply a second mutation', () => {
    const store = createMemorySyncApplyStore();
    const first = applySyncEvent(store, event());
    const replay = applySyncEvent(store, event({ payload: { title: 'replay must not land' } }));

    expect(first.status).toBe('accepted');
    expect(first.receipt?.status).toBe('accepted');
    expect(replay.status).toBe('duplicate');
    expect(replay.serverId).toBe(first.serverId);
    expect(replay.receipt).toEqual({ ...first.receipt, status: 'duplicate' });
    expect(store.receipts()).toEqual([first.receipt]);
    expect(store.receipts()).toHaveLength(1);
    expect(store.receipts()[0]?.status).toBe('accepted');
    expect(store.projections()).toHaveLength(1);
    expect(store.projections()[0]?.payload).toEqual({ title: 'once' });
    expect(store.changes()).toHaveLength(1);
    expect(store.committedMutations()).toBe(1);

    const otherDevice = applySyncEvent(store, event({ deviceId: 'device-b' }));
    expect(otherDevice.status).toBe('accepted');
    expect(otherDevice.serverId).not.toBe(first.serverId);
    expect(store.receipts()).toHaveLength(2);
    expect(store.changes()).toHaveLength(2);
    expect(store.committedMutations()).toBe(2);
  });

  it('writes nothing when a dependency has not been accepted, and does not store dependency_pending', () => {
    const store = createMemorySyncApplyStore();
    const waiting = event({
      dependsOn: [OTHER_DEPENDENCY, DEPENDENCY_ID],
      payload: { title: 'blocked' },
    });

    const pending = applySyncEvent(store, waiting);

    expect(pending).toEqual({
      status: 'dependency_pending',
      serverId: null,
      receipt: null,
      unmet: OTHER_DEPENDENCY,
    });
    expect(store.receipts()).toEqual([]);
    expect(store.projections()).toEqual([]);
    expect(store.changes()).toEqual([]);
    expect(store.committedMutations()).toBe(0);
    expect(store.receipts().some((row) => (row.status as string) === 'dependency_pending')).toBe(false);

    const stillPending = applySyncEvent(store, waiting);
    expect(stillPending.status).toBe('dependency_pending');
    expect(store.receipts()).toEqual([]);

    applySyncEvent(store, event({
      eventId: OTHER_DEPENDENCY,
      deviceId: 'device-b',
      clientEntityId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      payload: { title: 'dep-1' },
    }));
    const stillMissingOne = applySyncEvent(store, waiting);
    expect(stillMissingOne.status).toBe('dependency_pending');
    expect(stillMissingOne.unmet).toBe(DEPENDENCY_ID);
    expect(store.receipts()).toHaveLength(1);

    applySyncEvent(store, event({
      eventId: DEPENDENCY_ID,
      deviceId: 'device-b',
      clientEntityId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      payload: { title: 'dep-2' },
    }));
    const applied = applySyncEvent(store, waiting);

    expect(applied.status).toBe('accepted');
    expect(applied.receipt?.status).toBe('accepted');
    expect(applied.receipt?.eventId).toBe(EVENT_ID);
    expect(store.receipts().map((row) => row.eventId)).toEqual([
      OTHER_DEPENDENCY,
      DEPENDENCY_ID,
      EVENT_ID,
    ]);
    expect(store.receipts().every((row) => row.status === 'accepted')).toBe(true);
    expect(store.projections()).toHaveLength(3);
    expect(store.changes()).toHaveLength(3);
  });

  it('rolls back the mutation and the receipt when append throws', () => {
    const store = createMemorySyncApplyStore();
    store.failNextAppend(new Error('append failed'));

    expect(() => applySyncEvent(store, event())).toThrow('append failed');
    expect(store.receipts()).toEqual([]);
    expect(store.projections()).toEqual([]);
    expect(store.changes()).toEqual([]);
    expect(store.committedMutations()).toBe(0);

    const retried = applySyncEvent(store, event());

    expect(retried.status).toBe('accepted');
    expect(store.receipts()).toEqual([retried.receipt]);
    expect(store.projections()).toHaveLength(1);
    expect(store.changes()).toHaveLength(1);
    expect(store.committedMutations()).toBe(1);

    const replay = applySyncEvent(store, event());
    expect(replay.status).toBe('duplicate');
    expect(replay.serverId).toBe(retried.serverId);
    expect(store.receipts()).toHaveLength(1);
    expect(store.changes()).toHaveLength(1);
  });
});
