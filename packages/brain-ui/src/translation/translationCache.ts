/**
 * The translation cache: one entry per `contentId + locale (+ text fingerprint)`, so a
 * message is translated once per device. A tiny idb-keyval-style store; every IndexedDB
 * failure (private mode, a server render, a full disk) degrades to an in-memory map for
 * the session — it is a cache, so losing it costs one more translation, never data.
 */

export type TranslationEntry =
  /** The text is already in the reader's language (or too uncertain to touch). */
  | { kind: 'plain' }
  /** Translated; `from` is the detected language code. */
  | { kind: 'translated'; from: string; text: string };

export interface TranslationCache {
  get(key: string): Promise<TranslationEntry | undefined>;
  set(key: string, entry: TranslationEntry): Promise<void>;
  /** Forget everything (sign-out: another person's translated messages must not outlive their session). */
  clear(): Promise<void>;
}

/** An entry older than this is refetched — a translation is cheap, a stale one is not harmless. */
export const TRANSLATION_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** The most entries kept on a device; the least recently used go first. */
export const TRANSLATION_CACHE_MAX_ENTRIES = 2_000;
/** How many writes pass between size checks. */
const PRUNE_EVERY = 100;

/** What the device store holds: the entry plus when it was last written or read. */
type StoredEntry = TranslationEntry & { at?: number };

/** FNV-1a — a cheap fingerprint so an edited message is not served its old translation. */
export function textFingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${text.length}.${(h >>> 0).toString(36)}`;
}

export function translationCacheKey(contentId: string, locale: string, text: string): string {
  return `${contentId}|${locale}|${textFingerprint(text)}`;
}

/** A cache that lives only in memory — the fallback, and the test double. */
export function memoryTranslationCache(): TranslationCache {
  const map = new Map<string, TranslationEntry>();
  return {
    get: async (key) => map.get(key),
    set: async (key, entry) => { map.set(key, entry); },
    clear: async () => { map.clear(); },
  };
}

/** A cache view whose writes can be switched off — see {@link retirableTranslationCache}. */
export interface RetirableTranslationCache extends TranslationCache {
  /** Drop every later write through this view (reads and clear still pass through). */
  retire(): void;
}

/**
 * One identity's view of the shared cache. When the signed-in identity changes the provider
 * retires the old view, so a translation still in flight for the previous person can never
 * land in the cache that was just cleared for the next one.
 */
export function retirableTranslationCache(inner: TranslationCache): RetirableTranslationCache {
  let retired = false;
  return {
    get: (key) => inner.get(key),
    set: async (key, entry) => { if (!retired) await inner.set(key, entry); },
    clear: () => inner.clear(),
    retire: () => { retired = true; },
  };
}

/** A stored row as prune sees it: its key and when it was last written or read. */
export interface CacheRow { key: IDBValidKey; at: number }

/**
 * Which rows prune evicts: every expired one, then the least recently used live ones beyond
 * {@link TRANSLATION_CACHE_MAX_ENTRIES}. Pure — the rows must come from ONE snapshot.
 */
export function selectEvictions(rows: readonly CacheRow[], now: number, max = TRANSLATION_CACHE_MAX_ENTRIES): IDBValidKey[] {
  const live = rows.filter((row) => now - row.at <= TRANSLATION_CACHE_TTL_MS);
  const expired = rows.filter((row) => now - row.at > TRANSLATION_CACHE_TTL_MS);
  const overflow = [...live].sort((a, b) => a.at - b.at).slice(0, Math.max(0, live.length - max));
  return [...expired, ...overflow].map((row) => row.key);
}

const DB_NAME = 'bf-translation-cache';
const STORE = 'kv';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function request<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Drops expired entries, then the least recently used beyond the bound. ONE readwrite
 * transaction: a cursor reads each key WITH its value (no separate key/value lists a
 * concurrent write could misalign), and the deletes run in the same transaction.
 */
function prune(db: IDBDatabase, now: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const rows: CacheRow[] = [];
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const at = cursor.result;
      if (at) {
        rows.push({ key: at.key, at: (at.value as StoredEntry | undefined)?.at ?? 0 });
        at.continue();
        return;
      }
      for (const key of selectEvictions(rows, now)) store.delete(key);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** IndexedDB-backed, memory in front, memory alone when IndexedDB is unusable. Entries expire (30 days) and are bounded (2,000, least recently used first). */
export function indexedDbTranslationCache(): TranslationCache {
  const memory = memoryTranslationCache();
  let db: Promise<IDBDatabase | null> | undefined;
  let writes = 0;
  const open = (): Promise<IDBDatabase | null> => {
    db ??= typeof indexedDB === 'undefined'
      ? Promise.resolve(null)
      : openDb().then(async (handle) => { await prune(handle, Date.now()).catch(() => undefined); return handle; }, () => null);
    return db;
  };
  const strip = ({ at: _at, ...entry }: StoredEntry): TranslationEntry => entry as TranslationEntry;
  return {
    async get(key) {
      const hit = await memory.get(key);
      if (hit) return hit;
      try {
        const handle = await open();
        if (!handle) return undefined;
        const stored = await request<StoredEntry | undefined>(handle, 'readonly', (s) => s.get(key));
        if (!stored) return undefined;
        if (Date.now() - (stored.at ?? 0) > TRANSLATION_CACHE_TTL_MS) {
          await request(handle, 'readwrite', (s) => s.delete(key)).catch(() => undefined);
          return undefined;
        }
        const entry = strip(stored);
        await memory.set(key, entry);
        // Touch: reading is what keeps an entry from being the next one pruned.
        await request(handle, 'readwrite', (s) => s.put({ ...entry, at: Date.now() }, key)).catch(() => undefined);
        return entry;
      } catch {
        return undefined;
      }
    },
    async set(key, entry) {
      await memory.set(key, entry);
      try {
        const handle = await open();
        if (!handle) return;
        await request(handle, 'readwrite', (s) => s.put({ ...entry, at: Date.now() }, key));
        writes += 1;
        if (writes % PRUNE_EVERY === 0) await prune(handle, Date.now());
      } catch {
        /* the memory copy stands */
      }
    },
    async clear() {
      await memory.clear();
      try {
        const handle = await open();
        if (handle) await request(handle, 'readwrite', (s) => s.clear());
      } catch {
        /* nothing more to forget */
      }
    },
  };
}

let shared: TranslationCache | undefined;
/** THE device cache every host's provider uses unless it is handed another. */
export function defaultTranslationCache(): TranslationCache {
  return (shared ??= indexedDbTranslationCache());
}
