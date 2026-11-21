/**
 * Regression: chat local #165961 (2026-11-21). A run's bind (`POST /api/brain/chats` → 281) and
 * the chat's sync import raced: the import was materialized while the POST was in flight, went
 * up without the `serverId` hint, and the server minted a SECOND chat (282) whose receipt
 * remapped the device — leaving 281 an empty orphan. Whatever the interleaving, the server must
 * hold ONE chat for the local chat, and the device must stay bound to it.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  createMemoryLocalFirstStore,
  createSyncCoordinator,
  type EntityDestination,
  type LocalFirstStore,
  type SyncPushBatch,
  type SyncReceipt,
  type SyncTransport,
} from '@builderforce/local-first';
import { createLocalBrainPersistence } from '../localFirstPersistence';
import { createLocalChatIdentity, type ChatBindingPort } from './chatIdentity';
import { bindChatHistoryForSync } from './chatSync';

const ACCOUNT: EntityDestination = { kind: 'bound', platformInstance: 'https://builderforce.ai', tenantId: '7' };
const DEVICE = 'device-1';

/**
 * The server's two ways a chat comes to be: `POST /api/brain/chats`, and the chat importer —
 * which adopts the chat a `serverId` hint names (`importSyncedChat.ts`) and mints one otherwise.
 */
function fakeServer() {
  const chats: number[] = [];
  let next = 281;
  const mint = (): number => { chats.push(next); return next++; };
  let offline = false;
  // A replayed event id gets its first receipt again (`syncPersist.ts` `replayReceipt`).
  const answered = new Map<string, SyncReceipt>();
  const apply = (event: SyncPushBatch['events'][number]): SyncReceipt => {
    if (event.entityType !== 'chat') return { eventId: event.eventId, status: 'accepted', serverId: String(1000 + event.localSequence), serverVersion: 1 } as SyncReceipt;
    const hint = (event.payload as { serverId?: unknown }).serverId;
    const id = typeof hint === 'number' && chats.includes(hint) ? hint : mint();
    return { eventId: event.eventId, status: 'accepted', syncId: id, serverId: String(id), serverVersion: 1 } as SyncReceipt;
  };
  const transport: SyncTransport = {
    async push(batch) {
      const receipts = batch.events.map((event) => {
        const receipt = answered.get(event.eventId) ?? apply(event);
        answered.set(event.eventId, receipt);
        return receipt;
      });
      // The batch landed; only the answer is lost.
      if (offline) throw new Error('network down');
      return receipts;
    },
    async pull() { return { records: [] }; },
  };
  return { chats, mint, transport, goOffline: (value: boolean) => { offline = value; } };
}

function setup(createServerChat: ChatBindingPort['createServerChat'], transport: SyncTransport) {
  const store: LocalFirstStore = createMemoryLocalFirstStore();
  const port: ChatBindingPort = { destination: () => ACCOUNT, allowed: () => true, createServerChat: vi.fn(createServerChat) };
  const identity = createLocalChatIdentity({ store, deviceId: DEVICE, port });
  const persistence = createLocalBrainPersistence({ store, deviceId: DEVICE, summarizeUnavailable: 'n/a', accountDestination: port.destination });
  const coordinator = createSyncCoordinator({
    store, transport, deviceId: DEVICE, policy: { assert: () => undefined } as never, lease: { run: (_owner, run) => run() },
  });
  return { store, port, identity, persistence, sync: () => coordinator.synchronize(ACCOUNT) };
}

const chatMapping = (store: LocalFirstStore, clientId: string) => store.read((tx) => tx.mapping('chat', clientId, ACCOUNT));

