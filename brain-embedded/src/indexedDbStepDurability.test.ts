/**
 * The IndexedDB step-durability installer (web app + Chrome extension) against a real
 * IndexedDB implementation (`fake-indexeddb`): what a previous page/panel left queued is
 * drained on install, straight to its chat, as the identity it was written under — and
 * only when online and only as that identity.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedDbOutboxStore, createOnlineSignal, type OutboxEntry } from '@builderforce/write-outbox';
import { installIndexedDbStepDurability } from './indexedDbStepDurability';
import { installStepDurability, type StepOutgoingMessage } from './stepOutbox';

const DB = 'builderforce-outbox:test-steps';

/** Leave rows in a chat's queue, as a page that went away before sending them would. */
async function leaveQueued(factory: IDBFactory, chatId: number, scope: string, contents: string[]): Promise<void> {
  const store = createIndexedDbOutboxStore<StepOutgoingMessage, number>({ indexedDB: factory, dbName: DB, partition: `chat:${chatId}` });
  await store.load();
  const entries: OutboxEntry<StepOutgoingMessage, number>[] = contents.map((content, i) => ({
    id: `entry-${chatId}-${i}`,
    key: chatId,
    item: { role: 'tool', content, metadata: '{"kind":"step"}' },
    seq: i + 1,
    scope,
  }));
  await store.put(entries);
}

afterEach(() => installStepDurability(null));

describe('installIndexedDbStepDurability', () => {
  it('drains every stored chat queue on install, in order, with replay-safe event keys', async () => {
    const factory = new IDBFactory();
    await leaveQueued(factory, 7, 'tenant:1', ['a', 'b']);
    await leaveQueued(factory, 9, 'tenant:1', ['c']);
    const sent: Array<{ chatId: number; rows: StepOutgoingMessage[] }> = [];

    installIndexedDbStepDurability({
      indexedDB: factory,
      dbName: DB,
      online: createOnlineSignal(true),
      scope: () => 'tenant:1',
      sendRows: async (chatId, rows) => {
        sent.push({ chatId, rows });
      },
    });

    await vi.waitFor(() => expect(sent.flatMap((s) => s.rows)).toHaveLength(3));
    const byChat = Object.fromEntries(sent.map((s) => [s.chatId, s.rows.map((r) => r.content)]));
    expect(byChat).toEqual({ 7: ['a', 'b'], 9: ['c'] });
    expect(sent.flatMap((s) => s.rows).every((r) => r.eventKey?.startsWith('step:entry-'))).toBe(true);
  });

  it('parks rows written under another identity instead of replaying them into this one', async () => {
    const factory = new IDBFactory();
    await leaveQueued(factory, 7, 'tenant:2', ['theirs']);
    const sendRows = vi.fn(async (_chatId: number, _rows: StepOutgoingMessage[]) => undefined);

    installIndexedDbStepDurability({ indexedDB: factory, dbName: DB, online: createOnlineSignal(true), scope: () => 'tenant:1', sendRows });

    await new Promise((r) => setTimeout(r, 50));
    expect(sendRows).not.toHaveBeenCalled();
  });

  it('waits while offline and drains when the host comes back online', async () => {
    const factory = new IDBFactory();
    await leaveQueued(factory, 7, 'tenant:1', ['later']);
    const online = createOnlineSignal(false);
    const sendRows = vi.fn(async (_chatId: number, _rows: StepOutgoingMessage[]) => undefined);

    installIndexedDbStepDurability({ indexedDB: factory, dbName: DB, online, scope: () => 'tenant:1', sendRows });
    await new Promise((r) => setTimeout(r, 50));
    expect(sendRows).not.toHaveBeenCalled();

    online.set(true);
    await vi.waitFor(() => expect(sendRows).toHaveBeenCalledTimes(1));
    expect(sendRows.mock.calls[0]).toEqual([7, [expect.objectContaining({ content: 'later' })]]);
  });
});
