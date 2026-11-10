import { describe, expect, it } from 'vitest';
import {
  DEPENDENCY_UNRESOLVABLE, HOLD_BACKOFF_BASE_MS, HOLD_BACKOFF_CAP_MS, SYNC_EVENT_RETENTION_DAYS,
  holdBackoffMs, holdGiveUpReason, nextHoldTransition,
} from './holdLimits.js';
import { createPlatformPolicy } from './policy.js';
import type { JournalEvent, SyncReceipt } from './records.js';
import { countPending, createMemoryLocalFirstStore, type LocalFirstStore } from './store.js';
import { isRequeueableReason, listJournalDeadLetters, requeueJournalDeadLetter } from './requeueJournalDeadLetter.js';
import { blockedEventIds } from './dependencyGraph.js';
import { createSyncCoordinator, wireDependencies, type SyncPushBatch } from './sync.js';

const AT = '2026-10-19T00:00:00.000Z';
const BOUND = { kind: 'bound' as const, tenantId: '7' };
const DAY = 24 * 60 * 60 * 1000;

describe('holdGiveUpReason', () => {
  it('names the server event retention (90 days) for the dependency wait', () => {
    expect(SYNC_EVENT_RETENTION_DAYS).toBe(90);
  });

  it('is patient with a dependency_pending hold until the server could have swept the receipt', () => {
    expect(holdGiveUpReason('dependency_pending', 'x', 89 * DAY)).toBeUndefined();
    expect(holdGiveUpReason('dependency_pending', 'x', 90 * DAY)).toBe(DEPENDENCY_UNRESOLVABLE);
  });

  it('keeps the 7 day rule for every other hold', () => {
    expect(holdGiveUpReason('conflict', 'base_version_conflict', 6 * DAY)).toBeUndefined();
    expect(holdGiveUpReason('conflict', 'base_version_conflict', 7 * DAY)).toBe('gave_up:base_version_conflict');
    expect(holdGiveUpReason('rejected', undefined, 7 * DAY)).toBe('gave_up:rejected');
  });
});

describe('holdBackoffMs', () => {
  it('waits 30s · 2^(n-1), capped at an hour', () => {
    expect(holdBackoffMs(1)).toBe(HOLD_BACKOFF_BASE_MS);
    expect(holdBackoffMs(2)).toBe(60_000);
    expect(holdBackoffMs(4)).toBe(240_000);
    expect(holdBackoffMs(30)).toBe(HOLD_BACKOFF_CAP_MS);
    expect(HOLD_BACKOFF_CAP_MS).toBe(60 * 60 * 1000);
  });
});

describe('nextHoldTransition', () => {
  const at = new Date(AT);

  it('holds a fresh event: first attempt, clock starts now, re-sent after the base backoff', () => {
    expect(nextHoldTransition({}, 'conflict', 'base_version_conflict', at)).toEqual({
      kind: 'hold',
      hold: { holdKind: 'conflict', holdAttempts: 1, heldSince: AT, nextAttemptAt: new Date(Date.parse(AT) + 30_000).toISOString() },
    });
  });

  it('counts attempts and keeps the clock under the same kind of hold', () => {
    const since = new Date(Date.parse(AT) - DAY).toISOString();
    const next = nextHoldTransition({ holdKind: 'rejected', holdAttempts: 2, heldSince: since }, 'rejected', 'x', at);
    expect(next).toEqual({ kind: 'hold', hold: { holdKind: 'rejected', holdAttempts: 3, heldSince: since, nextAttemptAt: new Date(Date.parse(AT) + 120_000).toISOString() } });
  });

  it('regression: a new KIND of hold restarts the clock and the count, so a long dependency wait does not give up a conflict at once', () => {
    const longAgo = new Date(Date.parse(AT) - 30 * DAY).toISOString();
    const next = nextHoldTransition({ holdKind: 'dependency_pending', holdAttempts: 9, heldSince: longAgo }, 'conflict', 'base_version_conflict', at);
    expect(next).toEqual({ kind: 'hold', hold: { holdKind: 'conflict', holdAttempts: 1, heldSince: AT, nextAttemptAt: new Date(Date.parse(AT) + 30_000).toISOString() } });
  });

  it('dead-letters once the hold is out of patience, at the receipt time', () => {
    const since = new Date(Date.parse(AT) - 7 * DAY).toISOString();
    expect(nextHoldTransition({ holdKind: 'conflict', holdAttempts: 40, heldSince: since }, 'conflict', 'base_version_conflict', at))
      .toEqual({ kind: 'dead_letter', reason: 'gave_up:base_version_conflict', at: AT });
    const parentSince = new Date(Date.parse(AT) - 90 * DAY).toISOString();
    expect(nextHoldTransition({ holdKind: 'dependency_pending', heldSince: parentSince }, 'dependency_pending', undefined, at))
      .toEqual({ kind: 'dead_letter', reason: DEPENDENCY_UNRESOLVABLE, at: AT });
  });
});

