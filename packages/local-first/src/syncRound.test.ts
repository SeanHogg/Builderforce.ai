import { describe, expect, it } from 'vitest';
import {
  countPending,
  createMemoryLocalFirstStore,
  importKey,
  isRecordPayloadFence,
  newLocalRecord,
  queueImport,
  type EntityDestination,
  type LocalFirstTransaction,
  type MemoryLocalFirstStore,
} from './index.js';
import { pickRound } from './syncRound.js';

const BOUND: EntityDestination = { kind: 'bound', platformInstance: 'https://example.test', tenantId: '1' };
const OTHER: EntityDestination = { kind: 'bound', platformInstance: 'https://example.test', tenantId: '2' };
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** A bound chat and `messages` messages queued as imports (each waiting on the chat's), plus noise elsewhere. */
async function queued(messages: number): Promise<MemoryLocalFirstStore> {
  const store = createMemoryLocalFirstStore();
  await store.transact(async (tx) => {
    const chat = { ...newLocalRecord({ id: uuid(0), entityType: 'chat', payload: { chat: { id: 1 } }, deviceId: 'd' }), destination: BOUND };
    await tx.put(chat);
    await queueImport(tx, chat);
    for (let n = 1; n <= messages; n += 1) {
      const message = { ...newLocalRecord({ id: uuid(n), entityType: 'message', payload: { n, text: 'x'.repeat(100) }, deviceId: 'd' }), destination: BOUND };
      await tx.put(message);
      await queueImport(tx, message, chat.id);
    }
    const elsewhere = { ...newLocalRecord({ id: uuid(9_999), entityType: 'ticket', payload: {}, deviceId: 'd' }), destination: OTHER };
    await tx.put(elsewhere);
    await queueImport(tx, elsewhere);
  });
  return store;
}

/** The same transaction without the store's indexes: what a hand-rolled transaction gets. */
const unindexed = (tx: LocalFirstTransaction): LocalFirstTransaction => new Proxy(tx, {
  get(target, key, receiver) {
    if (key === 'pendingLookup' || key === 'pendingCount' || key === 'scanPendingOf') return undefined;
    const value = Reflect.get(target, key, receiver) as unknown;
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
  },
});

const ids = (events: readonly { eventId: string }[]): string[] => events.map((event) => event.eventId);

describe('pickRound', () => {
  it('the indexed batch is the general algorithm\'s batch: same events, same wire dependencies', async () => {
    // More than the head window, so the first look at the queue's head is what decides.
    const store = await queued(1_500);
    const limits = { maxEvents: 100, maxBytes: 10 * 1024 * 1024, at: Date.now() };
    const fast = await store.read((tx) => pickRound(tx, BOUND, limits));
    const general = await store.read((tx) => pickRound(unindexed(tx), BOUND, limits));
    expect(fast.batch).toHaveLength(100);
    expect(ids(fast.batch)).toEqual(ids(general.batch));
    expect(fast.batch.map((event) => event.dependsOn)).toEqual(general.batch.map((event) => event.dependsOn));
    // Every message waits on the chat's import, which is the first event of the batch.
    expect(fast.batch.slice(1).every((event) => event.dependsOn[0] === fast.batch[0]!.eventId)).toBe(true);
  });

  it('agrees with the general algorithm with dead letters, held writes and unbound work in play', async () => {
    const store = await queued(60);
    await store.transact(async (tx) => {
      const events = await tx.pending(BOUND);
      // A dead-lettered message (nothing depends on it), a held one past its backoff, one held
      // and still backing off, and a dead-lettered CHAT import — which blocks every message.
      await tx.deadLetter(events[5]!.eventId, 'payload_invalid', 'now');
      await tx.hold(events[7]!.eventId, { holdKind: 'conflict', holdAttempts: 1, heldSince: 'x', nextAttemptAt: new Date(0).toISOString() });
      await tx.hold(events[9]!.eventId, { holdKind: 'conflict', holdAttempts: 1, heldSince: 'x', nextAttemptAt: new Date(Date.now() + 60_000).toISOString() });
      // An unbound ticket the next pass binds, and a bound link waiting on it.
      const ticket = newLocalRecord({ id: uuid(7_000), entityType: 'ticket', payload: {}, deviceId: 'd' });
      await tx.put(ticket);
      const link = { ...newLocalRecord({ id: uuid(7_001), entityType: 'chat-ticket-link', payload: {}, deviceId: 'd' }), destination: BOUND };
      await tx.put(link);
      await queueImport(tx, link, undefined, [importKey('ticket', ticket.id)]);
    });
    const limits = { maxEvents: 100, maxBytes: 10 * 1024 * 1024, at: Date.now() };
    const compare = async (): Promise<void> => {
      const fast = await store.read((tx) => pickRound(tx, BOUND, limits));
      const general = await store.read((tx) => pickRound(unindexed(tx), BOUND, limits));
      expect(ids(fast.batch)).toEqual(ids(general.batch));
      expect(fast.batch.map((event) => event.dependsOn)).toEqual(general.batch.map((event) => event.dependsOn));
    };
    await compare();
    await store.transact(async (tx) => {
      const [chatImport] = (await tx.pending(BOUND)).filter((event) => event.entityType === 'chat');
      await tx.deadLetter(chatImport!.eventId, 'payload_invalid', 'now');
    });
    await compare();
    expect((await store.read((tx) => pickRound(tx, BOUND, limits))).batch.filter((event) => event.entityType === 'message')).toEqual([]);
  });

  it('a dependent whose dependency is not in the batch is not sent ahead of it', async () => {
    const store = await queued(3);
    const one = await store.read((tx) => pickRound(tx, BOUND, { maxEvents: 1, maxBytes: 1 << 20, at: Date.now() }));
    expect(one.batch.map((event) => event.entityType)).toEqual(['chat']);
    // With the chat's import acknowledged, the messages go (its key no longer names a pending write).
    await store.transact(async (tx) => {
      const [chatImport] = (await tx.pending(BOUND)).filter((event) => event.idempotencyKey === importKey('chat', uuid(0)));
      await tx.acknowledge([chatImport!.eventId]);
    });
    const rest = await store.read((tx) => pickRound(tx, BOUND, { maxEvents: 10, maxBytes: 1 << 20, at: Date.now() }));
    expect(rest.batch.map((event) => event.dependsOn)).toEqual([[], [], []]);
  });
});

describe('countPending', () => {
  it('is a count the store keeps per partition, equal to the walk it replaces', async () => {
    const store = await queued(40);
    for (const destination of [BOUND, OTHER, undefined]) {
      const counted = await store.read((tx) => countPending(tx, destination));
      const walked = await store.read((tx) => countPending(unindexed(tx), destination));
      expect(counted).toBe(walked);
    }
    expect(await store.read((tx) => countPending(tx, BOUND))).toBe(41);
    // A transaction's own writes are counted too (the draft's adjustments).
    await store.transact(async (tx) => {
      // (Not the partitions' record-payload fences: those are counted as neither.)
      const [first] = (await tx.pending(BOUND)).filter((event) => !isRecordPayloadFence(event));
      await tx.acknowledge([first!.eventId]);
      await tx.deadLetter((await tx.pending(OTHER)).filter((event) => !isRecordPayloadFence(event))[0]!.eventId, 'x', 'now');
      expect(tx.pendingCount!(BOUND)).toEqual({ live: 40, dead: 1 });
      expect(tx.pendingCount!(OTHER)).toEqual({ live: 0, dead: 1 });
    });
    expect(await store.read((tx) => tx.pendingCount!(BOUND))).toEqual({ live: 40, dead: 1 });
    // With a dead letter in play the walk decides (blocked dependents), and still agrees.
    expect(await store.read((tx) => countPending(tx, BOUND))).toBe(await store.read((tx) => countPending(unindexed(tx), BOUND)));
  });
});
