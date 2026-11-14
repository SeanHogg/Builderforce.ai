/**
 * A keyed loader that remembers SUCCESSES only. A load that answers `null` (or throws) is remembered for
 * {@link LOAD_RETRY_MS} — so a missing file costs one attempt per window, not one per call — and is then tried again, so a
 * transient failure (a wasm read racing an install, a locked file) never disables the feature for the whole session.
 * Concurrent callers of one key share the load in flight.
 */
/** How long a failed load is answered with `null` before it is tried again. */
export const LOAD_RETRY_MS = 30_000;
export function retryingLoad(opts = {}) {
    const retryMs = opts.retryMs ?? LOAD_RETRY_MS;
    const now = opts.now ?? Date.now;
    const loaded = new Map();
    const failedAt = new Map();
    return (key, load) => {
        const hit = loaded.get(key);
        if (hit)
            return hit;
        const failed = failedAt.get(key);
        if (failed !== undefined && now() - failed < retryMs)
            return Promise.resolve(null);
        const fail = () => {
            loaded.delete(key);
            failedAt.set(key, now());
            return null;
        };
        // Started on a microtask, so the entry is cached before any outcome (even a synchronous throw) can settle it.
        const pending = Promise.resolve().then(load).then((value) => {
            if (value === null)
                return fail();
            failedAt.delete(key);
            return value;
        }, fail);
        loaded.set(key, pending);
        return pending;
    };
}
//# sourceMappingURL=retryingLoad.js.map