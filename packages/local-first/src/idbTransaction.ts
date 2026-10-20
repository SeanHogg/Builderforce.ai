/**
 * The two IndexedDB promise adapters the local-first adapter and its lease share.
 * Extracted from `indexedDb.ts` so the lease module does not grow a second copy.
 */

export function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function complete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('indexeddb_transaction_failed'));
    tx.onabort = () => reject(tx.error ?? new Error('indexeddb_transaction_aborted'));
  });
}

/**
 * Attach the completion handlers BEFORE the first request is issued.
 *
 * A transaction with no pending request commits on its own, so a handler
 * attached after an `await` can miss the event entirely. A rejection handler is
 * attached immediately so the completion promise is never an unhandled
 * rejection; the caller still awaits it explicitly where it needs the outcome.
 */
export function trackComplete(tx: IDBTransaction): Promise<void> {
  const done = complete(tx);
  void done.catch(() => undefined);
  return done;
}
