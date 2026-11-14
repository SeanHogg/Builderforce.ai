export function ttlCache(ttlMs) {
    const store = new Map();
    return {
        get(key) {
            const hit = store.get(key);
            if (hit && Date.now() - hit.ts < ttlMs)
                return { value: hit.value };
            return undefined;
        },
        set(key, value) {
            store.set(key, { ts: Date.now(), value });
        },
        invalidate(key) {
            if (key === undefined)
                store.clear();
            else
                store.delete(key);
        },
    };
}
//# sourceMappingURL=ttlCache.js.map