import { describe, expect, it } from 'vitest';
import {
  BOUND_ONLY_VERSION,
  CHAT_BIND_LEASE_MS,
  claimChatBind,
  createMemoryLocalFirstStore,
  liveChatBindHolder,
  newLocalRecord,
  queueImport,
  releaseChatBind,
  type EntityDestination,
  type MemoryLocalFirstStore,
} from './index.js';
import { materializeRound, pickRound } from './syncRound.js';

const BOUND: EntityDestination = { kind: 'bound', platformInstance: 'https://example.test', tenantId: '1' };
const CHAT = '00000000-0000-4000-8000-000000000001';
const MESSAGE = '00000000-0000-4000-8000-000000000002';
const LIMITS = { maxEvents: 100, maxBytes: 10 * 1024 * 1024 };

/** A bound chat with one message, both queued as imports (the message waits on the chat's). */
async function queued(): Promise<MemoryLocalFirstStore> {
  const store = createMemoryLocalFirstStore();
  await store.transact(async (tx) => {
    const chat = { ...newLocalRecord({ id: CHAT, entityType: 'chat', payload: { clientId: CHAT, chat: { id: 1, title: 't' } }, deviceId: 'd' }), destination: BOUND };
    await tx.put(chat);
    await queueImport(tx, chat);
    const message = { ...newLocalRecord({ id: MESSAGE, entityType: 'message', payload: { chatClientId: CHAT }, deviceId: 'd' }), destination: BOUND };
    await tx.put(message);
    await queueImport(tx, message, CHAT);
  });
  return store;
}

const pick = (store: MemoryLocalFirstStore, at = Date.now()) => store.read((tx) => pickRound(tx, BOUND, { ...LIMITS, at }));
const round = async (store: MemoryLocalFirstStore, at = Date.now()) => {
  const picked = await pick(store, at);
  return store.transact((tx) => materializeRound(tx, picked.batch, LIMITS.maxBytes, at));
};

describe('chat bind lease (regression: chat local #165961 — bind + import minted two server chats)', () => {
  it('a claimed bind keeps the chat import back; after the bind mapping it goes up naming the bound chat', async () => {
    const store = await queued();
    expect(await store.transact((tx) => claimChatBind(tx, CHAT, new Date()))).toBe(true);
    // Neither the chat import nor the message waiting on it is picked while the POST is in flight.
    expect((await pick(store)).batch).toEqual([]);

    // The bind's commit: its bind-only mapping and the release, together.
    await store.transact(async (tx) => {
      await tx.putMapping({ destination: BOUND, entityType: 'chat', clientEntityId: CHAT, syncId: 281, serverVersion: BOUND_ONLY_VERSION });
      await releaseChatBind(tx, CHAT);
    });
    const { batch } = await round(store);
    const chatImport = batch.find((event) => event.entityType === 'chat');
    expect(chatImport?.operation).toBe('import');
    // The hint the server adopts: ONE server chat, and its receipt keeps 281.
    expect((chatImport?.payload as { serverId?: number }).serverId).toBe(281);
    expect(batch.map((event) => event.entityType)).toEqual(['chat', 'message']);
  });

  it('a bind claimed between the pick and the materialize still holds the import back', async () => {
    const store = await queued();
    const picked = await pick(store);
    expect(picked.batch.map((event) => event.entityType)).toEqual(['chat', 'message']);
    await store.transact((tx) => claimChatBind(tx, CHAT, new Date()));
    const { batch } = await store.transact((tx) => materializeRound(tx, picked.batch, LIMITS.maxBytes));
    expect(batch).toEqual([]);
    // Still a marker: nothing was frozen without the hint.
    const pending = await store.read((tx) => tx.pending(BOUND));
    expect(pending.find((event) => event.entityType === 'chat')?.materializedAt).toBeUndefined();
  });

  it('refuses the claim once the chat import is materialized: that import makes the server chat', async () => {
    const store = await queued();
    await round(store); // materialized and committed — it may be on the server now
    expect(await store.transact((tx) => claimChatBind(tx, CHAT, new Date()))).toBe(false);
    expect(await store.read((tx) => tx.readMark(`chatBind:${CHAT}`))).toBeUndefined();
  });

  it("a claim against another holder's live lease is refused; the same holder, an expired lease, and a holderless claim succeed", async () => {
    const store = await queued();
    const now = new Date();
    expect(await store.transact((tx) => claimChatBind(tx, CHAT, now, 'window-a'))).toBe(true);
    expect(await store.transact((tx) => claimChatBind(tx, CHAT, now, 'window-b'))).toBe(false);
    expect(await store.transact((tx) => liveChatBindHolder(tx, CHAT, now))).toBe('window-a');
    expect(await store.transact((tx) => claimChatBind(tx, CHAT, now, 'window-a'))).toBe(true);
    // B releasing does not drop A's lease; A's release does.
    await store.transact((tx) => releaseChatBind(tx, CHAT, 'window-b'));
    expect(await store.transact((tx) => liveChatBindHolder(tx, CHAT, now))).toBe('window-a');
    // The lease expired: another window may claim.
    const later = new Date(now.getTime() + CHAT_BIND_LEASE_MS + 1);
    expect(await store.transact((tx) => claimChatBind(tx, CHAT, later, 'window-b'))).toBe(true);
    await store.transact((tx) => releaseChatBind(tx, CHAT, 'window-b'));
    expect(await store.read((tx) => tx.readMark(`chatBind:${CHAT}`))).toBeUndefined();
    // A holderless claim (legacy caller) takes a live lease as before.
    await store.transact((tx) => claimChatBind(tx, CHAT, now, 'window-a'));
    expect(await store.transact((tx) => claimChatBind(tx, CHAT, now))).toBe(true);
  });

  it('a holder-stamped lease still holds the import back', async () => {
    const store = await queued();
    await store.transact((tx) => claimChatBind(tx, CHAT, new Date(), 'window-a'));
    expect((await pick(store)).batch).toEqual([]);
  });

  it('an expired lease (a window that died mid-bind) does not park the import', async () => {
    const store = await queued();
    await store.transact((tx) => claimChatBind(tx, CHAT, new Date(Date.now() - CHAT_BIND_LEASE_MS - 1)));
    expect((await pick(store)).batch.map((event) => event.entityType)).toEqual(['chat', 'message']);
  });
});
