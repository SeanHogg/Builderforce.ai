/**
 * PRD 36 — the local chat's identity (bind on sign-in), its run usage ledger (spend on
 * the device), and sync on enable (the chat's history handed to the account once).
 */

import { describe, expect, it, vi } from 'vitest';
import { createMemoryLocalFirstStore, type EntityDestination } from '@builderforce/local-first';
import { priceBookFromPrices } from '@builderforce/model-catalog';
import { combineSpendSavings, foldSpendSavings } from '@builderforce/spend-contract';
import { createLocalBrainPersistence } from '../localFirstPersistence';
import { createLocalChatIdentity, type ChatBindingPort } from './chatIdentity';
import { bindChatHistoryForSync } from './chatSync';
import { createRunUsageLedger, ledgerSpend, usageRouteOf, type RunUsageValue } from './usageLedger';

const ACCOUNT: EntityDestination = { kind: 'bound', platformInstance: 'https://builderforce.ai', tenantId: '7' };
const DEVICE = 'device-1';
/** $1 / $2 per million tokens, so figures are easy to read. */
const BOOK = priceBookFromPrices([
  ['openai/gpt-x', { input: 1e-6, output: 2e-6 }],
  ['anthropic/claude-sonnet-5.5', { input: 3e-6, output: 15e-6 }],
]);

function setup(port: Partial<ChatBindingPort> = {}) {
  const store = createMemoryLocalFirstStore();
  const binding: ChatBindingPort = {
    destination: () => ACCOUNT,
    allowed: () => true,
    createServerChat: vi.fn(async () => 4242),
    ...port,
  };
  const identity = createLocalChatIdentity({ store, deviceId: DEVICE, port: binding });
  const persistence = createLocalBrainPersistence({
    store, deviceId: DEVICE, summarizeUnavailable: 'n/a', accountDestination: binding.destination, priceBook: () => BOOK,
  });
  const ledger = createRunUsageLedger({ store, deviceId: DEVICE, book: () => BOOK });
  return { store, binding, identity, persistence, ledger };
}

describe('chat identity — bind on sign-in', () => {
  it('binds once: the server chat is created, mapped, and projected as serverId', async () => {
    const { binding, identity, persistence } = setup();
    const chat = await persistence.createChat({ title: 'Fix login', projectId: 3 });
    expect(chat.serverId).toBeUndefined();
    expect(await identity.bind(chat.id)).toBe(4242);
    expect(await identity.bind(chat.id)).toBe(4242);
    expect(binding.createServerChat).toHaveBeenCalledTimes(1);
    expect(binding.createServerChat).toHaveBeenCalledWith({ title: 'Fix login', projectId: 3 });
    expect((await persistence.getChat(chat.id)).serverId).toBe(4242);
  });

  it('concurrent binds share one request', async () => {
    const { binding, identity, persistence } = setup();
    const chat = await persistence.createChat({ title: 'x' });
    await Promise.all([identity.bind(chat.id), identity.bind(chat.id), identity.bind(chat.id)]);
    expect(binding.createServerChat).toHaveBeenCalledTimes(1);
  });

  it('signed out, or not allowed: nothing is sent and the chat stays local', async () => {
    for (const port of [{ destination: () => undefined }, { allowed: () => false }]) {
      const { binding, identity, persistence } = setup(port);
      const chat = await persistence.createChat({ title: 'x' });
      expect(await identity.bind(chat.id)).toBeUndefined();
      expect(binding.createServerChat).not.toHaveBeenCalled();
    }
  });

  it('a binding belongs to its workspace: another account does not see it', async () => {
    let account: EntityDestination = ACCOUNT;
    const { identity, persistence } = setup({ destination: () => account });
    const chat = await persistence.createChat({ title: 'x' });
    await identity.bind(chat.id);
    account = { kind: 'bound', platformInstance: 'https://builderforce.ai', tenantId: '8' };
    expect(await identity.serverIdFor(chat.id)).toBeUndefined();
  });
});