async function append(store: LocalFirstStore, key: string, dependsOn: string[] = []): Promise<JournalEvent> {
  return store.transact((tx) => tx.append({
    idempotencyKey: key, clientEntityId: key, entityType: 'ticket', operation: 'create',
    schemaVersion: 1, occurredAt: AT, dependsOn, destination: BOUND, payload: { key },
  }));
}

function coordinatorFor(store: LocalFirstStore, answer: (batch: SyncPushBatch) => SyncReceipt[], now: () => Date) {
  const policy = createPlatformPolicy();
  policy.set({ synchronize: true });
  const pushed: SyncPushBatch[] = [];
  const coordinator = createSyncCoordinator({
    store,
    policy,
    deviceId: 'd',
    lease: { run: (_owner, work) => work() },
    now,
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

describe('a dependency the server can no longer resolve is dead-lettered, not an endless spinner', () => {
  it('dead-letters a dependency_pending event after the server event retention', async () => {
    let clock = Date.parse(AT);
    const store = createMemoryLocalFirstStore();
    await append(store, 'orphan');
    const make = () => coordinatorFor(
      store,
      (batch) => batch.events.map((e) => receiptOf(e.eventId, 'dependency_pending', 'dependency_missing')),
      () => new Date(clock),
    );
    await make().coordinator.synchronize(BOUND);

    clock += 89 * DAY;
    await make().coordinator.synchronize(BOUND);
    expect((await store.read((tx) => tx.pending(BOUND)))[0]?.deadLetter).toBeUndefined();
    expect(await store.read((tx) => countPending(tx, BOUND))).toBe(1);

    clock += 2 * DAY;
    await make().coordinator.synchronize(BOUND);
    const [event] = await store.read((tx) => tx.pending(BOUND));
    expect(event?.deadLetter?.reason).toBe(DEPENDENCY_UNRESOLVABLE);
    // The existing dead-letter surface: no longer pending work, still in the journal.
    expect(await store.read((tx) => countPending(tx, BOUND))).toBe(0);
  });

  it('can be re-queued: the requeued event is pushed again, the dead letter stays as the audit record', async () => {
    let clock = Date.parse(AT);
    const store = createMemoryLocalFirstStore();
    const original = await append(store, 'orphan');
    const dependencyMissing = (batch: SyncPushBatch) => batch.events.map((e) => receiptOf(e.eventId, 'dependency_pending'));
    await coordinatorFor(store, dependencyMissing, () => new Date(clock)).coordinator.synchronize(BOUND);
    clock += 91 * DAY;
    await coordinatorFor(store, dependencyMissing, () => new Date(clock)).coordinator.synchronize(BOUND);
    expect(await store.read((tx) => countPending(tx, BOUND))).toBe(0);

    const requeued = await requeueJournalDeadLetter(store, original.eventId);
    expect(requeued).toBeDefined();
    expect(requeued?.eventId).not.toBe(original.eventId);
    expect(requeued?.deadLetter).toBeUndefined();
    expect(await requeueJournalDeadLetter(store, 'unknown')).toBeUndefined();
    expect(await requeueJournalDeadLetter(store, requeued!.eventId)).toBeUndefined();

    const accept = (batch: SyncPushBatch) => batch.events.map((e) => receiptOf(e.eventId, 'accepted'));
    const again = coordinatorFor(store, accept, () => new Date(clock));
    await again.coordinator.synchronize(BOUND);
    expect(again.pushed[0]?.events.map((e) => e.eventId)).toEqual([requeued?.eventId]);
    const kept = await store.read((tx) => tx.pending(BOUND));
    expect(kept.find((e) => e.eventId === original.eventId)?.deadLetter?.reason).toBe(DEPENDENCY_UNRESOLVABLE);
  });

  it('refuses to requeue a permanent refusal, lists dead letters, and accepts gave_up:*', async () => {
    const store = createMemoryLocalFirstStore();
    const permanent = await append(store, 'bad');
    const stuck = await append(store, 'stuck');
    await store.transact(async (tx) => {
      await tx.deadLetter(permanent.eventId, 'ticket_title_invalid', AT);
      await tx.deadLetter(stuck.eventId, 'gave_up:project_unresolved', AT);
    });
    expect((await listJournalDeadLetters(store)).map((e) => e.eventId)).toEqual([permanent.eventId, stuck.eventId]);
    expect(isRequeueableReason('ticket_title_invalid')).toBe(false);
    await expect(requeueJournalDeadLetter(store, permanent.eventId)).rejects.toThrow('dead_letter_not_requeueable:ticket_title_invalid');
    expect(await store.read((tx) => countPending(tx, BOUND))).toBe(0);
    expect((await requeueJournalDeadLetter(store, stuck.eventId))?.eventId).not.toBe(stuck.eventId);
    expect(await store.read((tx) => countPending(tx, BOUND))).toBe(1);
  });

  it('unblocks a dependent of a dead-lettered UPDATE once it is requeued: its wire dependsOn becomes the new id', async () => {
    const store = createMemoryLocalFirstStore();
    const update = await store.transact((tx) => tx.append({
      idempotencyKey: 'ticket:t:v2', clientEntityId: 't', entityType: 'ticket', operation: 'update',
      schemaVersion: 1, occurredAt: AT, dependsOn: [], destination: BOUND, payload: { v: 2 },
    }));
    const dependent = await store.transact((tx) => tx.append({
      idempotencyKey: 'ticket:t:v3', clientEntityId: 't', entityType: 'ticket', operation: 'update',
      schemaVersion: 1, occurredAt: AT, dependsOn: [update.eventId], destination: BOUND, payload: { v: 3 },
    }));
    await store.transact((tx) => tx.deadLetter(update.eventId, 'dependency_unresolvable', AT));
    const everyone = () => store.read((tx) => tx.pending(BOUND));
    expect(blockedEventIds(await everyone()).has(dependent.eventId)).toBe(true);

    const requeued = await requeueJournalDeadLetter(store, update.eventId);
    const all = await everyone();
    expect(blockedEventIds(all).has(dependent.eventId)).toBe(false);
    const [wired] = wireDependencies(all.filter((e) => e.eventId === dependent.eventId), all);
    expect(wired?.dependsOn).toEqual([requeued!.eventId]);
  });

  it('does not wait on a dependency the server already accepted: the edge is not put on the wire', async () => {
    const store = createMemoryLocalFirstStore();
    const parent = await append(store, 'parent');
    const clock = () => new Date(Date.parse(AT));
    const first = coordinatorFor(store, (batch) => batch.events.map((e) => ({
      ...receiptOf(e.eventId, 'accepted'), serverId: '900', serverVersion: 1,
    })), clock);
    await first.coordinator.synchronize(BOUND);
    expect(await store.read((tx) => countPending(tx, BOUND))).toBe(0);

    // Months later a child still names the parent, by key and by wire id.
    const child = await append(store, 'child', ['parent', parent.eventId]);
    const second = coordinatorFor(store, (batch) => batch.events.map((e) => receiptOf(e.eventId, 'accepted')), clock);
    await second.coordinator.synchronize(BOUND);
    const sent = second.pushed[0]?.events.find((e) => e.eventId === child.eventId);
    expect(sent?.dependsOn).toEqual([]);
  });
});
