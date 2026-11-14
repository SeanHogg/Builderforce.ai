/**
 * Storage adapters for the write outbox ({@link OutboxStore}) and the host connectivity
 * signal. Each is host-neutral: the host hands in the one thing that is host-specific —
 * a whole-value key/value slot (VS Code `globalState`, `chrome.storage.local`, memory) or
 * an `IDBFactory` (a browser tab, an MV3 service worker) — and nothing here reaches for a
 * Node builtin or a DOM global.
 */
const isEntry = (v) => typeof v === "object" && v !== null
    && typeof v.id === "string"
    && typeof v.seq === "number";
/**
 * An {@link OutboxStore} over a single-value slot. The queue is small and bounded
 * (`maxEntries`), so rewriting it whole on each change is the honest trade for a slot
 * that has no per-entry addressing. A malformed stored value loads as an empty queue.
 */
export function createSnapshotOutboxStore(storage) {
    let entries = null;
    const ensure = async () => {
        if (!entries) {
            const raw = await storage.read();
            const list = Array.isArray(raw) ? raw.filter(isEntry) : [];
            entries = new Map(list.map((e) => [e.id, { ...e }]));
        }
        return entries;
    };
    const save = (m) => storage.write([...m.values()]);
    return {
        async load() {
            return [...(await ensure()).values()].map((e) => ({ ...e }));
        },
        async put(list) {
            const m = await ensure();
            for (const e of list)
                m.set(e.id, { ...e });
            await save(m);
        },
        async remove(ids) {
            const m = await ensure();
            let changed = false;
            for (const id of ids)
                changed = m.delete(id) || changed;
            if (changed)
                await save(m);
        },
    };
}
/** An in-memory {@link OutboxStore} — the queue outlives one outbox, not the process. */
export function createMemoryOutboxStore() {
    let value;
    return createSnapshotOutboxStore({
        read: () => value,
        write: (v) => {
            value = v;
        },
    });
}
/** One lazily-opened database + a transaction runner over its object store. */
function idbRunner(opts) {
    const storeName = opts.storeName ?? "entries";
    let db = null;
    const open = () => {
        db ??= new Promise((resolve, reject) => {
            const req = opts.indexedDB.open(opts.dbName, 1);
            req.onupgradeneeded = () => {
                const created = req.result;
                if (!created.objectStoreNames.contains(storeName))
                    created.createObjectStore(storeName, { keyPath: "id" });
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        }).catch((error) => {
            db = null; // the next call tries again rather than failing forever
            throw error;
        });
        return db;
    };
    return async (mode, body) => {
        const handle = await open();
        return new Promise((resolve, reject) => {
            const tx = handle.transaction(storeName, mode);
            const req = body(tx.objectStore(storeName));
            tx.oncomplete = () => resolve(req ? req.result : undefined);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    };
}
const readAll = async (run) => ((await run("readonly", (s) => s.getAll())) ?? []).filter(isEntry);
export function createIndexedDbOutboxStore(opts) {
    const run = idbRunner(opts);
    return {
        async load() {
            return (await readAll(run))
                .filter((r) => r.partition === opts.partition)
                .map(({ partition: _p, ...entry }) => entry);
        },
        async put(entries) {
            await run("readwrite", (s) => {
                for (const e of entries)
                    s.put(opts.partition === undefined ? e : { ...e, partition: opts.partition });
            });
        },
        async remove(ids) {
            await run("readwrite", (s) => {
                for (const id of ids)
                    s.delete(id);
            });
        },
    };
}
/**
 * The partitions that hold queued entries in one database — so a host can replay every
 * stored queue (e.g. every chat's) at startup or on reconnect without knowing them up front.
 */
export async function listIndexedDbOutboxPartitions(opts) {
    const partitions = new Set();
    for (const r of await readAll(idbRunner(opts)))
        if (typeof r.partition === "string")
            partitions.add(r.partition);
    return [...partitions];
}
/** A connectivity signal the host sets; listeners hear only real transitions. */
export function createOnlineSignal(initial = true) {
    let online = initial;
    const listeners = new Set();
    return {
        isOnline: () => online,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        set(next) {
            if (next === online)
                return;
            online = next;
            for (const l of [...listeners])
                l(next);
        },
    };
}
//# sourceMappingURL=stores.js.map