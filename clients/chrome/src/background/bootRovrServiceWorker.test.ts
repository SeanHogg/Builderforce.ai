/**
 * Denied-network boot of the Rovr service worker.
 * One durable write, a simulated restart against the same IndexedDB, one local batch replay,
 * and zero platform fetches. The store is the real write-outbox IndexedDB adapter over a
 * small in-process IDB double — not a stubbed pass.
 */
import { readFileSync } from 'node:fs';
import { createIndexedDbOutboxStore } from '@builderforce/write-outbox';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SYNC_OUTBOX_DB } from '../config';
import { createMemoryKeyValue } from '../platform/keyValue';
import { bootRovrServiceWorker, ROVR_REPLAY_PARTITION, type RovrReplayReceipt, type RovrServiceWorkerBoot } from './serviceWorker';
import type { SyncItem } from '../sync/chatSync';

interface StoreMap {
  version: number;
  stores: Map<string, Map<IDBValidKey, unknown>>;
}

function createRestartableIndexedDb(): IDBFactory {
  const databases = new Map<string, StoreMap>();

  function database(record: StoreMap): IDBDatabase {
    return {
      objectStoreNames: { contains: (name: string) => record.stores.has(name) },
      createObjectStore(name: string) {
        if (!record.stores.has(name)) record.stores.set(name, new Map());
        return {} as IDBObjectStore;
      },
      transaction(storeName: string) {
        const store = record.stores.get(storeName);
        if (!store) throw new Error(`missing store ${storeName}`);
        let oncomplete: ((ev: Event) => void) | null = null;
        const tx = {
          error: null,
          get oncomplete() {
            return oncomplete;
          },
          set oncomplete(fn: ((ev: Event) => void) | null) {
            oncomplete = fn;
          },
          onerror: null,
          onabort: null,
          objectStore() {
            return {
              put(value: { id: IDBValidKey }) {
                store.set(value.id, structuredClone(value));
                return { result: value.id };
              },
              delete(id: IDBValidKey) {
                store.delete(id);
                return { result: undefined };
              },
              getAll() {
                return { result: [...store.values()].map((row) => structuredClone(row)) };
              },
            };
          },
        };
        queueMicrotask(() => oncomplete?.(new Event('complete')));
        return tx as unknown as IDBTransaction;
      },
    } as unknown as IDBDatabase;
  }

  return {
    open(name: string, version = 1) {
      const req = {
        result: undefined as IDBDatabase | undefined,
        error: null as unknown,
        onsuccess: null as ((ev: Event) => void) | null,
        onerror: null as ((ev: Event) => void) | null,
        onupgradeneeded: null as ((ev: Event) => void) | null,
      };
      queueMicrotask(() => {
        try {
          let record = databases.get(name);
          const created = !record;
          if (!record) {
            record = { version: 0, stores: new Map() };
            databases.set(name, record);
          }
          req.result = database(record);
          if (created || record.version < version) {
            req.onupgradeneeded?.(new Event('upgradeneeded'));
            record.version = version;
          }
          req.onsuccess?.(new Event('success'));
        } catch (error) {
          req.error = error;
          req.onerror?.(new Event('error'));
        }
      });
      return req as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
}

const NOTE: SyncItem = { kind: 'message', row: { role: 'user', content: 'offline note' } };

describe('bootRovrServiceWorker with the network denied', () => {
  const running: RovrServiceWorkerBoot[] = [];

  afterEach(() => {
    for (const boot of running) boot.stop();
    running.length = 0;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('writes one durable row, survives a restart, and replays one batch without a platform fetch', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('platform fetch must not be called')));
    vi.stubGlobal('fetch', fetchSpy);
    const indexedDB = createRestartableIndexedDb();
    const chatId = -7;

    const first = bootRovrServiceWorker({ network: 'denied', indexedDB, storage: createMemoryKeyValue() });
    running.push(first);
    const id = await first.writeDurable(chatId, NOTE);
    first.stop();

    const restarted = bootRovrServiceWorker({ network: 'denied', indexedDB, storage: createMemoryKeyValue() });
    running.push(restarted);
    await restarted.ready();

    const queued = await createIndexedDbOutboxStore<SyncItem, number>({
      indexedDB,
      dbName: SYNC_OUTBOX_DB,
      partition: 'chats',
    }).load();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ id, key: chatId, item: NOTE });

    const replayed = await restarted.replayBatch();
    expect(replayed).toEqual({ count: 1, idempotencyKey: id });
    expect(fetchSpy).not.toHaveBeenCalled();

    const receipts = await createIndexedDbOutboxStore<RovrReplayReceipt, string>({
      indexedDB,
      dbName: SYNC_OUTBOX_DB,
      partition: ROVR_REPLAY_PARTITION,
    }).load();
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.item).toEqual({ idempotencyKey: id, count: 1, ids: [id] });

    const stillQueued = await createIndexedDbOutboxStore<SyncItem, number>({
      indexedDB,
      dbName: SYNC_OUTBOX_DB,
      partition: 'chats',
    }).load();
    expect(stillQueued).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();

    restarted.stop();
    const again = bootRovrServiceWorker({ network: 'denied', indexedDB, storage: createMemoryKeyValue() });
    running.push(again);
    await expect(again.replayBatch()).resolves.toEqual({ count: 0, idempotencyKey: id });
    const receiptsAfter = await createIndexedDbOutboxStore<RovrReplayReceipt, string>({
      indexedDB,
      dbName: SYNC_OUTBOX_DB,
      partition: ROVR_REPLAY_PARTITION,
    }).load();
    expect(receiptsAfter).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('starts the extension from the same boot and composes the policy once', () => {
    const source = readFileSync(new URL('./serviceWorker.ts', import.meta.url), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code.match(/createRovrPlatformPolicy\(/g)).toHaveLength(1);
    expect(code).toContain('void bootRovrServiceWorker()');
    expect(code).not.toMatch(/fetch:\s*(globalThis\.)?fetch\b/);
  });
});
