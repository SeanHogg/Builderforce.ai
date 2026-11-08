/**
 * One transaction per push CHUNK (<= PUSH_CHUNK_EVENTS events), one SAVEPOINT per event (G16).
 *
 * - an event that fails with an error rolls back its WHOLE chunk (and the push throws); only the
 *   receipt race is per-event: that event's savepoint rolls back and the chunk goes on;
 * - the importers' cache-bump effects run ONCE after each chunk commits, and never when the chunk
 *   does not commit (nor for an event whose savepoint rolled back);
 * - a chunk opens its transaction lazily: a replay-only push opens none;
 * - a deadlock (40P01) retries the chunk, at most twice more;
 * - a chat created earlier in the chunk is visible to a later event of the same chunk.
 */

import { describe, expect, it } from 'vitest';
import {
  SYNC_PROTOCOL_VERSION,
  hashSyncPayload,
  type EntityDestination,
} from '../../domain/sync/syncProtocol';
import { createMemorySyncStores } from './__fixtures__/memorySyncStores';
import { handleSyncPush } from './handleSyncPush';
import { PUSH_CHUNK_EVENTS } from './syncChunking';
import type { BoundedImportOutcome, SyncImportContext, SyncNamedImporters, SyncStoreSet } from './syncPorts';

const NOW = new Date('2026-02-01T10:00:00.000Z');
const DESTINATION: EntityDestination = { kind: 'bound', tenantId: '7', accountId: 'user-7' };
const AUTH = { tenantId: 7, userId: 'user-7', role: 'developer' };

const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;

function event(n: number, entityType = 'chat') {
  const payload = { title: `event ${n}` };
  return {
    eventId: uuid(n),
    clientEntityId: uuid(1_000 + n),
    entityType,
    operation: 'create',
    schemaVersion: 1,
    localSequence: n,
    occurredAt: '2026-01-31T08:00:00.000Z',
    dependsOn: [] as string[],
    destination: DESTINATION,
    payload,
    payloadHash: hashSyncPayload(payload),
  };
}

const batch = (events: Array<ReturnType<typeof event>>) => ({
  batchId: 'batch-1',
  protocolVersion: SYNC_PROTOCOL_VERSION,
  deviceId: 'device-a',
  destination: DESTINATION,
  events,
});

interface Behaviour {
  /** Event ids whose importer throws a generic error AFTER writing. */
  explode?: Set<string>;
  /** Event ids whose importer answers `pending` (writes nothing durable, stays retryable). */
  pending?: Set<string>;
  /** Event ids whose importer throws a deadlock (40P01) this many times, then succeeds. */
  deadlock?: Map<string, number>;
  /** Called by every importer so a test can observe order and the commit state. */
  onEffect?: (eventId: string) => void;
}

function harness(behaviour: Behaviour = {}) {
  const effects: string[] = [];
  const run = async (
    ev: { eventId: string; payload: unknown; clientEntityId: string },
    ctx: SyncImportContext,
    stores: SyncStoreSet,
  ): Promise<BoundedImportOutcome> => {
    // A write of the importer's own, in the event's savepoint.
    await stores.upsertMapping({
      tenantId: 7, entityType: 'chat', clientEntityId: ev.clientEntityId, serverId: '1', serverVersion: 1,
      destinationKey: ctx.destinationKey, payloadHash: 'h', createdByDevice: 'device-a', now: NOW,
    });
    ctx.afterCommit(async () => {
      effects.push(ev.eventId);
      behaviour.onEffect?.(ev.eventId);
    });
    if (behaviour.explode?.has(ev.eventId)) throw new Error('importer exploded');
    if (behaviour.pending?.has(ev.eventId)) return { status: 'pending', detail: 'parent_not_ready' };
    const left = behaviour.deadlock?.get(ev.eventId) ?? 0;
    if (left > 0) {
      behaviour.deadlock!.set(ev.eventId, left - 1);
      throw Object.assign(new Error('deadlock detected'), { code: '40P01' });
    }
    return {
      status: 'applied',
      serverId: ev.clientEntityId,
      serverVersion: 1,
      payloadHash: hashSyncPayload(ev.payload),
      destinationKey: ctx.destinationKey,
      payload: ev.payload,
    };
  };
  const importers: SyncNamedImporters = {
    importSyncedTicket: run,
    importSyncedProject: run,
    importSyncedChat: run,
    importSyncedMessage: run,
    importSyncedUsage: run,
    importSyncedChatTicketLink: run,
    importMirrorRecord: run,
  } as never;
  const stores = createMemorySyncStores({ importers, now: () => NOW });
  return { stores, effects, push: (body: unknown) => handleSyncPush(body, { auth: AUTH, now: NOW, stores }) };
}

