/**
 * The storage PORT every Rovr module persists small values through — settings, the
 * credential, playbooks. The Chrome adapter (`chrome.storage.local` / `.sync`) lives
 * beside it; tests use {@link createMemoryKeyValue}.
 */
export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  /** Every stored entry whose key starts with `prefix`. */
  entries<T>(prefix: string): Promise<Array<[string, T]>>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  /** Called with the keys that changed (from any extension context). */
  subscribe(listener: (keys: string[]) => void): () => void;
}

export function createMemoryKeyValue(initial: Record<string, unknown> = {}): KeyValueStore {
  const data = new Map<string, unknown>(Object.entries(initial));
  const listeners = new Set<(keys: string[]) => void>();
  const changed = (keys: string[]) => {
    for (const l of [...listeners]) l(keys);
  };
  return {
    async get<T>(key: string) {
      return data.get(key) as T | undefined;
    },
    async entries<T>(prefix: string) {
      return [...data.entries()].filter(([k]) => k.startsWith(prefix)) as Array<[string, T]>;
    },
    async set(key, value) {
      data.set(key, value);
      changed([key]);
    },
    async remove(key) {
      data.delete(key);
      changed([key]);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** `chrome.storage.<area>` as a {@link KeyValueStore}. */
export function chromeKeyValue(area: 'local' | 'sync'): KeyValueStore {
  const storage = chrome.storage[area];
  return {
    async get<T>(key: string) {
      const got = await storage.get(key);
      return got[key] as T | undefined;
    },
    async entries<T>(prefix: string) {
      const all = await storage.get(null);
      return Object.entries(all).filter(([k]) => k.startsWith(prefix)) as Array<[string, T]>;
    },
    async set(key, value) {
      await storage.set({ [key]: value });
    },
    async remove(key) {
      await storage.remove(key);
    },
    subscribe(listener) {
      const onChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
        if (areaName === area) listener(Object.keys(changes));
      };
      chrome.storage.onChanged.addListener(onChanged);
      return () => chrome.storage.onChanged.removeListener(onChanged);
    },
  };
}
