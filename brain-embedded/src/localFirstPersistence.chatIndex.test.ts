import {
  createMemoryLocalFirstStore,
  newLocalRecord,
  resetDeltaOf,
  type LocalFirstDelta,
  type LocalFirstStore,
  type LocalFirstTransaction,
  type LocalRecord,
} from '@builderforce/local-first';
import { describe, expect, it } from 'vitest';
import { createLocalBrainPersistence } from './localFirstPersistence';
import type { ChatValue, MessageValue } from './localChat/records';
import type { BrainMessage } from './types';

const DEVICE = 'device-a';
const persistenceOver = (store: LocalFirstStore) => createLocalBrainPersistence({ store, deviceId: DEVICE, summarizeUnavailable: 'local only' });

/** The read the index replaced: every message row walked, this chat's kept, in `seq` order. */
const scannedMessages = (store: LocalFirstStore, chatId: number): Promise<BrainMessage[]> => store.read(async (tx) => {
  const rows: LocalRecord<MessageValue>[] = [];
  await tx.scan<MessageValue>('message', (row) => {
    if (!row.deletedAt && row.payload.chatId === chatId) rows.push(structuredClone(row) as LocalRecord<MessageValue>);
  });
  return rows.sort((a, b) => a.payload.message.seq - b.payload.message.seq).map((row) => row.payload.message);
});

/**
 * A store of `chats` chats with `perChat` messages each, written as committed rows (the shape
 * `sendMessages` writes) — 50k rows in one snapshot, without 50k transactions.
 */
function generatedStore(chats: number, perChat: number) {
  const records: LocalRecord[] = [];
  let id = 1;
  for (let c = 1; c <= chats; c += 1) {
    const chatId = id++;
    const clientId = `chat-${c}`;
    const at = '2026-11-10T00:00:00.000Z';
    records.push(newLocalRecord<ChatValue>({
      id: clientId, entityType: 'chat', deviceId: DEVICE, occurredAt: at,
      payload: { clientId, chat: { id: chatId, title: `Chat ${c}`, projectId: null, origin: 'local', createdAt: at, updatedAt: at } as ChatValue['chat'] },
    }));
    for (let m = perChat; m >= 1; m -= 1) { // written out of seq order: the read must sort
      const messageClientId = `m-${c}-${m}`;
      records.push(newLocalRecord<MessageValue>({
        id: messageClientId, entityType: 'message', deviceId: DEVICE, occurredAt: at,
        payload: {
          clientId: messageClientId, chatId, chatClientId: clientId, eventKey: `message:${messageClientId}`,
          message: { id: id + m, role: m % 2 ? 'user' : 'assistant', content: `chat ${c} turn ${m}`, metadata: null, seq: m, createdAt: at },
        },
      }));
    }
    id += perChat + 1;
  }
  return { store: createMemoryLocalFirstStore({ records }), chatIds: records.filter((r) => r.entityType === 'chat').map((r) => (r.payload as ChatValue).chat.id) };
}

/**
 * A store whose transactions COUNT the message rows they hand to a visitor, by path: a full
 * `scan('message')` versus an index group. What "reading one chat touches only that chat's
 * rows" means, measured without a clock.
 */
