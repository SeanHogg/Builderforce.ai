/**
 * Weight store — the IndexedDB persistence layer for downloaded ONNX weights.
 *
 * Backed by `createModelCache` from `@seanhogg/builderforce-webcontainers/ml`,
 * pointed at the SAME database Studio has always used
 * (`builderforce-studio-weights` v1, object store `weights`), so a user's
 * existing multi-GB cache keeps serving without a re-download.
 *
 * STORAGE FORMAT IS FROZEN: every value in that store is a raw `ArrayBuffer`
 * keyed by cache key (`valueFormat: 'raw'`). Older Studio builds — a stale tab,
 * a rollback, the VS Code webview bundle — read the value as an ArrayBuffer;
 * an entry object would read back as empty bytes, fail the ORT parse and never
 * be re-downloaded. Never write any other shape into this store.
 *
 * Every failure is non-fatal: a read that throws is a miss, a write that throws
 * is dropped (the consumer just re-downloads next time), and an environment
 * without IndexedDB makes the store a no-op. `write` reports whether the bytes
 * actually landed, so a caller that downloads purely to warm the store (the
 * refinement prefetch) can stop instead of downloading for nothing.
 */

import { createModelCache, type ModelCache } from '@seanhogg/builderforce-webcontainers/ml';

/** The database Studio's weights have always lived in — never rename it. */
export const WEIGHT_DB = {
  dbName: 'builderforce-studio-weights',
  storeName: 'weights',
  dbVersion: 1,
} as const;

export interface WeightStore {
  /** The cached bytes for `key`, or null on a miss / unreadable store. */
  read(key: string): Promise<ArrayBuffer | null>;
  /** Whether `key` is cached, without reading its bytes (false when unreadable). */
  has(key: string): Promise<boolean>;
  /** Persist `bytes` under `key`. Never rejects: resolves true only when the
   *  bytes are now stored (false on quota / private mode / no IndexedDB). */
  write(key: string, bytes: ArrayBuffer): Promise<boolean>;
  /** Whether this environment has IndexedDB at all — synchronous, opens nothing. */
  canPersist(): boolean;
}

/** Build a store over `indexedDB` (the global by default; tests pass a fake). */
export function createWeightStore(indexedDB?: IDBFactory): WeightStore {
  const factory = indexedDB ?? (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  const cache: ModelCache = createModelCache({ ...WEIGHT_DB, indexedDB: factory, valueFormat: 'raw' });
  return {
    async read(key) {
      try {
        const entry = await cache.get(key);
        return entry?.bytes ?? null;
      } catch {
        return null;
      }
    },
    async has(key) {
      try {
        return await cache.has(key);
      } catch {
        return false;
      }
    },
    async write(key, bytes) {
      try {
        await cache.put(key, { bytes, size: bytes.byteLength });
        // put() resolves silently when the database could not be opened, so
        // confirm through the same (memoised) connection.
        return await cache.has(key);
      } catch {
        return false;
      }
    },
    canPersist: () => factory !== undefined,
  };
}

let shared: WeightStore | null = null;

/** The process-wide store every weight fetch reads and writes through. Created
 *  lazily so `globalThis.indexedDB` is read at first use, not at import. */
export function weightStore(): WeightStore {
  shared ??= createWeightStore();
  return shared;
}
