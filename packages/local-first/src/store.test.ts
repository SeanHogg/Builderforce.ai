import { describe, expect, it } from 'vitest';
import { UNBOUND_DESTINATION } from './records.js';
import { createMemoryLocalFirstStore, isJournalEventId, type AppendJournalEvent } from './store.js';

const AT = '2026-10-19T00:00:00.000Z';

function event(overrides: Partial<AppendJournalEvent<{ title: string }>> = {}): AppendJournalEvent<{ title: string }> {
  return {
    clientEntityId: 'ticket-1',
    entityType: 'ticket',
    operation: 'create',
    schemaVersion: 1,
    occurredAt: AT,
    dependsOn: [],
    destination: UNBOUND_DESTINATION,
    payload: { title: 'offline' },
    ...overrides,
  };
}

describe('append — the store mints the wire event id', () => {
  it('mints a UUID and keeps the caller key as idempotencyKey', async () => {
    const store = createMemoryLocalFirstStore();
    const saved = await store.transact((tx) => tx.append(event({ idempotencyKey: 'ticket:ticket-1:v1' })));
    expect(isJournalEventId(saved.eventId)).toBe(true);
    expect(saved.idempotencyKey).toBe('ticket:ticket-1:v1');
  });

  it('treats a legacy composite eventId as the idempotency key', async () => {
    const store = createMemoryLocalFirstStore();
    const saved = await store.transact((tx) => tx.append(event({ eventId: 'event:ticket-1' })));
    expect(isJournalEventId(saved.eventId)).toBe(true);
    expect(saved.idempotencyKey).toBe('event:ticket-1');
  });

  it('keeps a caller-supplied UUID (a replayed wire event) and dedupes on it', async () => {
    const store = createMemoryLocalFirstStore();
    const id = '11111111-1111-4111-8111-111111111111';
    const first = await store.transact((tx) => tx.append(event({ eventId: id })));
    const again = await store.transact((tx) => tx.append(event({ eventId: id, payload: { title: 'other' } })));
    expect(first.eventId).toBe(id);
    expect(again).toEqual(first);
    expect((await store.export()).events).toHaveLength(1);
  });

  it('returns the pending event for a repeated key instead of enqueueing twice', async () => {
    const store = createMemoryLocalFirstStore();
    const first = await store.transact((tx) => tx.append(event({ idempotencyKey: 'fact:f:2' })));
    const second = await store.transact((tx) => tx.append(event({ idempotencyKey: 'fact:f:2' })));
    expect(second.eventId).toBe(first.eventId);
    expect((await store.export()).events).toHaveLength(1);
  });

  it('enqueues the same key again once the first event was acknowledged', async () => {
    const store = createMemoryLocalFirstStore();
    const first = await store.transact((tx) => tx.append(event({ idempotencyKey: 'k' })));
    await store.transact((tx) => tx.acknowledge([first.eventId]));
    const next = await store.transact((tx) => tx.append(event({ idempotencyKey: 'k' })));
    expect(next.eventId).not.toBe(first.eventId);
  });

  it('rewrites a dependency on a pending key to that event id and keeps any other as written', async () => {
    const store = createMemoryLocalFirstStore();
    const run = await store.transact((tx) => tx.append(event({ idempotencyKey: 'audit-run:create:r1', entityType: 'audit-run' })));
    const finding = await store.transact((tx) => tx.append(event({
      idempotencyKey: 'audit-finding:create:f1',
      entityType: 'audit-finding',
      dependsOn: ['audit-run:create:r1', 'execution:start:later', run.eventId],
    })));
    expect(finding.dependsOn).toEqual([run.eventId, 'execution:start:later']);
  });
});