describe('handleSyncPush — chunked transactions', () => {
  it('splits a push into transactions of at most PUSH_CHUNK_EVENTS, effects after each commit', async () => {
    const seen: number[] = [];
    const h = harness({ onEffect: () => { seen.push(h.stores.batchCommits()); } });
    const events = Array.from({ length: PUSH_CHUNK_EVENTS * 2 + 10 }, (_, i) => event(i + 1));
    const response = await h.push(batch(events));
    expect(response.ok && response.receipts).toHaveLength(events.length);
    expect(response.ok && response.receipts.every((r) => r.status === 'accepted')).toBe(true);
    expect(h.stores.batchCommits()).toBe(3);
    // Each effect ran only after ITS chunk committed: 25 at commit 1, 25 at 2, 10 at 3.
    expect(seen.filter((n) => n === 1)).toHaveLength(PUSH_CHUNK_EVENTS);
    expect(seen.filter((n) => n === 2)).toHaveLength(PUSH_CHUNK_EVENTS);
    expect(seen.filter((n) => n === 3)).toHaveLength(10);
  });

  describe('a dependency across a chunk boundary', () => {
    const FIRST = PUSH_CHUNK_EVENTS + 1; // the first event of the SECOND chunk
    const events = () => Array.from({ length: FIRST }, (_, i) => (
      i + 1 === FIRST ? { ...event(FIRST), dependsOn: [uuid(1)] } : event(i + 1)
    ));

    it('is met when the dependency was accepted in the earlier (committed) chunk', async () => {
      const h = harness();
      const response = await h.push(batch(events()));
      const receipts = response.ok ? response.receipts : [];
      expect(receipts.find((r) => r.eventId === uuid(1))?.status).toBe('accepted');
      expect(receipts.find((r) => r.eventId === uuid(FIRST))?.status).toBe('accepted');
      expect(h.stores.batchCommits()).toBe(2);
    });

    it('is dependency_pending when the dependency itself was left pending in the earlier chunk', async () => {
      const h = harness({ pending: new Set([uuid(1)]) });
      const response = await h.push(batch(events()));
      const receipts = response.ok ? response.receipts : [];
      expect(receipts.find((r) => r.eventId === uuid(1))?.status).toBe('dependency_pending');
      expect(receipts.find((r) => r.eventId === uuid(FIRST))).toMatchObject({ status: 'dependency_pending', detail: uuid(1) });
    });
  });

  it('opens no transaction for a replay-only push', async () => {
    const h = harness();
    await h.push(batch([event(1), event(2)]));
    const before = h.stores.batchCommits();
    const replay = await h.push(batch([event(1), event(2)]));
    expect(replay.ok && replay.receipts.map((r) => r.status)).toEqual(['duplicate', 'duplicate']);
    expect(h.stores.batchCommits()).toBe(before);
    expect(h.stores.batchRollbacks()).toBe(0);
  });

  it('retries a chunk that hit a deadlock, and nothing of the failed attempt survives', async () => {
    const h = harness({ deadlock: new Map([[uuid(2), 1]]) });
    const response = await h.push(batch([event(1), event(2), event(3)]));
    expect(response.ok && response.receipts.map((r) => r.status)).toEqual(['accepted', 'accepted', 'accepted']);
    expect(h.stores.batchRollbacks()).toBe(1);
    expect(h.stores.batchCommits()).toBe(1);
    expect(h.stores.state().changes).toHaveLength(3);
    expect(h.effects).toEqual([uuid(1), uuid(2), uuid(3)]);
  });

  it('gives up after two retries and propagates the deadlock', async () => {
    const h = harness({ deadlock: new Map([[uuid(1), 3]]) });
    await expect(h.push(batch([event(1)]))).rejects.toThrow('deadlock detected');
    expect(h.stores.batchRollbacks()).toBe(3);
    expect(h.effects).toEqual([]);
  });
});

