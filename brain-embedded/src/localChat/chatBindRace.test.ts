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
