/**
 * The browser's single read-through cache. Domain gateways own their keys and
 * invalidation rules; this module owns only bounded storage and single-flight.
 */

export interface ClientCacheOptions {
  /** How long a resolved value is reusable. Omit for session-lived values. */
  ttlMs?: number;
  /** Serve an expired value while one background refresh runs. */
  staleWhileRevalidate?: boolean;
}

interface CacheEntry<T = unknown> {
  value?: T;
  resolvedAt?: number;
  promise?: Promise<T>;
  controller?: AbortController;
}

const MAX_ENTRIES = 256;
const entries = new Map<string, CacheEntry>();

function fresh(entry: CacheEntry, ttlMs: number | undefined): boolean {
  if (entry.resolvedAt === undefined || !('value' in entry)) return false;
  return ttlMs === undefined || Date.now() - entry.resolvedAt < ttlMs;
}

function enforceBound(): void {
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value as string | undefined;
    if (oldest === undefined) return;
    const entry = entries.get(oldest);
    entry?.controller?.abort();
    entries.delete(oldest);
  }
}

function startLoad<T>(key: string, load: (signal: AbortSignal) => Promise<T>, prior?: CacheEntry<T>): Promise<T> {
  const controller = new AbortController();
  const entry: CacheEntry<T> = prior ?? {};
  entry.controller = controller;
  const promise = load(controller.signal)
    .then((value) => {
      if (entries.get(key) === entry) {
        entry.value = value;
        entry.resolvedAt = Date.now();
        entry.promise = undefined;
        entry.controller = undefined;
      }
      return value;
    })
    .catch((error) => {
      if (entries.get(key) === entry) entries.delete(key);
      throw error;
    });
  entry.promise = promise;
  entries.delete(key);
  entries.set(key, entry);
  enforceBound();
  return promise;
}

export function getOrSetClientCached<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
  options: ClientCacheOptions = {},
): Promise<T> {
  const entry = entries.get(key) as CacheEntry<T> | undefined;
  if (entry && fresh(entry, options.ttlMs)) return Promise.resolve(entry.value as T);
  if (entry?.promise) {
    if (options.staleWhileRevalidate && 'value' in entry) return Promise.resolve(entry.value as T);
    return entry.promise;
  }
  const refresh = startLoad(key, load, entry);
  if (options.staleWhileRevalidate && entry && 'value' in entry) {
    void refresh.catch(() => undefined);
    return Promise.resolve(entry.value as T);
  }
  return refresh;
}

/** Read a resolved entry synchronously for initial React state. */
export function readClientCached<T>(key: string, ttlMs?: number): T | undefined {
  const entry = entries.get(key) as CacheEntry<T> | undefined;
  return entry && fresh(entry, ttlMs) ? entry.value : undefined;
}

/** Invalidate one key or a namespace prefix. In-flight loads are aborted. */
export function invalidateClientCache(keyOrPrefix: string): void {
  for (const [key, entry] of entries) {
    if (key === keyOrPrefix || key.startsWith(keyOrPrefix)) {
      entry.controller?.abort();
      entries.delete(key);
    }
  }
}