describe('handleSyncPush — one transaction per batch', () => {
  it('commits the whole batch once, each event in its own savepoint', async () => {
    const h = harness();
    const response = await h.push(batch([event(1), event(2), event(3)]));
    expect(response.ok && response.receipts.map((r) => r.status)).toEqual(['accepted', 'accepted', 'accepted']);
    expect(h.stores.batchCommits()).toBe(1);
    expect(h.stores.batchRollbacks()).toBe(0);
    expect(h.stores.commits()).toBe(3);
    expect(h.stores.state().changes).toHaveLength(3);
  });

  it('rolls back only the event that lost the receipt race; the others of the batch commit', async () => {
    const h = harness();
    // Event 2 already has a receipt from a concurrent delivery that raced past the replay lookup.
    await h.push(batch([event(2)]));
    const outer = h.stores.findEvent;
    let calls = 0;
    h.stores.findEvent = async (...args) => (calls++ === 1 ? null : outer(...args));

    const response = await h.push(batch([event(1), event(2), event(3)]));

    expect(response.ok && response.receipts.map((r) => r.status)).toEqual(['accepted', 'duplicate', 'accepted']);
    const state = h.stores.state();
    // Winner + events 1 and 3: the loser's mapping/projection/change writes rolled back with it.
    expect(state.changes).toHaveLength(3);
    expect(state.events.map((e) => e.eventId).sort()).toEqual([uuid(1), uuid(2), uuid(3)]);
    expect(h.stores.rollbacks()).toBe(1);
    expect(h.stores.batchCommits()).toBe(2);
    expect(h.stores.batchRollbacks()).toBe(0);
  });

  it('runs the cache-bump effects once, after the batch commits, and drops the rolled-back event’s', async () => {
    let committedWhenRun: number[] = [];
    const h = harness({ onEffect: () => { committedWhenRun.push(h.stores.batchCommits()); } });
    await h.push(batch([event(2)]));
    h.effects.length = 0;
    committedWhenRun = [];
    const outer = h.stores.findEvent;
    let calls = 0;
    h.stores.findEvent = async (...args) => (calls++ === 1 ? null : outer(...args));

    await h.push(batch([event(1), event(2), event(3)]));

    // Event 2's savepoint rolled back, so its bump never runs; 1 and 3 run once each, after commit #2.
    expect(h.effects).toEqual([uuid(1), uuid(3)]);
    expect(committedWhenRun).toEqual([2, 2]);
  });

  it('runs no effect and returns no receipts when the batch fails — the whole batch rolls back', async () => {
    const h = harness({ explode: new Set([uuid(3)]) });
    await expect(h.push(batch([event(1), event(2), event(3)]))).rejects.toThrow('importer exploded');
    expect(h.effects).toEqual([]);
    expect(h.stores.batchRollbacks()).toBe(1);
    expect(h.stores.batchCommits()).toBe(0);
    const state = h.stores.state();
    expect(state.events).toHaveLength(0);
    expect(state.mappings).toHaveLength(0);
    expect(state.changes).toHaveLength(0);
  });

  it('resolves chat ownership on the batch transaction so a later event sees an earlier one’s chat', async () => {
    const resolved: Array<number | null> = [];
    const stores = createMemorySyncStores({
      importers: {
        importSyncedChat: async (_ev: unknown, ctx: SyncImportContext) => {
          resolved.push(await ctx.resolveOwnChatId(41));
          return { status: 'rejected', detail: 'unused' };
        },
      } as never,
      // The chat exists only inside the batch transaction; the committed reader cannot see it.
      references: { chatOwnedBy: async () => false },
      referencesInTx: { chatOwnedBy: async () => true },
      now: () => NOW,
    });
    await handleSyncPush(batch([event(1)]), { auth: AUTH, now: NOW, stores });
    expect(resolved).toEqual([41]);
  });
});
