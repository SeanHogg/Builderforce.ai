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

export type IndexLevel = 0 | 1 | 2 | 3;

/**
 * The fact kinds of PRD 41 B1 (`structure`, `body`, `content`) — memory's `FactKind`. An edit reports the kinds whose
 * hashes really moved (`factIndex.ts`: a comment edit is `content` only); an analyzer pass, or a host without facts,
 * reports all three.
 */
export type FactKind = "structure" | "body" | "content";
export const ALL_FACT_KINDS: readonly FactKind[] = ["structure", "body", "content"];

/** Why the indexer's queue is not draining: the person is typing, the window was long unfocused, or a map pass holds the root. */
export type IndexPauseReason = "typing" | "unfocused" | "pass";

/** Why L3 waits although L2 is ready: on battery, the person not idle long enough, or a review of theirs running. */
export type L3Wait = "battery" | "idle-wait" | "busy";

/** One root's indexing state, as the visualizer renders it. */
export interface IndexLevelStatus {
  rootId: string;
  /** The highest level complete for the root's current files; null before the first plan finished. */
  ready: IndexLevel | null;
  /** The level being computed now; null when nothing runs. */
  working: IndexLevel | null;
  /** Files waiting for L1. */
  pending: number;
  /** Files the last plan listed (L0). */
  files?: number;
  paused?: IndexPauseReason;
  /** Set while L3 is owed but its gate is shut. */
  l3Waiting?: L3Wait;
}

type Listener<T> = (value: T) => void;

/** Listeners per root id; `*` hears every root. */
class Topic<T> {
  private readonly listeners = new Map<string, Set<Listener<T>>>();
  on(rootId: string, cb: Listener<T>): () => void {
    let set = this.listeners.get(rootId);
    if (!set) this.listeners.set(rootId, (set = new Set()));
    set.add(cb);
    return () => { set!.delete(cb); if (set!.size === 0 && this.listeners.get(rootId) === set) this.listeners.delete(rootId); };
  }
  emit(rootId: string, value: T): void {
    for (const key of [rootId, "*"]) {
      for (const cb of [...(this.listeners.get(key) ?? [])]) {
        try { cb(value); } catch { /* a listener's failure never stops the indexer or another listener */ }
      }
    }
  }
}

/** The paths whose facts changed in one step, and which kinds. */
export interface IndexedFacts { rootId: string; paths: readonly string[]; kinds: readonly FactKind[] }

const levels = new Topic<IndexLevelStatus>();
const facts = new Topic<IndexedFacts>();
const lastStatus = new Map<string, IndexLevelStatus>();
const watching = new Set<string>();

export function publishIndexLevel(status: IndexLevelStatus): void {
  lastStatus.set(status.rootId, status);
  levels.emit(status.rootId, status);
}

/** Hears the root's level status; the last one known is replayed at once. */
export function onIndexLevel(rootId: string, cb: Listener<IndexLevelStatus>): () => void {
  const last = lastStatus.get(rootId);
  if (last) cb(last);
  return levels.on(rootId, cb);
}

export const lastIndexLevel = (rootId: string): IndexLevelStatus | undefined => lastStatus.get(rootId);

export function publishIndexedFacts(change: IndexedFacts): void {
  facts.emit(change.rootId, change);
}

export function onIndexedFacts(rootId: string, cb: Listener<IndexedFacts>): () => void {
  return facts.on(rootId, cb);
}

const watchingChanged = new Topic<boolean>();

/** The indexer is watching this root: other watchers of it (the live graph) listen to the bus instead. Listeners hear every change. */
export function setIndexerWatching(rootId: string, on: boolean): void {
  if (on === watching.has(rootId)) return;
  if (on) watching.add(rootId);
  else { watching.delete(rootId); lastStatus.delete(rootId); }
  watchingChanged.emit(rootId, on);
}

export const indexerWatches = (rootId: string): boolean => watching.has(rootId);

/** A preemption: resolves once the pass stopped, with the release of the hold that keeps new passes off. */
export type BackgroundPreemptor = () => Promise<() => void>;

const preemptors = new Map<string, Set<BackgroundPreemptor>>();

/** The indexer's way to be told a person's review needs the root (see {@link preemptBackground}). */
export function registerBackgroundPreemptor(rootId: string, preempt: BackgroundPreemptor): () => void {
  let set = preemptors.get(rootId);
  if (!set) preemptors.set(rootId, (set = new Set()));
  set.add(preempt);
  return () => { set!.delete(preempt); if (set!.size === 0 && preemptors.get(rootId) === set) preemptors.delete(rootId); };
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
export async function preemptBackground(rootId: string): Promise<() => void> {
  const targets = [...preemptors].filter(([id]) => rootId === id || rootId.startsWith(`${id}:`)).flatMap(([, set]) => [...set]);
  const releases = await Promise.all(targets.map((p) => p().catch(() => () => undefined)));
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const release of releases) release();
  };
}

const liveBatches = new Map<string, Set<Promise<void>>>();

/**
 * The live view's own watcher (running while the indexer did not watch the root) has a batch in flight: `done` settles
 * when it has landed. The indexer's first write on the root waits for it ({@link liveWatcherIdle}), so the two never write
 * the root's edited files at once during the hand-over.
 */
export function trackLiveBatch(rootId: string, done: Promise<void>): void {
  let set = liveBatches.get(rootId);
  if (!set) liveBatches.set(rootId, (set = new Set()));
  set.add(done);
  const forget = (): void => { set!.delete(done); if (set!.size === 0 && liveBatches.get(rootId) === set) liveBatches.delete(rootId); };
  void done.then(forget, forget);
}

/** Resolves once no live-view batch is in flight on the root (or after `maxMs`, whichever is first). */
export async function liveWatcherIdle(rootId: string, maxMs: number): Promise<void> {
  const running = [...(liveBatches.get(rootId) ?? [])];
  if (running.length === 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all(running.map((p) => p.catch(() => undefined))),
    new Promise<void>((resolve) => { timer = setTimeout(resolve, maxMs); }),
  ]);
  if (timer) clearTimeout(timer);
}

/** Hears the indexer start or stop watching the root (`builderforce.knowledge.autoIndex` toggled, a folder added or removed). */
export function onIndexerWatching(rootId: string, cb: Listener<boolean>): () => void {
  return watchingChanged.on(rootId, cb);
}
