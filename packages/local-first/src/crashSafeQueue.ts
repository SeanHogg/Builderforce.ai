/**
 * Crash-safe queue.
 *
 * `enqueue` writes the entry as pending before it returns. A crash after that
 * return still leaves the entry in the store, so a new queue over the same
 * store contains it. `acknowledge` writes that entry as acked. An unknown id
 * is a no-op: it does not throw and it does not rewrite or drop other entries.
 *
 * The array from `store.read()` is never mutated. Every write receives a new
 * array. `write` must persist before it returns — this module does not await,
 * open IndexedDB, take a lock, or call the network.
 */

export type CrashSafeStatus = 'pending' | 'acked';

export type CrashSafeQueueEntry<T extends { readonly id: string } = { readonly id: string }> = T & {
  readonly status: CrashSafeStatus;
};

export type CrashSafeQueueStore<T extends { readonly id: string } = { readonly id: string }> = {
  read(): readonly CrashSafeQueueEntry<T>[];
  write(entries: readonly CrashSafeQueueEntry<T>[]): void;
};

export type CrashSafeQueue<T extends { readonly id: string } = { readonly id: string }> = {
  /** Persist `entry` as pending, then return. Does not return if `write` throws. */
  enqueue(entry: T): CrashSafeQueueEntry<T>;
  /** Persist the matching entry as acked. Unknown id: no throw, no drop. */
  acknowledge(id: string): void;
  /** Unacked entries, in store order. A new array — not the one `read` returned. */
  pending(): readonly CrashSafeQueueEntry<T>[];
  /** Every stored entry, acked included. A new array. */
  entries(): readonly CrashSafeQueueEntry<T>[];
};

function readEntries<T extends { readonly id: string }>(
  store: CrashSafeQueueStore<T>,
): readonly CrashSafeQueueEntry<T>[] {
  const raw: unknown = store.read();
  return Array.isArray(raw) ? raw : [];
}

function isAcked(entry: { readonly status?: unknown }): boolean {
  return entry.status === 'acked';
}

function entryId(entry: unknown): string | undefined {
  if (entry === null || typeof entry !== 'object') return undefined;
  const id = (entry as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

/**
 * Queue whose durability is the injected store. Nothing is kept beside what
 * `read` returns, so a process that died after `enqueue` is recovered by
 * constructing another queue over the same store.
 */
export function createCrashSafeQueue<T extends { readonly id: string }>(
  store: CrashSafeQueueStore<T>,
): CrashSafeQueue<T> {
  return {
    enqueue(entry) {
      const id = entryId(entry);
      if (!id) throw new Error('queue_entry_id_required');
      const pending: CrashSafeQueueEntry<T> = { ...entry, id, status: 'pending' };
      const next = readEntries(store).concat(pending);
      store.write(next);
      return pending;
    },

    acknowledge(id) {
      const current = readEntries(store);
      let found = false;
      const next = current.map((entry) => {
        if (entryId(entry) !== id) return entry;
        found = true;
        return { ...entry, status: 'acked' as const };
      });
      if (!found) return;
      store.write(next);
    },

    pending() {
      return readEntries(store).filter((entry) => entry !== null && typeof entry === 'object' && !isAcked(entry));
    },

    entries() {
      return readEntries(store).slice();
    },
  };
}