describe('run usage ledger — spend on the device', () => {
  it('names the route a call ran on', () => {
    expect(usageRouteOf({ resolvedModel: 'openai/gpt-x' })).toBe('gateway');
    expect(usageRouteOf({ resolvedModel: 'local/ollama/qwen3:8b' })).toBe('local');
    expect(usageRouteOf({ resolvedModel: 'direct/minimax/MiniMax-M2.7' })).toBe('byo-direct');
    expect(usageRouteOf({ localFirst: [{ target: 'local/bfi/q', outcome: 'served' }] })).toBe('local');
  });

  it('an unbound chat shows its gateway spend as an estimate, and a local call as $0 + saved', async () => {
    const { ledger, persistence } = setup({ destination: () => undefined });
    const chat = await persistence.createChat({ title: 'x' });
    await ledger.record({ chatId: chat.id, runKey: chat.id, model: 'openai/gpt-x', route: 'gateway', usage: { prompt: 1_000_000, completion: 500_000 } });
    await ledger.record({ chatId: chat.id, runKey: chat.id, model: 'local/ollama/q', route: 'local', usage: { prompt: 1_000_000, completion: 0 } });
    const { spend } = await persistence.getChat(chat.id);
    // gateway: $1 + $1; local: $0 spent, valued at the chat's paid route ($1/M input).
    expect(spend?.spend.totalUsd).toBeCloseTo(2);
    expect(spend?.spend.estimated).toBe(true);
    expect(spend?.spend.unpricedTokens).toBe(0);
    const local = spend?.saved.bySource.find((s) => s.source === 'local_model');
    expect(local?.usd).toBeCloseTo(1);
    expect(local?.estimated).toBe(true);
  });

  it('a gateway call is never journaled for sync; a local call is', async () => {
    const { ledger, persistence, store } = setup({ destination: () => undefined });
    const chat = await persistence.createChat({ title: 'x' });
    await ledger.record({ chatId: chat.id, runKey: 1, model: 'openai/gpt-x', route: 'gateway', usage: { prompt: 10, completion: 10 } });
    await ledger.record({ chatId: chat.id, runKey: 1, model: 'local/ollama/q', route: 'local', usage: { prompt: 10, completion: 10 } });
    const usageEvents = (await store.read((tx) => tx.pending())).filter((e) => e.entityType === 'usage');
    expect(usageEvents).toHaveLength(1);
    expect((usageEvents[0]!.payload as RunUsageValue).route).toBe('local');
  });

  it('a bound chat adds the platform figure for gateway calls to the device figure for the rest — no double count', () => {
    const rows: RunUsageValue[] = [
      { clientEventId: 'a', clientChatId: 'c', runKey: 1, model: 'openai/gpt-x', route: 'gateway', promptTokens: 1_000_000, completionTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, at: '2026-10-24T00:00:00Z' },
      { clientEventId: 'b', clientChatId: 'c', runKey: 1, model: 'local/ollama/q', route: 'local', promptTokens: 100, completionTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, savingsSource: 'local_model', savedPrompt: 100, savedCompletion: 0, savedCostMc: 50, at: '2026-10-24T00:00:01Z' },
    ];
    const server = foldSpendSavings([{ model: 'openai/gpt-x', byo: false, savingsSource: null, savingsEstimated: false, prompt: 1_000_000, completion: 0, cacheRead: 0, cacheCreation: 0, total: 1_000_000, costMc: 100_000, calls: 1, cacheCalls: 0, savedPrompt: 0, savedCompletion: 0, recallPrompt: 0, savedCostMc: 0, trimCalls: 0, recallCalls: 0, rows: 1 }], BOOK);
    const local = ledgerSpend(rows, { excludeGateway: true, book: BOOK })!;
    const both = combineSpendSavings(server, local);
    expect(both.spend.totalUsd).toBeCloseTo(1);
    expect(both.spend.requests).toBe(2);
    expect(both.spend.estimated).toBeUndefined();
    expect(both.saved.bySource.find((s) => s.source === 'local_model')?.usd).toBeCloseTo(0.0005);
  });
});

describe('sync on enable — the chat history goes to the account once', () => {
  it('moves offline chats, messages and local usage into the account as one import each', async () => {
    const { persistence, ledger, store } = setup({ destination: () => undefined });
    const chat = await persistence.createChat({ title: 'Offline work' });
    await persistence.sendMessages(chat.id, [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }]);
    await persistence.updateChat(chat.id, { title: 'Renamed offline' });
    await ledger.record({ chatId: chat.id, runKey: 1, model: 'local/ollama/q', route: 'local', usage: { prompt: 5, completion: 5 } });
    await ledger.record({ chatId: chat.id, runKey: 1, model: 'openai/gpt-x', route: 'gateway', usage: { prompt: 5, completion: 5 } });

    expect(await bindChatHistoryForSync(store, DEVICE, ACCOUNT)).toBe(1);
    const pending = await store.read((tx) => tx.pending());
    expect(pending.every((e) => e.destination.kind === 'bound')).toBe(true);
    expect(pending.every((e) => e.operation === 'import')).toBe(true);
    expect(pending.map((e) => e.entityType).sort()).toEqual(['chat', 'message', 'message', 'usage']);
    // The chat's import carries its CURRENT state, not a replay of its edits.
    const chatImport = pending.find((e) => e.entityType === 'chat')!;
    expect((chatImport.payload as { chat: { title: string } }).chat.title).toBe('Renamed offline');
    // Every message and usage import waits on the chat's.
    for (const event of pending.filter((e) => e.entityType !== 'chat')) expect(event.dependsOn).toEqual([chatImport.eventId]);
  });

  it('a chat bound by sign-in imports naming its server chat, so the server adopts it', async () => {
    const { persistence, identity, store } = setup();
    const chat = await persistence.createChat({ title: 'x' });
    await identity.bind(chat.id);
    await bindChatHistoryForSync(store, DEVICE, ACCOUNT);
    const chatImport = (await store.read((tx) => tx.pending())).find((e) => e.entityType === 'chat')!;
    expect((chatImport.payload as { serverId?: number }).serverId).toBe(4242);
  });

  it('a second pass finds nothing and writes nothing', async () => {
    const { persistence, store } = setup({ destination: () => undefined });
    await persistence.createChat({ title: 'x' });
    await bindChatHistoryForSync(store, DEVICE, ACCOUNT);
    const notified = vi.fn();
    store.subscribe(notified);
    expect(await bindChatHistoryForSync(store, DEVICE, ACCOUNT)).toBe(0);
    expect(notified).not.toHaveBeenCalled();
  });

  it('after the server imported a chat, a rename is an update on the version it holds', async () => {
    const { persistence, store } = setup({ destination: () => undefined });
    const chat = await persistence.createChat({ title: 'x' });
    await bindChatHistoryForSync(store, DEVICE, ACCOUNT);
    const clientId = (await store.read((tx) => tx.list('chat')))[0]!.id;
    // The sync receipt's mapping, as the coordinator writes it.
    await store.transact(async (tx) => {
      await tx.acknowledge((await tx.pending()).map((e) => e.eventId));
      await tx.putMapping({ destination: ACCOUNT, entityType: 'chat', clientEntityId: clientId, serverId: '4242', serverVersion: 1 });
    });
    await persistence.updateChat(chat.id, { title: 'Renamed' });
    const [update] = await store.read((tx) => tx.pending());
    expect(update?.operation).toBe('update');
    expect(update?.baseVersion).toBe(1);
    expect(update?.destination).toEqual(ACCOUNT);
  });
});
