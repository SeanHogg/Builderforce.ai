/**
 * The ONE IndexedDB connection of the browser's local knowledge (`builderforce-knowledge`, version 2). The rows store
 * (`knowledgeRows.ts`), the files store (`knowledgeFiles.ts`) and the review manifest all live in it, so a manifest write
 * commits in the SAME transaction as the facts it describes.
 *
 * Version 1 held one `manifests` store (a record of sources per root). Version 2 copies those records into `manifest`
 * (never over an entry already there) and KEEPS `manifests` readable for one release; a later upgrade deletes it.
 *
 * The connection is opened lazily and re-opened when it was closed: another tab asking for a newer version closes this one
 * (`onversionchange`), and a request that stays blocked past {@link BLOCKED_WAIT_MS} fails, so the caller degrades instead
 * of hanging. Nothing here throws at import; an unavailable IndexedDB rejects `open()`.
 */

import type { KnowledgeDegradedReporter } from './directorySourceKit';

export const KNOWLEDGE_DB_NAME = 'builderforce-knowledge';
export const KNOWLEDGE_DB_VERSION = 2;
/** How long an open waits on another tab's old connection before it gives up. */
export const BLOCKED_WAIT_MS = 5_000;

const STORES = ['scopes', 'facts', 'relations', 'extracted', 'recheck', 'manifest', 'meta', 'files'] as const;
export type KnowledgeStoreName = (typeof STORES)[number];
/** Version 1's store; read once by the version 2 upgrade, deleted by a later one. */
const LEGACY_MANIFESTS = 'manifests';

export interface KnowledgeDbOptions {
  /** The factory to open on (tests pass `fake-indexeddb`); default the global `indexedDB`. */
  idb?: IDBFactory;
  dbName?: string;
  report?: KnowledgeDegradedReporter;
}

export interface KnowledgeDb {
  open(): Promise<IDBDatabase>;
  /** One transaction over `names`; `work` may await ONLY requests of this transaction. Resolves with `work`'s value once the transaction committed. */
  run<T>(names: readonly KnowledgeStoreName[], mode: IDBTransactionMode, work: (store: (name: KnowledgeStoreName) => IDBObjectStore) => Promise<T>): Promise<T>;
  close(): void;
}

export const promisify = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

/** Copies version 1's records into the `manifest` store, keeping any entry already there. */
function adoptLegacyManifests(db: IDBDatabase, tx: IDBTransaction): void {
  if (!db.objectStoreNames.contains(LEGACY_MANIFESTS)) return;
  const target = tx.objectStore('manifest');
  const cursor = tx.objectStore(LEGACY_MANIFESTS).openCursor();
  cursor.onsuccess = () => {
    const at = cursor.result;
    if (!at) return;
    for (const [sourceId, fingerprints] of Object.entries(at.value as Record<string, unknown>)) {
      const have = target.get(sourceId);
      have.onsuccess = () => { if (have.result === undefined) target.put(fingerprints, sourceId); };
    }
    at.continue();
  };
}

export function knowledgeDb(opts: KnowledgeDbOptions = {}): KnowledgeDb {
  const name = opts.dbName ?? KNOWLEDGE_DB_NAME;
  let connection: Promise<IDBDatabase> | undefined;
  let closed = false;

  const factory = (): IDBFactory | undefined => opts.idb ?? (typeof indexedDB === 'undefined' ? undefined : indexedDB);

  const connect = (): Promise<IDBDatabase> => new Promise<IDBDatabase>((resolve, reject) => {
    const idb = factory();
    if (!idb) { reject(new Error('indexeddb_unavailable')); return; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const request = idb.open(name, KNOWLEDGE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of STORES) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      adoptLegacyManifests(db, request.transaction!);
    };
    request.onblocked = () => {
      opts.report?.('knowledge storage blocked', new Error('another tab holds an older knowledge database open'), { dbName: name });
      timer = setTimeout(() => { settled = true; reject(new Error('knowledge_db_blocked')); }, BLOCKED_WAIT_MS);
    };
    request.onsuccess = () => {
      if (timer) clearTimeout(timer);
      const db = request.result;
      // A late success after the wait gave up, or after close(): nobody will use this connection.
      if (settled || closed) { db.close(); if (!settled) reject(new Error('knowledge_db_closed')); return; }
      settled = true;
      db.onversionchange = () => { db.close(); connection = undefined; };
      db.onclose = () => { connection = undefined; };
      resolve(db);
    };
    request.onerror = () => { if (timer) clearTimeout(timer); settled = true; reject(request.error ?? new Error('knowledge_db_open_failed')); };
  });

  const open = (): Promise<IDBDatabase> => {
    if (!connection) {
      closed = false;
      const pending = connect();
      connection = pending;
      pending.catch(() => { if (connection === pending) connection = undefined; });
    }
    return connection;
  };

  const transact = <T>(
    db: IDBDatabase, names: readonly KnowledgeStoreName[], mode: IDBTransactionMode,
    work: (store: (n: KnowledgeStoreName) => IDBObjectStore) => Promise<T>,
  ): Promise<T> => new Promise<T>((resolve, reject) => {
    const tx = db.transaction([...names], mode);
    let value: T;
    tx.oncomplete = () => resolve(value);
    tx.onabort = () => reject(tx.error ?? new Error('knowledge_transaction_aborted'));
    work((n) => tx.objectStore(n)).then((v) => { value = v; }, (error: unknown) => {
      reject(error);
      try { tx.abort(); } catch { /* already finished */ }
    });
  });

  return {
    open,
    async run(names, mode, work) {
      let db = await open();
      try {
        return await transact(db, names, mode, work);
      } catch (error) {
        // The connection was closed under us (another tab upgraded the database): open again, once.
        if (!(error instanceof DOMException && error.name === 'InvalidStateError')) throw error;
        connection = undefined;
        db = await open();
        return transact(db, names, mode, work);
      }
    },
    close() {
      closed = true;
      const held = connection;
      connection = undefined;
      void held?.then((db) => db.close(), () => undefined);
    },
  };
}
