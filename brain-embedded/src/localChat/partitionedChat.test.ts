import { describe, expect, it } from 'vitest';
import {
  createMemoryLocalFirstStore,
  createPlatformPolicy,
  createSyncCoordinator,
  newLocalRecord,
  partitionIdOf,
  type EntityDestination,
  type LocalFirstStore,
  type LocalRecord,
  type PartitionLoader,
  type SyncPushBatch,
  type SyncReceipt,
} from '@builderforce/local-first';
import { bindChatHistoryForSync } from './chatSync';
import { MESSAGE_PARTITION, messageRecordById, type ChatValue, type MessageValue } from './records';
import { createLocalBrainPersistence } from '../localFirstPersistence';

const DEVICE = 'device-a';
const AT = '2026-11-10T00:00:00.000Z';
const BOUND: EntityDestination = { kind: 'bound', platformInstance: 'https://example.test', tenantId: '1' };

/** Chat A (view key 1) holds messages 2..4; chat B (view key 5) holds 6..7. */
const CHAT_A = 1;
const CHAT_B = 5;
const MESSAGE_IDS: Record<number, number[]> = { [CHAT_A]: [2, 3, 4], [CHAT_B]: [6, 7] };

const chatRow = (viewKey: number, destination: EntityDestination = { kind: 'unbound' }): LocalRecord<ChatValue> => {
  const clientId = `chat-${viewKey}`;
  return newLocalRecord<ChatValue>({
    id: clientId, entityType: 'chat', deviceId: DEVICE, occurredAt: AT, destination,
    payload: { clientId, chat: { id: viewKey, title: `Chat ${viewKey}`, projectId: null, origin: 'local', createdAt: AT, updatedAt: AT } as ChatValue['chat'] },
  });
};

const messageRow = (chatId: number, messageId: number, destination: EntityDestination = { kind: 'unbound' }): LocalRecord<MessageValue> => {
  const id = `m-${messageId}`;
  return newLocalRecord<MessageValue>({
    id, entityType: 'message', deviceId: DEVICE, occurredAt: AT, destination,
    payload: {
      clientId: id, chatId, chatClientId: `chat-${chatId}`, eventKey: `message:${id}`,
      message: { id: messageId, role: 'user', content: `turn ${messageId}`, metadata: null, seq: messageId, createdAt: AT } as MessageValue['message'],
    },
  });
};

/** Every chat and message row, each chat's destination as given (`bound` chats by view key). */
async function seed(store: LocalFirstStore, bound: readonly number[] = []): Promise<void> {
  await store.transact(async (tx) => {
    for (const [chat, ids] of Object.entries(MESSAGE_IDS)) {
      const chatId = Number(chat);
      const destination: EntityDestination = bound.includes(chatId) ? BOUND : { kind: 'unbound' };
      await tx.put(chatRow(chatId, destination));
      for (const messageId of ids) await tx.put(messageRow(chatId, messageId, destination));
    }
  });
}

/**
 * The same store as a restart sees it: unpartitioned rows and events resident, every message row
 * behind a stub and a pointer, a loader that counts the partitions it reads. NOTHING is loaded.
 */
async function unloadedCopy(source: LocalFirstStore) {
  const files = new Map<number, LocalRecord[]>();
  for (const row of (await source.export()).records) {
    if (row.entityType !== 'message') continue;
    const chatId = (row as LocalRecord<MessageValue>).payload.chatId;
    files.set(chatId, [...(files.get(chatId) ?? []), row]);
  }
  const loads: string[] = [];
  const loader: PartitionLoader = {
    async load(partitionId) {
      loads.push(partitionId);
      return { records: files.get(Number(partitionId.split('\u0000')[1])) ?? [] };
    },
  };
  const view = source.view();
  const store = createMemoryLocalFirstStore(undefined, { partitions: [MESSAGE_PARTITION], loader });
  store.applyDelta({
    records: view.records,
    events: view.events,
    mappings: view.mappings,
    nextSequence: view.nextSequence,
    ...(view.stubs ? { stubs: view.stubs } : {}),
    partitionPointers: Object.fromEntries([...files].map(([chatId, rows]) => [partitionIdOf('message', chatId), { file: 'messages.journal', length: rows.length }])),
  });
  return { store, loads };
}

const residentStore = async (bound: readonly number[] = []): Promise<LocalFirstStore> => {
  const store = createMemoryLocalFirstStore(undefined, { partitions: [MESSAGE_PARTITION] });
  await seed(store, bound);
  return store;
};

const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 20); });

