/**
 * Storage adapters for the write outbox ({@link OutboxStore}) and the host connectivity
 * signal. Each is host-neutral: the host hands in the one thing that is host-specific —
 * a whole-value key/value slot (VS Code `globalState`, `chrome.storage.local`, memory) or
 * an `IDBFactory` (a browser tab, an MV3 service worker) — and nothing here reaches for a
 * Node builtin or a DOM global.
 */

import type { OutboxEntry, OutboxOnlineSignal, OutboxStore } from "./outbox.js";

// ── Snapshot store: the whole queue as ONE value ───────────────────────────────

/**
 * A slot that holds one JSON value — what VS Code's `Memento` (`globalState`) and
 * `chrome.storage.local` both are. `read` answers whatever was last written (or
 * `undefined`); `write` replaces it.
 */
export interface OutboxSnapshotStorage {
  read(): unknown | Promise<unknown>;
  write(value: OutboxEntry<unknown, unknown>[]): void | Promise<void>;
}

const isEntry = (v: unknown): v is OutboxEntry<unknown, unknown> =>
  typeof v === "object" && v !== null
  && typeof (v as { id?: unknown }).id === "string"
  && typeof (v as { seq?: unknown }).seq === "number";

/**
 * An {@link OutboxStore} over a single-value slot. The queue is small and bounded
 * (`maxEntries`), so rewriting it whole on each change is the honest trade for a slot
 * that has no per-entry addressing. A malformed stored value loads as an empty queue.
 */
export function createSnapshotOutboxStore<T, K>(storage: OutboxSnapshotStorage): OutboxStore<T, K> {
  let entries: Map<string, OutboxEntry<T, K>> | null = null;
  const ensure = async (): Promise<Map<string, OutboxEntry<T, K>>> => {
    if (!entries) {
      const raw = await storage.read();
      const list = Array.isArray(raw) ? raw.filter(isEntry) : [];
      entries = new Map(list.map((e) => [e.id, { ...e } as OutboxEntry<T, K>]));
    }
    return entries;
  };
  const save = (m: Map<string, OutboxEntry<T, K>>) =>
    storage.write([...m.values()] as OutboxEntry<unknown, unknown>[]);
  return {
    async load() {
      return [...(await ensure()).values()].map((e) => ({ ...e }));
    },
    async put(list) {
      const m = await ensure();
      for (const e of list) m.set(e.id, { ...e });
      await save(m);
    },
    async remove(ids) {
      const m = await ensure();
      let changed = false;
      for (const id of ids) changed = m.delete(id) || changed;
      if (changed) await save(m);
    },
  };
}

/** An in-memory {@link OutboxStore} — the queue outlives one outbox, not the process. */
export function createMemoryOutboxStore<T, K>(): OutboxStore<T, K> {
  let value: unknown;
  return createSnapshotOutboxStore<T, K>({
    read: () => value,
    write: (v) => {
      value = v;
    },
  });
}

// ── IndexedDB: browser tabs and MV3 service workers ────────────────────────────

export interface IndexedDbOutboxStoreOptions {
  /** The host's factory — `indexedDB` in a tab, `self.indexedDB` in a service worker. */
  indexedDB: IDBFactory;
  /** One database per outbox, e.g. `builderforce-outbox:errors`. */
  dbName: string;
  /** Object store name. Default `entries`. */
  storeName?: string;
  /**
   * Several queues in one database (e.g. one per chat): each record is tagged with its
   * partition and a store only loads its own. Default: the whole object store.
   */
  partition?: string;
}

/**
 * An {@link OutboxStore} over IndexedDB: one record per entry, keyed by its id.
 *
 * Tenant safety is the OUTBOX's job, not the store's: give the outbox a `scope` (the
 * signed-in tenant) and entries queued under one tenant are parked, never replayed as
 * another. Use `partition` only to keep several queues apart in one database.
 */
type IdbRun = <R>(mode: IDBTransactionMode, body: (s: IDBObjectStore) => IDBRequest<R> | void) => Promise<R | undefined>;

/** One lazily-opened database + a transaction runner over its object store. */
function idbRunner(opts: Pick<IndexedDbOutboxStoreOptions, "indexedDB" | "dbName" | "storeName">): IdbRun {
  const storeName = opts.storeName ?? "entries";
  let db: Promise<IDBDatabase> | null = null;

  const open = (): Promise<IDBDatabase> => {
    db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = opts.indexedDB.open(opts.dbName, 1);
      req.onupgradeneeded = () => {
        const created = req.result;
        if (!created.objectStoreNames.contains(storeName)) created.createObjectStore(storeName, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch((error: unknown) => {
      db = null; // the next call tries again rather than failing forever
      throw error;
    });
    return db;
  };

  return async <R>(mode: IDBTransactionMode, body: (s: IDBObjectStore) => IDBRequest<R> | void): Promise<R | undefined> => {
    const handle = await open();
    return new Promise<R | undefined>((resolve, reject) => {
      const tx = handle.transaction(storeName, mode);
      const req = body(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };
}

type StoredRecord = OutboxEntry<unknown, unknown> & { partition?: string };

const readAll = async (run: IdbRun): Promise<StoredRecord[]> =>
  ((await run<StoredRecord[]>("readonly", (s) => s.getAll() as IDBRequest<StoredRecord[]>)) ?? []).filter(isEntry);

export function createIndexedDbOutboxStore<T, K>(opts: IndexedDbOutboxStoreOptions): OutboxStore<T, K> {
  const run = idbRunner(opts);
  return {
    async load() {
      return (await readAll(run))
        .filter((r) => r.partition === opts.partition)
        .map(({ partition: _p, ...entry }) => entry as OutboxEntry<T, K>);
    },
    async put(entries) {
      await run("readwrite", (s) => {
        for (const e of entries) s.put(opts.partition === undefined ? e : { ...e, partition: opts.partition });
      });
    },
    async remove(ids) {
      await run("readwrite", (s) => {
        for (const id of ids) s.delete(id);
      });
    },
  };
}

/**
 * The partitions that hold queued entries in one database — so a host can replay every
 * stored queue (e.g. every chat's) at startup or on reconnect without knowing them up front.
 */
export async function listIndexedDbOutboxPartitions(
  opts: Pick<IndexedDbOutboxStoreOptions, "indexedDB" | "dbName" | "storeName">,
): Promise<string[]> {
  const partitions = new Set<string>();
  for (const r of await readAll(idbRunner(opts))) if (typeof r.partition === "string") partitions.add(r.partition);
  return [...partitions];
}

// ── Connectivity ───────────────────────────────────────────────────────────────

/** An {@link OutboxOnlineSignal} the host drives (`online`/`offline` events, request outcomes). */
export interface ManualOnlineSignal extends OutboxOnlineSignal {
  set(online: boolean): void;
}

/** A connectivity signal the host sets; listeners hear only real transitions. */
export function createOnlineSignal(initial = true): ManualOnlineSignal {
  let online = initial;
  const listeners = new Set<(online: boolean) => void>();
  return {
    isOnline: () => online,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      if (next === online) return;
      online = next;
      for (const l of [...listeners]) l(next);
    },
  };
}
