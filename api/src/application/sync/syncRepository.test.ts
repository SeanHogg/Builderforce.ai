import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_FUTURE_CLOCK_SKEW_MS, hashSyncPayload } from '../../domain/sync/syncProtocol';
import { createMemorySyncApplyStore, type MemorySyncApplyStore } from './idempotentApply';
import { acceptPush, type AcceptPushEvent, type AcceptPushReceipt } from './syncRepository';

/**
 * G15 server push repository. The clock gate runs over the whole batch BEFORE
 * the first apply; a refused event is never handed to `applySyncEvent`. Order
 * comes from `planBatchIngest`, and a cycle, a duplicate event id or a missing
 * dependency applies nothing at all. The apply itself is the existing
 * idempotent `applySyncEvent`, so a replay is a duplicate and an unaccepted
 * dependency is `dependency_pending`.
 *
 * No insert, no Postgres, no fetch: the only store is the injected in-memory
 * one, and the source of this module must not reach a clock, a database or a
 * route.
 */
const NOW = new Date('2026-10-18T12:00:00.000Z');
const TENANT_ID = 7;
const DEVICE_ID = 'device-a';

function atOffset(ms: number): string {
  return new Date(NOW.getTime() + ms).toISOString();
}

function event(overrides: Partial<AcceptPushEvent> & { eventId: string }): AcceptPushEvent {
  return {
    clientEntityId: `entity-${overrides.eventId}`,
    entityType: 'ticket',
    occurredAt: '2026-10-18T11:59:00.000Z',
    dependsOn: [],
    payload: { title: overrides.eventId },
    ...overrides,
  };
}

function push(
  store: MemorySyncApplyStore,
  events: readonly AcceptPushEvent[],
  now: Date = NOW,
): ReturnType<typeof acceptPush> {
  return acceptPush({ tenantId: TENANT_ID, deviceId: DEVICE_ID, events, now, store });
}

function statuses(receipts: readonly AcceptPushReceipt[]): Record<string, string> {
  return Object.fromEntries(receipts.map((receipt) => [receipt.eventId, receipt.status]));
}

/**
 * The module's CODE with its comments stripped. The prose documents that no
 * route is registered and that no clock is read; the assertions below are about
 * what the module can actually DO, so the comments must not satisfy them.
 */
