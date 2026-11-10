import { describe, expect, it } from 'vitest';
import { createMemoryLocalFirstStore, newLocalRecord, type EntityDestination, type LocalFirstTransaction } from '@builderforce/local-first';
import { bindChatHistoryForSync } from './chatSync';

const BOUND: EntityDestination = { kind: 'bound', platformInstance: 'https://example.test', tenantId: '1' };
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const marker = (tx: LocalFirstTransaction, entityType: 'chat' | 'message' | 'usage', id: string, payload: unknown = null) => tx.append({
  idempotencyKey: `${entityType}:${id}`, clientEntityId: id, entityType, operation: 'create', schemaVersion: 1,
  occurredAt: '2026-01-01T00:00:00.000Z', dependsOn: [], destination: { kind: 'unbound' }, payload,
});

describe('bindChatHistoryForSync on a long offline history', () => {
  it('binds in bounded commits, replaces every offline event, and retires a gateway row\'s events', async () => {
    let commits = 0;
    const store = createMemoryLocalFirstStore(undefined, { onCommit: async () => { commits += 1; } });
    const chatId = uuid(0);
    const messages = 2_500;
    await store.transact(async (tx) => {
      await tx.put(newLocalRecord({ id: chatId, entityType: 'chat', payload: { clientId: chatId, chat: { id: 1, title: 't' } }, deviceId: 'd1' }));
      await marker(tx, 'chat', chatId);
      for (let n = 1; n <= messages; n += 1) {
        const id = uuid(n);
        await tx.put(newLocalRecord({ id, entityType: 'message', payload: { clientId: id, chatId: 1, chatClientId: chatId, eventKey: `k${n}`, message: { id: n } }, deviceId: 'd1' }));
        await marker(tx, 'message', id);
      }
      // A gateway call journaled by an older build (payload copy): never sent, so it must not stay pending.
      const usageId = uuid(99_999);
      const usage = { clientEventId: usageId, clientChatId: chatId, runKey: 1, model: 'openai/x', route: 'gateway', promptTokens: 1, completionTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, at: '2026-01-01T00:00:00Z' };
      await tx.put(newLocalRecord({ id: usageId, entityType: 'usage', payload: usage, deviceId: 'd1' }));
      await marker(tx, 'usage', usageId, usage);
    });
    commits = 0;

    expect(await bindChatHistoryForSync(store, 'd1', BOUND)).toBe(1);

    // Chats, then the messages 1000 rows per commit, then usage: never one commit of the whole history.
    expect(commits).toBeGreaterThanOrEqual(1 + Math.ceil(messages / 1000) + 1);
    const { records, events } = store.view();
    expect(records.every((record) => record.destination.kind === 'bound')).toBe(true);
    expect(events.filter((event) => event.destination.kind === 'unbound')).toEqual([]);
    expect(events.filter((event) => event.entityType === 'usage')).toEqual([]);
    expect(events.filter((event) => event.entityType === 'message' && event.operation === 'import')).toHaveLength(messages);
    // Idempotent: nothing left unbound, nothing written.
    commits = 0;
    expect(await bindChatHistoryForSync(store, 'd1', BOUND)).toBe(0);
    expect(commits).toBe(0);
  });
});
