/**
 * knowledge/shaCache.ts — the ONE content-addressed cache for expensive, deterministic work
 * keyed by a tree's id (a commit, plus a digest of its uncommitted state).
 *
 * The key IS the content, so an entry is right until the tree changes — and then it is
 * simply never asked for again. Bounded (oldest evicted), single-flight (concurrent askers
 * of one key share ONE run), and a result the caller will not `keep` — a stopped run — is
 * not retained, so the next ask retries. `keep` may also bound HOW LONG a result is
 * retained (a failed analyzer's verdict, a tree that cannot be identified), and `ttlMs`
 * bounds every entry (a value that is cheap to recompute but not free: the git fingerprint).
 *
 * A shared run is stopped only when EVERY asker that passed a signal has stopped: one
 * asker's Stop never takes the run away from another who is still waiting. An asker
 * without a signal keeps the run alive. A null key (the tree cannot be identified) is
 * never cached — the caller's own signal rides its own run.
 */

export interface ShaCacheOptions<T> {
    /** Entries kept. Default 8. */
    max?: number;
    /**
     * Whether a finished result is worth keeping: `true` keeps it (for `ttlMs`, else for
     * good), `false` drops it, a number keeps it that many milliseconds. Default: keep.
     */
    keep?: (value: T) => boolean | number;
    /** Lifetime of every kept entry; absent ⇒ none (the key is the content). */
    ttlMs?: number;
    /** Clock, injectable for tests. */
    now?: () => number;
}

export interface ShaCache<T> {
    /** `work` receives the shared run's signal (see above); `signal` is THIS asker's. */
    getOrRun(key: string | null, work: (signal?: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T>;
    clear(): void;
    readonly size: number;
}

interface Entry<T> {
    run: Promise<T>;
    /** Epoch ms after which the entry is no longer served; undefined ⇒ never. */
    expires?: number;
    /** Askers sharing the run, and how many of them have stopped. */
    waiting: number;
    stopped: number;
    controller: AbortController;
    /** The run finished: a late Stop no longer concerns it. */
    settled: boolean;
}

export function createShaCache<T>(opts: ShaCacheOptions<T> = {}): ShaCache<T> {
    const max = opts.max ?? 8;
    const now = opts.now ?? Date.now;
    const entries = new Map<string, Entry<T>>();

    /** Registers one asker with the shared run; aborts it (and forgets it, so a new asker starts afresh) once every asker has stopped. */
    const join = (key: string, entry: Entry<T>, signal: AbortSignal | undefined): void => {
        entry.waiting += 1;
        if (!signal) return; // Never stops: it keeps the run alive.
        const stop = (): void => {
            entry.stopped += 1;
            if (entry.settled || entry.stopped < entry.waiting) return;
            entry.controller.abort();
            if (entries.get(key) === entry) entries.delete(key);
        };
        if (signal.aborted) stop();
        else signal.addEventListener('abort', stop, { once: true });
    };

    return {
        getOrRun(key, work, signal) {
            if (key === null) return work(signal);
            const hit = entries.get(key);
            if (hit && (hit.expires === undefined || hit.expires > now())) {
                join(key, hit, signal);
                return hit.run;
            }
            if (hit) entries.delete(key);

            const controller = new AbortController();
            const entry: Entry<T> = { run: undefined as unknown as Promise<T>, waiting: 0, stopped: 0, controller, settled: false };
            entries.set(key, entry);
            while (entries.size > max) entries.delete(entries.keys().next().value as string);
            join(key, entry, signal);
            entry.run = work(controller.signal);
            const drop = (): void => { if (entries.get(key) === entry) entries.delete(key); };
            entry.run.then((value) => {
                entry.settled = true;
                const verdict = opts.keep ? opts.keep(value) : true;
                if (verdict === false) return drop();
                const lifetime = typeof verdict === 'number' ? verdict : opts.ttlMs;
                if (lifetime !== undefined) entry.expires = now() + lifetime;
            }, () => { entry.settled = true; drop(); });
            return entry.run;
        },
        clear: () => entries.clear(),
        get size() { return entries.size; },
    };
}
