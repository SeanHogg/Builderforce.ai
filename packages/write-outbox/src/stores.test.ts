import { describe, expect, it, vi } from "vitest";
import type { OutboxEntry } from "./types.js";
import {
  createIndexedDbOutboxStore,
  listIndexedDbOutboxPartitions,
  createMemoryOutboxStore,
  createOnlineSignal,
  createSnapshotOutboxStore,
} from "./stores.js";

const entry = (id: string, seq: number, item = id): OutboxEntry<string, string> => ({ id, key: "k", item, seq });

/**
 * Just enough of IndexedDB for the adapter: one versioned database per name, object
 * stores keyed by `id`, and transactions that complete after the requests queued in
 * them — asynchronously, as the real thing does.
 */
function fakeIndexedDB(): IDBFactory {
  const dbs = new Map<string, Map<string, Map<unknown, unknown>>>();
  const factory = {
    open(name: string) {
      const req: Record<string, unknown> & { result?: unknown } = {};
      queueMicrotask(() => {
        let stores = dbs.get(name);
        const isNew = !stores;
        if (!stores) {
          stores = new Map();
          dbs.set(name, stores);
        }
        const s = stores;
        req.result = {
          objectStoreNames: { contains: (n: string) => s.has(n) },
          createObjectStore: (n: string) => s.set(n, new Map()),
          transaction: (n: string) => {
            const data = s.get(n)!;
            const tx: Record<string, unknown> = {
              objectStore: () => ({
                put: (v: { id: string }) => data.set(v.id, structuredClone(v)),
                delete: (k: string) => data.delete(k),
                getAll: () => ({ result: [...data.values()].map((v) => structuredClone(v)) }),
              }),
            };
            setTimeout(() => (tx.oncomplete as (() => void) | undefined)?.());
            return tx;
          },
        };
        if (isNew) (req.onupgradeneeded as (() => void) | undefined)?.();
        (req.onsuccess as (() => void) | undefined)?.();
      });
      return req;
    },
  };
  return factory as unknown as IDBFactory;
}

describe("createSnapshotOutboxStore", () => {
  it("round-trips entries through one stored value", async () => {
    let value: unknown;
    const write = vi.fn((v: unknown) => { value = v; });
    const store = createSnapshotOutboxStore<string, string>({ read: () => value, write });
    await store.put([entry("a", 1), entry("b", 2)]);
    await store.remove(["a"]);
    const reopened = createSnapshotOutboxStore<string, string>({ read: () => value, write });
    expect(await reopened.load()).toEqual([entry("b", 2)]);
  });

  it("loads a malformed value as an empty queue and skips no-op removes", async () => {
    const write = vi.fn();
    const store = createSnapshotOutboxStore<string, string>({ read: () => ({ not: "an array" }), write });
    expect(await store.load()).toEqual([]);
    await store.remove(["missing"]);
    expect(write).not.toHaveBeenCalled();
  });

  it("the memory store is a snapshot store over a variable", async () => {
    const store = createMemoryOutboxStore<string, string>();
    await store.put([entry("a", 1)]);
    expect(await store.load()).toEqual([entry("a", 1)]);
  });
});

describe("createIndexedDbOutboxStore", () => {
  it("puts, loads and removes entries by id", async () => {
    const indexedDB = fakeIndexedDB();
    const store = createIndexedDbOutboxStore<string, string>({ indexedDB, dbName: "outbox:test" });
    await store.put([entry("a", 1), entry("b", 2)]);
    await store.put([{ ...entry("a", 1), batch: "a" }]);
    await store.remove(["b"]);
    const reopened = createIndexedDbOutboxStore<string, string>({ indexedDB, dbName: "outbox:test" });
    expect(await reopened.load()).toEqual([{ ...entry("a", 1), batch: "a" }]);
  });
});

describe("createIndexedDbOutboxStore partitions", () => {
  it("keeps several queues apart in one database", async () => {
    const indexedDB = fakeIndexedDB();
    const a = createIndexedDbOutboxStore<string, string>({ indexedDB, dbName: "outbox:p", partition: "a" });
    const b = createIndexedDbOutboxStore<string, string>({ indexedDB, dbName: "outbox:p", partition: "b" });
    await a.put([entry("x", 1)]);
    await b.put([entry("y", 2)]);
    expect(await a.load()).toEqual([entry("x", 1)]);
    expect(await b.load()).toEqual([entry("y", 2)]);
    expect((await listIndexedDbOutboxPartitions({ indexedDB, dbName: "outbox:p" })).sort()).toEqual(["a", "b"]);
  });
});

describe("createOnlineSignal", () => {
  it("notifies listeners on transitions only", () => {
    const signal = createOnlineSignal(true);
    const heard: boolean[] = [];
    const off = signal.subscribe((o) => heard.push(o));
    signal.set(true);
    signal.set(false);
    signal.set(true);
    off();
    signal.set(false);
    expect(heard).toEqual([false, true]);
    expect(signal.isOnline()).toBe(false);
  });
});
