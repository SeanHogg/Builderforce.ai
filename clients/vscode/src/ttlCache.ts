/**
 * A tiny single-process, time-to-live cache: `get`/`set`/`invalidate` over a `Map`
 * whose entries expire `ttlMs` after they were written. Replaces the several
 * hand-rolled `Map`+timestamp caches in this extension (tasks, objectives, the
 * per-project Evermind head, the platform-tool catalog) with one shape.
 *
 * `get` returns a BOX (`{ value }`) on a fresh hit rather than the value directly,
 * so a cached `undefined` (a deliberately-remembered negative lookup — e.g. an
 * Evermind head that isn't reachable) is still a HIT and is not refetched until it
 * expires. A miss / expired entry returns `undefined`.
 */
export interface TtlCache<K, V> {
  /** The value box when a fresh entry exists (present box with `value: undefined`
   *  is still a hit); `undefined` when missing or expired. */
  get(key: K): { value: V } | undefined;
  set(key: K, value: V): void;
  /** Drop one key, or the whole cache when called with no key. */
  invalidate(key?: K): void;
}

export function ttlCache<K, V>(ttlMs: number): TtlCache<K, V> {
  const store = new Map<K, { ts: number; value: V }>();
  return {
    get(key) {
      const hit = store.get(key);
      if (hit && Date.now() - hit.ts < ttlMs) return { value: hit.value };
      return undefined;
    },
    set(key, value) {
      store.set(key, { ts: Date.now(), value });
    },
    invalidate(key) {
      if (key === undefined) store.clear();
      else store.delete(key);
    },
  };
}