describe('partitioned chat history: brain-embedded consumers (AE-G031)', () => {
  it('regression: nextId never re-issues an id across unloaded chats, and loads no partition', async () => {
    const { store, loads } = await unloadedCopy(await residentStore());
    const chat = await createLocalBrainPersistence({ store, deviceId: DEVICE, summarizeUnavailable: 'local only' }).createChat({});
    // The highest id is a MESSAGE's (7), not a chat's (5): only the stubs' ordinals know it.
    expect(chat.id).toBe(8);
    expect(loads).toEqual([]);
  });

  it('regression: materializeRound sends, rather than acknowledges as gone, an event whose chat was not loaded', async () => {
    const source = await residentStore();
    expect(await bindChatHistoryForSync(source, DEVICE, BOUND)).toBe(2);
    const { store, loads } = await unloadedCopy(source);
    const policy = createPlatformPolicy();
    policy.set({ synchronize: true });
    const pushed: SyncPushBatch[] = [];
    const coordinator = createSyncCoordinator({
      store, policy, deviceId: DEVICE, lease: { run: (_owner, work) => work() },
      transport: {
        async push(batch) {
          pushed.push(batch);
          return batch.events.map((event): SyncReceipt => ({ eventId: event.eventId, status: 'accepted', receivedAt: AT }));
        },
        async pull() { return { records: [] }; },
      },
    });
    expect(loads).toEqual([]);
    await coordinator.synchronize(BOUND);
    const sent = pushed.flatMap((batch) => batch.events).filter((event) => event.entityType === 'message' && event.operation === 'import');
    expect(sent).toHaveLength(5);
    expect(sent.every((event) => event.payload !== null)).toBe(true); // read from the row, once its chat was loaded
    expect(new Set(loads)).toEqual(new Set([partitionIdOf('message', CHAT_A), partitionIdOf('message', CHAT_B)]));
  });

  it('regression: chatSync binds the rows of unloaded chats, loading only the chats it binds', async () => {
    const source = await residentStore([CHAT_B]); // chat B is already bound: nothing of it to move
    const { store, loads } = await unloadedCopy(source);
    expect(await bindChatHistoryForSync(store, DEVICE, BOUND)).toBe(1);
    expect(loads).toEqual([partitionIdOf('message', CHAT_A)]);
    expect(store.view().stubs?.every((stub) => !stub.unbound)).toBe(true);
    // Idempotent, and a pass with nothing to move reads no further partition.
    expect(await bindChatHistoryForSync(store, DEVICE, BOUND)).toBe(0);
    expect(loads).toEqual([partitionIdOf('message', CHAT_A)]);
  });

  it('regression: messageRecordById finds a message of an unloaded chat through stubs, loading only its chat', async () => {
    const { store, loads } = await unloadedCopy(await residentStore());
    const found = await store.read((tx) => messageRecordById(tx, DEVICE, 7));
    expect(found?.payload.message.id).toBe(7);
    expect(loads).toEqual([partitionIdOf('message', CHAT_B)]);
    expect(await store.read((tx) => messageRecordById(tx, DEVICE, 99))).toBeUndefined();
    expect(loads).toHaveLength(1); // an unknown id costs no load
  });

  it('regression: touchesChatMessages loads nothing — a commit to another chat is told apart by its stub', async () => {
    const { store, loads } = await unloadedCopy(await residentStore());
    const persistence = createLocalBrainPersistence({ store, deviceId: DEVICE, summarizeUnavailable: 'local only' });
    let a = 0;
    let b = 0;
    const offA = persistence.subscribeMessages!(CHAT_A, () => { a += 1; });
    const offB = persistence.subscribeMessages!(CHAT_B, () => { b += 1; });
    await store.transact(async (tx) => { await tx.put(messageRow(CHAT_B, 8)); }); // a NEW row of chat B
    const loadedByTheCommit = loads.length;
    await settle();
    expect(b).toBeGreaterThan(0);
    expect(a).toBe(0);
    expect(loads).toHaveLength(loadedByTheCommit); // working out whose commit it was read no partition
    offA();
    offB();
  });

  it('regression: deleteChat tombstones an unloaded chat through its own partition only', async () => {
    const { store, loads } = await unloadedCopy(await residentStore());
    const persistence = createLocalBrainPersistence({ store, deviceId: DEVICE, summarizeUnavailable: 'local only' });
    await persistence.deleteChat(CHAT_A);
    expect(new Set(loads)).toEqual(new Set([partitionIdOf('message', CHAT_A)]));
    expect(await persistence.getMessages(CHAT_A)).toEqual([]);
    expect((await persistence.getMessages(CHAT_B)).map((message) => message.id)).toEqual([6, 7]);
  });

  it('regression: a pulled row of an unloaded chat is merged through its own partition only', async () => {
    const source = await residentStore([CHAT_A, CHAT_B]);
    const { store, loads } = await unloadedCopy(source);
    const current = messageRow(CHAT_B, 6, BOUND);
    const remote: LocalRecord<MessageValue> = {
      ...current, version: 2, baseVersion: 1,
      payload: { ...current.payload, message: { ...current.payload.message, content: 'edited on the server' } },
    };
    const policy = createPlatformPolicy();
    policy.set({ synchronize: true });
    let pulls = 0;
    const coordinator = createSyncCoordinator({
      store, policy, deviceId: DEVICE, lease: { run: (_owner, work) => work() },
      transport: {
        async push() { return []; },
        async pull() { pulls += 1; return pulls === 1 ? { records: [remote], cursor: 'c1' } : { records: [] }; },
      },
    });
    await coordinator.synchronize(BOUND);
    expect(loads).toEqual([partitionIdOf('message', CHAT_B)]);
    const merged = await store.read((tx) => tx.get<MessageValue>('message', 'm-6'));
    expect(merged?.payload.message.content).toBe('edited on the server');
  });
});
