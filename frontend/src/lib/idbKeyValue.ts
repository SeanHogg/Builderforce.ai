/**
 * A tiny IndexedDB key→value store (one object store, out-of-line keys).
 *
 * Where IndexedDB is unavailable or throws (private mode, SSR, tests) the in-memory
 * copy is the store for the life of the tab, so callers never branch on support.
 */

export interface IdbKeyValue<T> {
  get(key: string): Promise<T | undefined>;
  put(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  /** Remove every entry (memory and the persisted store). */
  clear(): Promise<void>;
  /** False once a write could not reach IndexedDB: the entries then live in this tab's memory only. */
  isPersistent(): boolean;
}

export function createIdbKeyValue<T>(dbName: string, storeName: string): IdbKeyValue<T> {
  const memory = new Map<string, T>();

  function openDb(): Promise<IDBDatabase> | null {
    if (typeof indexedDB === 'undefined') return null;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(storeName)) req.result.createObjectStore(storeName);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  /** Run one request against the store; resolves undefined when IDB is unusable. */
  async function run<R>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<R>): Promise<R | undefined> {
    const opening = openDb();
    if (!opening) return undefined;
    const db = await opening;
    try {
      return await new Promise<R>((resolve, reject) => {
        const req = op(db.transaction(storeName, mode).objectStore(storeName));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  }

  /** Set once a write to IndexedDB failed: from then on the in-memory copy is the only store. */
  let persistFailed = false;

  /** A write to the persisted store; its failure is recorded (see `isPersistent`), never thrown. */
  async function persist<R>(op: (s: IDBObjectStore) => IDBRequest<R>): Promise<void> {
    try {
      await run('readwrite', op);
    } catch {
      persistFailed = true;
    }
  }

  return {
    async get(key) {
      if (memory.has(key)) return memory.get(key);
      try {
        const v = (await run('readonly', (s) => s.get(key))) as T | undefined;
        if (v !== undefined) memory.set(key, v);
        return v;
      } catch {
        return undefined;
      }
    },
    async put(key, value) {
      memory.set(key, value);
      await persist((s) => s.put(value as unknown, key));
    },
    async delete(key) {
      memory.delete(key);
      await persist((s) => s.delete(key));
    },
    async clear() {
      memory.clear();
      await persist((s) => s.clear());
    },
    isPersistent: () => !persistFailed,
  };
}
