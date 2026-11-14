/**
 * The one in-process cache for the verifier (PRD 45 §4.4 cache): evidence keyed
 * `(absPath, hash, checkName)`, held in module memory for the lifetime of the
 * extension host process. A re-check of a file whose bytes have not changed costs
 * nothing; the moment the bytes change the hash changes and the cache misses —
 * stale evidence can never bless new bytes.
 */
/** Build the one cache key: normalised path + content hash + check name. */
export function cacheKey(absPath, hash, checkName) {
    return `${absPath.replace(/\\/g, "/")}\u0000${hash}\u0000${checkName}`;
}
/** Most-recently-used bound; beyond it the oldest entries are evicted. */
const DEFAULT_MAX_ENTRIES = 500;
export function createVerifyCache(maxEntries = DEFAULT_MAX_ENTRIES) {
    const store = new Map(); // insertion order = oldest first
    return {
        get(absPath, hash, checkName) {
            const key = cacheKey(absPath, hash, checkName);
            const hit = store.get(key);
            if (hit) {
                store.delete(key); // refresh recency
                store.set(key, hit);
            }
            return hit;
        },
        set(absPath, hash, checkName, record) {
            const key = cacheKey(absPath, hash, checkName);
            store.delete(key);
            store.set(key, record);
            while (store.size > maxEntries) {
                const oldest = store.keys().next().value;
                if (oldest === undefined)
                    break;
                store.delete(oldest);
            }
        },
        invalidate(absPath) {
            const prefix = `${absPath.replace(/\\/g, "/")}\u0000`;
            for (const key of [...store.keys()])
                if (key.startsWith(prefix))
                    store.delete(key);
        },
        size() {
            return store.size;
        },
    };
}
//# sourceMappingURL=cache.js.map