/**
 * A message row saved AGAIN under the key it was saved with is the same row - in BOTH Rovr stores (the in-memory
 * one and the IndexedDB one), through the one shared decision (`slotKeyedRows`). This is what lets a save that timed
 * out and landed late, then was saved again from the requeued words, make one row and not two.
 *
 * The IndexedDB store is exercised against a minimal in-memory IDBFactory (the package has no IndexedDB fake and
 * this adds no dependency): just the operations the store uses.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createIdbRecords } from './idbRecords';
import { createMemoryRecords, type RovrRecords } from './records';

type Req<T> = { result: T; error: null; onsuccess: (() => void) | null; onerror: (() => void) | null };

function fakeIdb(): IDBFactory {
  const stores = new Map<string, FakeStore>();
  class FakeStore {
    rows = new Map<number | string, Record<string, unknown>>();
    next = 1;
    indexes = new Map<string, string>();
    constructor(readonly keyPath: string, readonly auto: boolean) {}
    createIndex(name: string, path: string) { this.indexes.set(name, path); return this; }
    request<T>(result: T): Req<T> {
      const req: Req<T> = { result, error: null, onsuccess: null, onerror: null };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    }
    add(value: Record<string, unknown>) {
      const stored = { ...value };
      if (this.auto && stored[this.keyPath] === undefined) stored[this.keyPath] = this.next++;
      this.rows.set(stored[this.keyPath] as number, stored);
      return this.request(stored[this.keyPath]);
    }
    put(value: Record<string, unknown>) { this.rows.set(value[this.keyPath] as number, { ...value }); return this.request(value[this.keyPath]); }
    get(key: number | string) { return this.request(this.rows.get(key)); }
    getAll() { return this.request([...this.rows.values()]); }
    index(name: string) {
      const path = this.indexes.get(name)!;
      return { getAll: (range: { only: unknown }) => this.request([...this.rows.values()].filter((row) => row[path] === range.only)) };
    }
  }
  const db = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string, opts: { keyPath: string; autoIncrement?: boolean }) => {
      const store = new FakeStore(opts.keyPath, !!opts.autoIncrement);
      stores.set(name, store);
      return store;
    },
    transaction: () => {
      const tx = { oncomplete: null as (() => void) | null, onerror: null, onabort: null, error: null, objectStore: (name: string) => stores.get(name)! };
      setTimeout(() => tx.oncomplete?.(), 0);
      return tx;
    },
  };
  return {
    open: () => {
      const req = { result: db, error: null, onsuccess: null as (() => void) | null, onerror: null, onupgradeneeded: null as (() => void) | null };
      queueMicrotask(() => {
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  } as unknown as IDBFactory;
}

beforeAll(() => {
  (globalThis as { IDBKeyRange?: unknown }).IDBKeyRange ??= { only: (value: unknown) => ({ only: value }) };
});

const stores: Array<[string, () => RovrRecords]> = [
  ['memory', () => createMemoryRecords()],
  ['IndexedDB', () => createIdbRecords(fakeIdb(), 'rovr-test')],
];

describe.each(stores)('the Rovr %s store: a row saved again under its key is the same row', (_name, make) => {
  it('returns the saved row and writes nothing new', async () => {
    const records = make();
    const chat = await records.createChat('keyed');

    const [first] = await records.appendMessages(chat.id, [{ role: 'user', content: 'said once', eventKey: 'steer:a' }]);
    const [again] = await records.appendMessages(chat.id, [{ role: 'user', content: 'said once', eventKey: 'steer:a' }]);

    expect(again?.id).toBe(first?.id);
    expect((await records.listMessages(chat.id)).map((m) => m.content)).toEqual(['said once']);
  });

  it('a key repeated inside ONE batch is one row, answered twice; rows without a key are always new', async () => {
    const records = make();
    const chat = await records.createChat('batch');

    const saved = await records.appendMessages(chat.id, [
      { role: 'user', content: 'X', eventKey: 'steer:x' },
      { role: 'user', content: 'plain' },
      { role: 'user', content: 'X', eventKey: 'steer:x' },
      { role: 'user', content: 'plain' },
    ]);

    expect(saved[2]?.id).toBe(saved[0]?.id);
    expect((await records.listMessages(chat.id)).map((m) => m.content)).toEqual(['X', 'plain', 'plain']);
  });

  it('keeps a key per chat, and never shows the key to a caller', async () => {
    const records = make();
    const a = await records.createChat('a');
    const b = await records.createChat('b');

    await records.appendMessages(a.id, [{ role: 'user', content: 'in a', eventKey: 'steer:same' }]);
    await records.appendMessages(b.id, [{ role: 'user', content: 'in b', eventKey: 'steer:same' }]);

    expect((await records.listMessages(a.id)).map((m) => m.content)).toEqual(['in a']);
    expect((await records.listMessages(b.id)).map((m) => m.content)).toEqual(['in b']);
    expect(Object.keys((await records.listMessages(a.id))[0]!)).not.toContain('eventKey');
  });
});