describe('chat bind vs. sync import (regression: chat local #165961)', () => {
  it('a sync round during the bind POST sends nothing for the chat; the import then adopts the bound chat', async () => {
    const server = fakeServer();
    let sync: () => Promise<unknown> = async () => undefined;
    const harness = setup(async () => {
      const id = server.mint();
      // A sync round runs while the POST is in flight (the real interleaving).
      await sync();
      return id;
    }, server.transport);
    sync = harness.sync;
    const chat = await harness.persistence.createChat({ title: 'x' });
    await bindChatHistoryForSync(harness.store, DEVICE, ACCOUNT);

    expect(await harness.identity.bind(chat.id)).toBe(281);
    await harness.sync();

    expect(server.chats).toEqual([281]);
    const clientId = (await harness.identity.clientIdFor(chat.id))!;
    // The receipt keeps the original id: the import adopted 281.
    expect(await chatMapping(harness.store, clientId)).toMatchObject({ syncId: 281, serverVersion: 1 });
    expect(await harness.identity.serverIdFor(chat.id)).toBe(281);
  });

  it('adopt (the host made the server chat first) holds a racing sync round back too; the import adopts that chat', async () => {
    const server = fakeServer();
    const harness = setup(async () => server.mint(), server.transport);
    const hostChat = server.mint(); // e.g. the Sessions tree opening an existing server chat
    const chat = await harness.persistence.createChat({ title: 'x' });
    await bindChatHistoryForSync(harness.store, DEVICE, ACCOUNT);
    // A sync round lands between the lease claim and the mapping commit (the adopt's window).
    const transact = harness.store.transact.bind(harness.store);
    let raced = false;
    harness.store.transact = (async (work: Parameters<LocalFirstStore['transact']>[0]) => {
      const result = await transact(work);
      if (!raced) { raced = true; await harness.sync(); }
      return result;
    }) as LocalFirstStore['transact'];

    expect(await harness.identity.adopt(chat.id, hostChat)).toBe(true);
    harness.store.transact = transact;
    await harness.sync();

    expect(raced).toBe(true);
    expect(server.chats).toEqual([hostChat]);
    expect(harness.port.createServerChat).not.toHaveBeenCalled();
    const clientId = (await harness.identity.clientIdFor(chat.id))!;
    expect(await chatMapping(harness.store, clientId)).toMatchObject({ syncId: hostChat, serverVersion: 1 });
  });

  it('adopt after the import already went up does not claim the chat: it reports false, never a mapping the receipt overwrites', async () => {
    const server = fakeServer();
    const harness = setup(async () => server.mint(), server.transport);
    const hostChat = server.mint();
    const chat = await harness.persistence.createChat({ title: 'x' });
    await bindChatHistoryForSync(harness.store, DEVICE, ACCOUNT);
    server.goOffline(true);
    await expect(harness.sync()).rejects.toThrow('network down'); // the import minted 282; answer lost
    server.goOffline(false);

    const adopted = harness.identity.adopt(chat.id, hostChat);
    await harness.sync(); // the resend's receipt
    expect(await adopted).toBe(false);
    expect(await harness.identity.serverIdFor(chat.id)).toBe(282);
    expect(harness.port.createServerChat).not.toHaveBeenCalled();
  });

  it('createChat({ bindPending }) holds the import back before adopt runs: a sync round between them sends nothing; adopt binds the one server chat', async () => {
    const server = fakeServer();
    const harness = setup(async () => server.mint(), server.transport);
    const hostChat = server.mint();
    const chat = await harness.persistence.createChat({ title: 'x', bindPending: true });
    await bindChatHistoryForSync(harness.store, DEVICE, ACCOUNT);
    await harness.sync(); // between createChat's commit and adopt's claim

    expect(server.chats).toEqual([hostChat]);
    expect(await harness.identity.adopt(chat.id, hostChat)).toBe(true);
    await harness.sync();

    expect(server.chats).toEqual([hostChat]);
    expect(harness.port.createServerChat).not.toHaveBeenCalled();
    const clientId = (await harness.identity.clientIdFor(chat.id))!;
    expect(await chatMapping(harness.store, clientId)).toMatchObject({ syncId: hostChat, serverVersion: 1 });
    expect(await harness.identity.serverIdFor(chat.id)).toBe(hostChat);
  });

  it("two windows sharing the journal: the second's bind waits for the first's binding and never POSTs", async () => {
    const server = fakeServer();
    let started!: () => void;
    const startedPost = new Promise<void>((resolve) => { started = resolve; });
    let finish!: (id: number) => void;
    const harness = setup(() => { started(); return new Promise<number>((resolve) => { finish = resolve; }); }, server.transport);
    const secondPort: ChatBindingPort = { destination: () => ACCOUNT, allowed: () => true, createServerChat: vi.fn(async () => server.mint()) };
    const second = createLocalChatIdentity({ store: harness.store, deviceId: DEVICE, port: secondPort });
    const chat = await harness.persistence.createChat({ title: 'x' });

    const first = harness.identity.bind(chat.id);
    await startedPost; // the first window's lease is claimed and its POST is in flight
    const waiting = second.bind(chat.id);
    finish(server.mint());

    expect(await first).toBe(281);
    expect(await waiting).toBe(281);
    expect(secondPort.createServerChat).not.toHaveBeenCalled();
    expect(server.chats).toEqual([281]);
  });

  it('an import already sent binds the chat through its receipt; the bind never POSTs a second chat', async () => {
    const server = fakeServer();
    const harness = setup(async () => server.mint(), server.transport);
    const chat = await harness.persistence.createChat({ title: 'x' });
    await bindChatHistoryForSync(harness.store, DEVICE, ACCOUNT);
    // The import reaches the server, its answer is lost: materialized, still pending.
    server.goOffline(true);
    await expect(harness.sync()).rejects.toThrow('network down');
    server.goOffline(false);

    const bound = harness.identity.bind(chat.id);
    await harness.sync(); // the resend's receipt lands while the bind waits
    expect(await bound).toBe(281);
    expect(harness.port.createServerChat).not.toHaveBeenCalled();
    expect(server.chats).toEqual([281]);
  });
});
