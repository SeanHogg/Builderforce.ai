import { createMemoryLocalFirstStore } from '@builderforce/local-first';
import { describe, expect, it } from 'vitest';
import { createLocalChatIdentity } from './localChat/chatIdentity';
import { createLocalBrainPersistence } from './localFirstPersistence';

describe('local Brain persistence', () => {
  it('keeps stable client UUIDs and run keys while committing history and journal atomically', async () => {
    const store = createMemoryLocalFirstStore();
    const persistence = createLocalBrainPersistence({ store, deviceId: 'device-a', summarizeUnavailable: 'local only' });
    const chat = await persistence.createChat({ title: 'Offline run' });
    const eventKey = `step:${crypto.randomUUID()}`;
    const saved = await persistence.sendMessages(chat.id, [
      { role: 'user', content: 'Build offline' },
      { role: 'tool', content: '', metadata: '{"kind":"step"}', eventKey },
    ]);
    const snapshot = await store.export();
    const chatRecord = snapshot.records.find((record) => record.entityType === 'chat');
    expect(chatRecord?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(chatRecord?.payload).toMatchObject({ chat: { id: chat.id } });
    expect(snapshot.events.map((event) => event.idempotencyKey)).toContain(eventKey);
    expect(saved.map((message) => message.seq)).toEqual([1, 2]);
    expect(await persistence.getMessages(chat.id)).toHaveLength(2);
  });

  it('uses explicit tombstones for history deletion', async () => {
    const store = createMemoryLocalFirstStore();
    const persistence = createLocalBrainPersistence({ store, deviceId: 'device-a', summarizeUnavailable: 'local only' });
    const chat = await persistence.createChat({ title: 'Delete me' });
    await persistence.sendMessages(chat.id, [{ role: 'user', content: 'retain as a tombstone' }]);
    await persistence.deleteChat(chat.id);
    const snapshot = await store.export();
    expect(snapshot.records.filter((record) => record.deletedAt)).toHaveLength(2);
    expect(snapshot.events.some((event) => event.operation === 'delete')).toBe(true);
    expect(await persistence.listChats()).toEqual([]);
  });

  // Archive must NOT be delete. `deleteChat` tombstones the row (and its messages),
  // which throws away the conversation's summary — the whole point of archiving.
  // Archiving marks the chat and hides it from the list, and keeps every record.
  it('archives a chat without tombstoning it, and hides it from the list', async () => {
    const store = createMemoryLocalFirstStore();
    const persistence = createLocalBrainPersistence({ store, deviceId: 'device-a', summarizeUnavailable: 'local only' });
    const chat = await persistence.createChat({ title: 'Keep me' });
    await persistence.sendMessages(chat.id, [{ role: 'user', content: 'still here after archive' }]);

    const result = await persistence.archiveChat(chat.id);

    expect(result).toEqual({ archived: true });
    expect(await persistence.listChats()).toEqual([]);
    const snapshot = await store.export();
    expect(snapshot.records.filter((record) => record.deletedAt)).toHaveLength(0);
    const kept = snapshot.records.find((record) => record.entityType === 'chat');
    expect(kept?.payload).toMatchObject({ chat: { id: chat.id, isArchived: true } });
    expect(snapshot.events.some((event) => event.operation === 'delete')).toBe(false);
    // The transcript survives, so a later recall of the summary still has its source.
    expect(await persistence.getMessages(chat.id)).toHaveLength(1);
  });

  // Offline (or a slow platform), the platform spend read can block for its whole
  // timeout. `listChats` must answer from local state at once — never awaiting the
  // async `serverSpend` port. The chat here IS bound (a server id), so `project` has a
  // bound id to ask about: the cache misses, the port is invoked, and `listChats` must
  // still resolve immediately (the port's promise never settles — an offline read).
  it('listChats returns instantly while the serverSpend port never resolves', async () => {
    const store = createMemoryLocalFirstStore();
    const account: import('@builderforce/local-first').EntityDestination = { kind: 'bound', platformInstance: 'https://example.test', tenantId: '1' };
    let spendCalled = false;
    const persistence = createLocalBrainPersistence({
      store,
      deviceId: 'device-a',
      summarizeUnavailable: 'local only',
      accountDestination: () => account,
      // No `serverSpendSync` cache: a bound projection misses and must fire-and-forget.
      serverSpend: (_ids: readonly number[]): Promise<ReadonlyMap<number, never>> => {
        spendCalled = true;
        return new Promise(() => undefined); // offline: hangs forever
      },
    });
    const chat = await persistence.createChat({ title: 'Offline list' });

    // Bind the local chat to a server chat, so the projection has a bound id to ask the
    // platform about (the real offline path: a bound chat whose spend read blocks).
    const identity = createLocalChatIdentity({ store, deviceId: 'device-a', port: { destination: () => account, allowed: () => true, createServerChat: async () => 321 } });
    await identity.adopt(chat.id, 321);

    // If `project` awaited `serverSpend`, this would hang for the port's whole timeout.
    // It must resolve immediately even though the port was invoked and never settles.
    const list = await persistence.listChats();

    expect(list.map((c) => c.id)).toEqual([chat.id]);
    expect(spendCalled).toBe(true); // bound chat: the port was asked, but never awaited
  });
});

describe('local Brain persistence - a row sent again under its key is the same row', () => {
  it('returns the saved message and writes nothing new', async () => {
    const store = createMemoryLocalFirstStore();
    const persistence = createLocalBrainPersistence({ store, deviceId: 'device-a', summarizeUnavailable: 'local only' });
    const chat = await persistence.createChat({ title: 'Keyed' });
    const eventKey = `steer:${crypto.randomUUID()}`;

    const [first] = await persistence.sendMessages(chat.id, [{ role: 'user', content: 'said once', eventKey }]);
    const [again] = await persistence.sendMessages(chat.id, [{ role: 'user', content: 'said once', eventKey }]);

    expect(again?.id).toBe(first?.id);
    expect(await persistence.getMessages(chat.id)).toHaveLength(1);
  });
});