function countingStore(inner: LocalFirstStore) {
  const visited = { scan: 0, index: 0, usageScan: 0 };
  const wrap = (tx: LocalFirstTransaction): LocalFirstTransaction => new Proxy(tx, {
    get(target, prop, receiver) {
      if (prop === 'scan') {
        return (type: Parameters<LocalFirstTransaction['scan']>[0], visit: Parameters<LocalFirstTransaction['scan']>[1]) =>
          target.scan(type, (row) => {
            if (type === 'message' || type === undefined) visited.scan += 1;
            if (type === 'usage') visited.usageScan += 1;
            return visit(row);
          });
      }
      if (prop === 'scanIndex' && target.scanIndex) {
        const scanIndex = target.scanIndex.bind(target);
        return (index: Parameters<NonNullable<LocalFirstTransaction['scanIndex']>>[0], key: string | number, visit: Parameters<LocalFirstTransaction['scan']>[1]) =>
          scanIndex(index, key, (row) => { visited.index += 1; return visit(row); });
      }
      const value = Reflect.get(target, prop, receiver) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
  const store: LocalFirstStore = {
    read: (work) => inner.read((tx) => work(wrap(tx))),
    transact: (work) => inner.transact((tx) => work(wrap(tx))),
    export: () => inner.export(),
    subscribe: (listener) => inner.subscribe(listener),
  };
  return { store, visited };
}

describe('local Brain persistence — messages by chat through the chat index', () => {
  it('returns exactly what the old full scan returned, for every chat of a generated store', async () => {
    const { store, chatIds } = generatedStore(12, 40);
    const persistence = persistenceOver(store);
    // Live writes on top of the committed rows: appends, a feedback update, a deleted chat.
    await persistence.sendMessages(chatIds[0]!, [{ role: 'user', content: 'appended' }, { role: 'assistant', content: 'reply' }]);
    const [someMessage] = await persistence.getMessages(chatIds[1]!);
    await persistence.setMessageFeedback(someMessage!.id, 'up');
    await persistence.deleteChat(chatIds[2]!);
    for (const chatId of [...chatIds, 999_999]) {
      expect(await persistence.getMessages(chatId)).toEqual(await scannedMessages(store, chatId));
      expect(await persistence.getMessages(chatId, 5)).toEqual((await scannedMessages(store, chatId)).slice(-5));
    }
    expect(await persistence.getMessages(chatIds[2]!)).toEqual([]);
    expect(JSON.parse((await persistence.getMessages(chatIds[1]!))[0]!.metadata ?? '{}')).toMatchObject({ feedback: 'up' });
  });

  it('batch-reads several chats in one store read, each as getMessages returns it', async () => {
    const { store, chatIds } = generatedStore(6, 10);
    const persistence = persistenceOver(store);
    let reads = 0;
    const counted: LocalFirstStore = { ...store, read: (work) => { reads += 1; return store.read(work); } };
    const batch = await persistenceOver(counted).getMessagesForChats!([chatIds[0]!, chatIds[3]!, chatIds[3]!, 424242]);
    expect(reads).toBe(1);
    expect([...batch.keys()]).toEqual([chatIds[0], chatIds[3], 424242]);
    expect(batch.get(chatIds[0]!)).toEqual(await persistence.getMessages(chatIds[0]!));
    expect(batch.get(chatIds[3]!)).toEqual(await persistence.getMessages(chatIds[3]!));
    expect(batch.get(424242)).toEqual([]);
  });

  it('hands back caller-owned messages: mutating one never reaches the store', async () => {
    const { store, chatIds } = generatedStore(1, 3);
    const persistence = persistenceOver(store);
    const [first] = await persistence.getMessages(chatIds[0]!);
    first!.content = 'mutated';
    expect((await persistence.getMessages(chatIds[0]!))[0]!.content).not.toBe('mutated');
  });

  it('follows another window\'s commits and a reload, as the VSIX host applies them', async () => {
    // Window A writes; window B (its own memory store) folds A's frames in, then reloads whole.
    const frames: LocalFirstDelta[] = [];
    const a = createMemoryLocalFirstStore(undefined, { onCommit: async (delta) => { frames.push(delta); } });
    const b = createMemoryLocalFirstStore();
    const inA = persistenceOver(a);
    const inB = persistenceOver(b);
    const chat = await inA.createChat({ title: 'Shared' });
    await inA.sendMessages(chat.id, [{ role: 'user', content: 'one' }]);
    for (const delta of frames.splice(0)) b.applyDelta(delta);
    expect((await inB.getMessages(chat.id)).map((m) => m.content)).toEqual(['one']); // B's index is built now
    await inA.sendMessages(chat.id, [{ role: 'assistant', content: 'two' }]);
    const other = await inA.createChat({ title: 'Other' });
    await inA.sendMessages(other.id, [{ role: 'user', content: 'three' }]);
    await inA.deleteChat(chat.id);
    for (const delta of frames.splice(0)) b.applyDelta(delta);
    expect(await inB.getMessages(chat.id)).toEqual([]);
    expect((await inB.getMessages(other.id)).map((m) => m.content)).toEqual(['three']);
    b.applyDelta(resetDeltaOf(await a.export()));
    expect(await inB.getMessages(other.id)).toEqual(await inA.getMessages(other.id));
  });

  // regression: one chat's read walked every message row of every chat (75k rows on a real store, 0.2–0.8 s a read).
  it('reads one chat of a 50k-row store touching only that chat\'s rows', async () => {
    const { store, chatIds } = generatedStore(100, 500);
    const { store: counting, visited } = countingStore(store);
    const persistence = persistenceOver(counting);
    const messages = await persistence.getMessages(chatIds[42]!);
    expect(messages).toHaveLength(500);
    expect(visited).toEqual({ scan: 0, index: 500, usageScan: 0 });
    visited.index = 0;
    const batch = await persistence.getMessagesForChats!([chatIds[1]!, chatIds[2]!]);
    expect([...batch.values()].map((rows) => rows.length)).toEqual([500, 500]);
    expect(visited).toEqual({ scan: 0, index: 1000, usageScan: 0 });
    // A rating names its chat: the row is found in that chat's group, not by walking every message.
    visited.index = 0;
    await persistence.setMessageFeedback(messages[3]!.id, 'down', { chatId: chatIds[42]! });
    expect(visited).toEqual({ scan: 0, index: 500, usageScan: 0 });
    expect(JSON.parse((await persistence.getMessages(chatIds[42]!))[3]!.metadata ?? '{}')).toMatchObject({ feedback: 'down' });
    // A chat list page reads its chats' ledger rows through the usage index, never the whole ledger.
    visited.index = 0;
    await persistence.listChats({ limit: 5 });
    expect(visited.usageScan).toBe(0);
    // An append reads only its chat's rows too (it numbers the new row after them).
    visited.index = 0;
    await persistence.sendMessages(chatIds[7]!, [{ role: 'user', content: 'next' }]);
    expect(visited.index).toBe(500);
  });

  it('finds a rated message without its chat (or under a wrong one) by one stopping walk', async () => {
    const { store, chatIds } = generatedStore(3, 4);
    const persistence = persistenceOver(store);
    const [target] = await persistence.getMessages(chatIds[2]!);
    await persistence.setMessageFeedback(target!.id, 'up');
    expect(JSON.parse((await persistence.getMessages(chatIds[2]!))[0]!.metadata ?? '{}')).toMatchObject({ feedback: 'up' });
    // A wrong chat id falls back to the walk instead of losing the rating.
    await persistence.setMessageFeedback(target!.id, 'down', { chatId: chatIds[0]! });
    expect(JSON.parse((await persistence.getMessages(chatIds[2]!))[0]!.metadata ?? '{}')).toMatchObject({ feedback: 'down' });
  });
});
