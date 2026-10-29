/**
 * knowledge/shaCache.ts — the ONE content-addressed cache for expensive, deterministic work
 * keyed by a tree's id (a commit, plus a digest of its uncommitted state).
 *
 * No TTL: the key IS the content, so an entry is right until the tree changes — and then it
 * is simply never asked for again. Bounded (oldest evicted), single-flight (concurrent askers
 * of one key share ONE run), and a result the caller will not `keep` — a failed or stopped run
 * — is not retained, so the next ask retries. A null key (the tree cannot be identified) is
 * never cached.
 */

export interface ShaCacheOptions<T> {
    /** Entries kept. Default 8. */
    max?: number;
    /** Whether a finished result is worth keeping. Default: always. */
    keep?: (value: T) => boolean;
}

export interface ShaCache<T> {
    getOrRun(key: string | null, work: () => Promise<T>): Promise<T>;
    clear(): void;
    readonly size: number;
}

export function createShaCache<T>(opts: ShaCacheOptions<T> = {}): ShaCache<T> {
    const max = opts.max ?? 8;
    const entries = new Map<string, Promise<T>>();
    return {
        getOrRun(key, work) {
            if (key === null) return work();
            const hit = entries.get(key);
            if (hit) return hit;
            const run = work();
            entries.set(key, run);
            while (entries.size > max) entries.delete(entries.keys().next().value as string);
            const drop = (): void => { if (entries.get(key) === run) entries.delete(key); };
            run.then((value) => { if (opts.keep && !opts.keep(value)) drop(); }, drop);
            return run;
        },
        clear: () => entries.clear(),
        get size() { return entries.size; },
    };
}