function sourceWithoutComments(url: URL): string {
  return readFileSync(url, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ');
}

describe('acceptPush', () => {
  it('gates every event with rejectInvalidOccurredAt before the first apply', () => {
    const store = createMemorySyncApplyStore();
    const result = push(store, [
      event({ eventId: 'e-ok' }),
      event({ eventId: 'e-invalid', occurredAt: 'not-a-timestamp' }),
      event({ eventId: 'e-future', occurredAt: atOffset(MAX_FUTURE_CLOCK_SKEW_MS + 1) }),
      event({ eventId: 'e-historical', occurredAt: '2001-01-01T00:00:00.000Z' }),
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.gatedOut).toEqual(['e-invalid', 'e-future']);
    expect(statuses(result.receipts)).toEqual({
      'e-ok': 'accepted',
      'e-invalid': 'rejected',
      'e-future': 'rejected',
      'e-historical': 'accepted',
    });
    expect(result.receipts.find((row) => row.eventId === 'e-invalid')?.detail).toBe('occurred_at_invalid');
    expect(result.receipts.find((row) => row.eventId === 'e-future')?.detail).toBe('occurred_at_in_future');

    // The refused events reached no store: no receipt, no projection, no change.
    expect(store.receipts().map((row) => row.eventId)).toEqual(['e-ok', 'e-historical']);
    expect(store.projections().map((row) => row.eventId)).toEqual(['e-ok', 'e-historical']);
    expect(store.changes().map((row) => row.eventId)).toEqual(['e-ok', 'e-historical']);
    expect(store.committedMutations()).toBe(2);
  });

  it('allows the future-skew boundary and an omitted occurredAt', () => {
    const store = createMemorySyncApplyStore();
    const boundary = event({ eventId: 'e-boundary', occurredAt: atOffset(MAX_FUTURE_CLOCK_SKEW_MS) });
    const noClaim = event({ eventId: 'e-no-claim', occurredAt: undefined });

    const result = push(store, [boundary, noClaim]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.gatedOut).toEqual([]);
    expect(statuses(result.receipts)).toEqual({ 'e-boundary': 'accepted', 'e-no-claim': 'accepted' });
    expect(store.committedMutations()).toBe(2);
  });

  it('applies the planned order, so a dependency lands before its dependent', () => {
    const store = createMemorySyncApplyStore();
    const input = [
      event({ eventId: 'e-link', dependsOn: ['e-task'] }),
      event({ eventId: 'e-task', dependsOn: ['e-project'] }),
      event({ eventId: 'e-project' }),
    ];
    const before = input.map((row) => row.eventId);

    const result = push(store, input);

    expect(input.map((row) => row.eventId)).toEqual(before);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.appliedOrder).toEqual(['e-project', 'e-task', 'e-link']);
    // Receipts come back in input order; only the apply used the planned order.
    expect(result.receipts.map((row) => row.eventId)).toEqual(['e-link', 'e-task', 'e-project']);
    expect(statuses(result.receipts)).toEqual({
      'e-link': 'accepted',
      'e-task': 'accepted',
      'e-project': 'accepted',
    });
    expect(store.changes().map((row) => row.eventId)).toEqual(['e-project', 'e-task', 'e-link']);
  });

  it('applies nothing when dependsOn forms a cycle', () => {
    const store = createMemorySyncApplyStore();
    const result = push(store, [
      event({ eventId: 'e-a', dependsOn: ['e-b'] }),
      event({ eventId: 'e-b', dependsOn: ['e-a'] }),
      event({ eventId: 'e-standalone' }),
    ]);

    expect(result).toEqual({ ok: false, reason: 'cycle', receipts: [], appliedOrder: [] });
    expect(store.receipts()).toEqual([]);
    expect(store.projections()).toEqual([]);
    expect(store.changes()).toEqual([]);
    expect(store.committedMutations()).toBe(0);
  });

  it('treats a self-dependency as a cycle and applies nothing', () => {
    const store = createMemorySyncApplyStore();
    expect(push(store, [event({ eventId: 'e-self', dependsOn: ['e-self'] })])).toEqual({
      ok: false,
      reason: 'cycle',
      receipts: [],
      appliedOrder: [],
    });
    expect(store.committedMutations()).toBe(0);
  });

  it('applies nothing when a dependency is not in the batch', () => {
    const store = createMemorySyncApplyStore();
    const result = push(store, [
      event({ eventId: 'e-standalone' }),
      event({ eventId: 'e-orphan', dependsOn: ['e-from-an-earlier-batch'] }),
    ]);

    expect(result).toEqual({
      ok: false,
      reason: 'missing_dependency',
      clientRef: 'e-orphan',
      missing: 'e-from-an-earlier-batch',
      receipts: [],
      appliedOrder: [],
    });
    expect(store.receipts()).toEqual([]);
    expect(store.committedMutations()).toBe(0);
  });

  it('applies nothing when an event id repeats in the batch', () => {
    const store = createMemorySyncApplyStore();
    const result = push(store, [
      event({ eventId: 'e-dup' }),
      event({ eventId: 'e-dup', payload: { title: 'second copy' } }),
    ]);

    expect(result).toEqual({
      ok: false,
      reason: 'duplicate_client_ref',
      clientRef: 'e-dup',
      receipts: [],
      appliedOrder: [],
    });
    expect(store.committedMutations()).toBe(0);
  });

  it('a replay of the same batch is duplicate and does not double-apply', () => {
    const store = createMemorySyncApplyStore();
    const batch = [event({ eventId: 'e-one' }), event({ eventId: 'e-two', dependsOn: ['e-one'] })];

    const first = push(store, batch);
    const replay = push(store, batch);

    expect(first.ok).toBe(true);
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(statuses(first.receipts)).toEqual({ 'e-one': 'accepted', 'e-two': 'accepted' });
    expect(statuses(replay.receipts)).toEqual({ 'e-one': 'duplicate', 'e-two': 'duplicate' });
    expect(store.receipts()).toHaveLength(2);
    expect(store.projections()).toHaveLength(2);
    expect(store.changes()).toHaveLength(2);
    expect(store.committedMutations()).toBe(2);
    const firstIds = first.appliedOrder.map((id) => store.receipts().find((row) => row.eventId === id)?.serverId);
    const replayIds = replay.receipts.map((row) => row.serverId);
    expect(replayIds).toEqual(firstIds);
  });

  it('an empty batch is accepted with no receipts and no store write', () => {
    const store = createMemorySyncApplyStore();
    const result = push(store, []);

    expect(result).toEqual({ ok: true, receipts: [], appliedOrder: [], gatedOut: [] });
    expect(store.committedMutations()).toBe(0);
  });

  it('refuses a batch whose events are not an array without touching the store', () => {
    const store = createMemorySyncApplyStore();
    const result = acceptPush({
      tenantId: TENANT_ID,
      deviceId: DEVICE_ID,
      events: 'nope' as unknown as readonly AcceptPushEvent[],
      now: NOW,
      store,
    });

    expect(result).toEqual({ ok: false, reason: 'invalid_batch', receipts: [], appliedOrder: [] });
    expect(store.committedMutations()).toBe(0);
  });

  it('reads the injected clock rather than the wall clock, so the same event gates differently per `now`', () => {
    const occurredAt = atOffset(30 * 60 * 1000);
    const atNow = push(createMemorySyncApplyStore(), [event({ eventId: 'e-skew', occurredAt })], NOW);
    const later = push(
      createMemorySyncApplyStore(),
      [event({ eventId: 'e-skew', occurredAt })],
      new Date('2026-10-18T13:00:00.000Z'),
    );

    // Thirty minutes ahead of NOW is past the 15-minute skew, so it is refused;
    // measured at 13:00 the very same claim is half an hour in the past and is
    // allowed. Only the injected clock separates the two answers.
    expect(atNow.ok).toBe(true);
    if (!atNow.ok) return;
    expect(atNow.gatedOut).toEqual(['e-skew']);
    expect(statuses(atNow.receipts)).toEqual({ 'e-skew': 'rejected' });
    expect(atNow.receipts[0]?.detail).toBe('occurred_at_in_future');

    expect(later.ok).toBe(true);
    if (!later.ok) return;
    expect(later.gatedOut).toEqual([]);
    expect(statuses(later.receipts)).toEqual({ 'e-skew': 'accepted' });
  });

  it('does not insert, open Postgres, call fetch, or read the clock itself', () => {
    const code = sourceWithoutComments(new URL('./syncRepository.ts', import.meta.url));
    expect(code).not.toContain('Date.now');
    expect(code).not.toContain('new Date(');
    expect(code).not.toContain('fetch(');
    expect(code).not.toMatch(/from ['"][^'"]*(infrastructure|presentation|routes)/);
    expect(code).not.toContain('/api/sync/v1/push');
    expect(code).toContain('rejectInvalidOccurredAt');
    expect(code).toContain('planBatchIngest');
    expect(code).toContain('applySyncEvent');
  });

  it('stores the payload it was given and never re-stamps or re-hashes it', () => {
    const store = createMemorySyncApplyStore();
    const payload = { title: 'kept', nested: { count: 2 } };
    const expectedHash = hashSyncPayload(payload);

    push(store, [event({ eventId: 'e-payload', payload })]);

    expect(store.projections()).toHaveLength(1);
    expect(store.projections()[0]?.payload).toEqual(payload);
    // The repository stores no hash column of its own: hashing is the caller's rule.
    expect(JSON.stringify(store.projections()[0])).not.toContain(expectedHash);
    expect(store.projections()[0]?.eventId).toBe('e-payload');
  });
});