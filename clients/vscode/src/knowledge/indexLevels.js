/**
 * The background indexer's levels (PRD 41 B6) and the ONE in-process bus that carries them — pure, no `vscode`:
 *
 *   L0 — the plan: tree, manifest, sizes (the stat prefilter + Merkle walk);
 *   L1 — per-file facts (open and visible files first, then the rest in the background);
 *   L2 — derived knowledge: the file/symbol graph and its findings (today derived when the graph is built);
 *   L3 — the bundled analyzers' findings, only when idle and on mains power (§12.3).
 *
 * The bus has two topics: a root's level status (for the visualizer's level indicator, `knowledgeProtocol` `level`
 * event) and the paths whose facts changed (the live graph re-reads on them instead of running a watcher of its own).
 */
export const ALL_FACT_KINDS = ["structure", "body", "content"];
/** Listeners per root id; `*` hears every root. */
class Topic {
    listeners = new Map();
    on(rootId, cb) {
        let set = this.listeners.get(rootId);
        if (!set)
            this.listeners.set(rootId, (set = new Set()));
        set.add(cb);
        return () => { set.delete(cb); if (set.size === 0 && this.listeners.get(rootId) === set)
            this.listeners.delete(rootId); };
    }
    emit(rootId, value) {
        for (const key of [rootId, "*"]) {
            for (const cb of [...(this.listeners.get(key) ?? [])]) {
                try {
                    cb(value);
                }
                catch { /* a listener's failure never stops the indexer or another listener */ }
            }
        }
    }
}
const levels = new Topic();
const facts = new Topic();
const lastStatus = new Map();
const watching = new Set();
export function publishIndexLevel(status) {
    lastStatus.set(status.rootId, status);
    levels.emit(status.rootId, status);
}
/** Hears the root's level status; the last one known is replayed at once. */
export function onIndexLevel(rootId, cb) {
    const last = lastStatus.get(rootId);
    if (last)
        cb(last);
    return levels.on(rootId, cb);
}
export const lastIndexLevel = (rootId) => lastStatus.get(rootId);
export function publishIndexedFacts(change) {
    facts.emit(change.rootId, change);
}
export function onIndexedFacts(rootId, cb) {
    return facts.on(rootId, cb);
}
const watchingChanged = new Topic();
/** The indexer is watching this root: other watchers of it (the live graph) listen to the bus instead. Listeners hear every change. */
export function setIndexerWatching(rootId, on) {
    if (on === watching.has(rootId))
        return;
    if (on)
        watching.add(rootId);
    else {
        watching.delete(rootId);
        lastStatus.delete(rootId);
    }
    watchingChanged.emit(rootId, on);
}
export const indexerWatches = (rootId) => watching.has(rootId);
const preemptors = new Map();
/** The indexer's way to be told a person's review needs the root (see {@link preemptBackground}). */
export function registerBackgroundPreemptor(rootId, preempt) {
    let set = preemptors.get(rootId);
    if (!set)
        preemptors.set(rootId, (set = new Set()));
    set.add(preempt);
    return () => { set.delete(preempt); if (set.size === 0 && preemptors.get(rootId) === set)
        preemptors.delete(rootId); };
}
/**
 * THE seam a person's review, Retry and Exclude call before they check "a review is already running": the background
 * indexer's map or L3 pass is aborted and awaited (what it did not finish stays owed and reruns after), and new passes
 * are held off until the returned release is called — the caller releases once its own review hold is taken (or it
 * ended), so a background pass never refuses, delays or slips in ahead of the person's work.
 *
 * A sub-folder root (`<folder root id>:<rel>`) is inside its workspace folder's indexer: that one is preempted too.
 * Resolves at once (with a no-op release) when nothing is registered.
 */
export async function preemptBackground(rootId) {
    const targets = [...preemptors].filter(([id]) => rootId === id || rootId.startsWith(`${id}:`)).flatMap(([, set]) => [...set]);
    const releases = await Promise.all(targets.map((p) => p().catch(() => () => undefined)));
    let released = false;
    return () => {
        if (released)
            return;
        released = true;
        for (const release of releases)
            release();
    };
}
const liveBatches = new Map();
/**
 * The live view's own watcher (running while the indexer did not watch the root) has a batch in flight: `done` settles
 * when it has landed. The indexer's first write on the root waits for it ({@link liveWatcherIdle}), so the two never write
 * the root's edited files at once during the hand-over.
 */
export function trackLiveBatch(rootId, done) {
    let set = liveBatches.get(rootId);
    if (!set)
        liveBatches.set(rootId, (set = new Set()));
    set.add(done);
    const forget = () => { set.delete(done); if (set.size === 0 && liveBatches.get(rootId) === set)
        liveBatches.delete(rootId); };
    void done.then(forget, forget);
}
/** Resolves once no live-view batch is in flight on the root (or after `maxMs`, whichever is first). */
export async function liveWatcherIdle(rootId, maxMs) {
    const running = [...(liveBatches.get(rootId) ?? [])];
    if (running.length === 0)
        return;
    let timer;
    await Promise.race([
        Promise.all(running.map((p) => p.catch(() => undefined))),
        new Promise((resolve) => { timer = setTimeout(resolve, maxMs); }),
    ]);
    if (timer)
        clearTimeout(timer);
}
/** Hears the indexer start or stop watching the root (`builderforce.knowledge.autoIndex` toggled, a folder added or removed). */
export function onIndexerWatching(rootId, cb) {
    return watchingChanged.on(rootId, cb);
}
//# sourceMappingURL=indexLevels.js.map