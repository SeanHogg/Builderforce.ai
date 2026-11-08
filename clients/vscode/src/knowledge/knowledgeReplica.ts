/**
 * The editor's REPLICA HOST (PRD 41 A7, A11): one persisted dirty set and one pump per linked root, in this
 * process. The review writes its local store and marks what changed for the linked project
 * (`replicatedKnowledgeStore`); this module owns what happens to the dirty set afterwards:
 *
 *   queue    `.builderforce/knowledge/<root>.dirty.json` (keys, plus the server's last ack), written atomically
 *            (temp, then rename), bound to ONE project, shared by every opener of the root. An op log an older
 *            version left (`<root>.replica.json`) is converted to keys on first load, then deleted;
 *   pump     sends ONE pack when a review finishes, when the workspace opens with keys waiting, and, while files
 *            change, at most once every 60 s after a live edit marked one. It never sends while the root is being reviewed, only the
 *            window holding the root's lock pumps (`replicaLock.ts`), and it is bound to the project
 *            of its client: a project switch aborts it, discards the other project's queue and starts
 *            a fresh pump with the new client. It is stopped on dispose; the queue resumes next time;
 *   quiet    a HEALTHY linked root with nothing to send (no keys, no failures, not paused on auth/project) still starts a pump every
 *            `GENERATION_CHECK_INTERVAL_MS` (one timer per root, unref'd, skipped while a pump or a review runs, and cleared once the
 *            root no longer resolves to the project its queue is bound to). Failures and auth pauses are restarted by Retry upload and
 *            sign-in (`retryReplica`, `resumeAuthPaused`), never by this timer. It also runs on workspace open: the pump then reads the server's generation, so a root
 *            the server invalidated (a healed body) reconciles. This timer is also the ONLY signal for the uploader's own other paths
 *            after a legacy per-hash upload heal (that response carries no `reconcile` flag).
 *   state    kept per root in memory ({@link ReplicaState}) and read by the sync status.
 *
 * Nothing here can fail a review: the pump reports into the state, never into the caller.
 */

import {
  GENERATION_CHECK_INTERVAL_MS, analysisPendingFileName, createReplicaQueue, currentSourcesOf, dirtyFileName, emptyReplicaState, enqueueFirstSync, pumpReplica, replicaFileName, replicatedKnowledgeStore,
  type KnowledgeFiles, type ReadThrough, type ReplicaPersistence, type ReplicaQueue, type ReplicaState,
} from "@builderforce/agent-tools/knowledge";
import type { KnowledgeClient } from "@builderforce/knowledge-client";
import type { IngestManifest } from "@seanhogg/builderforce-memory/ingest";
import type { KnowledgeStore } from "@seanhogg/builderforce-memory/knowledge";
import { acquireReplicaLock } from "./replicaLock";

/** A live edit's mark waits this long for more (never during a review). */
const KICK_DEBOUNCE_MS = 1500;
/** While files change, a pack is sent at most this often; a review's end sends at once. */
export const MIN_SEND_INTERVAL_MS = 60_000;
/** A background pump gives up (paused: unreachable) after this many transient failures in a row, instead of retrying for ever. */
export const BACKGROUND_TRANSIENT_STREAK = 8;

/** Which project each root's local snapshot was first-synced to (`globalState`), set once the first sync has DRAINED. */
export interface UploadMarks {
  get(rootId: string): number | undefined;
  set(rootId: string, projectId: number): Promise<void>;
}

interface Entry {
  queue: ReplicaQueue;
  state: ReplicaState;
  abort?: AbortController;
  running?: Promise<void>;
  /** The project of the running pump. */
  projectId?: number;
  reviewing: number;
  waiters: Array<() => void>;
  timer?: ReturnType<typeof setTimeout>;
  /** The quiet-root timer: starts a pump every `GENERATION_CHECK_INTERVAL_MS` (see {@link armQuietCheck}). */
  quiet?: ReturnType<typeof setInterval>;
  /** The CURRENT pump source of the linked root (set by `replicatedStoreOf`): the timer never starts a stale one. */
  resolve?: () => PumpSource | undefined;
  /** The saved queue did not parse: the first sync is queued again whatever the marks say. */
  corrupt: boolean;
  /** Epoch ms the last pump started: live edits wait until `MIN_SEND_INTERVAL_MS` after it. */
  lastStartAt?: number;
  /** The source of the last pump, so a sign-in can restart one that paused on auth. */
  lastSource?: PumpSource;
  /** Runs once the queue has drained for `projectId` (marks the first sync done). */
  pendingMark?: { projectId: number; run: () => Promise<void> };
}

/** Where the replica host reports (set once by the knowledge host; silent until then and in tests). */
let report: (what: string, error: unknown) => void = () => undefined;
export function configureReplicaLog(cb: (what: string, error: unknown) => void): void { report = cb; }

const entries = new Map<string, Entry>();
const listeners = new Set<(rootId: string, state: ReplicaState) => void>();

/** The queue file, written atomically: a crash leaves the old file or the new one, never half of either. */
function persistenceOf(files: KnowledgeFiles, name: string): ReplicaPersistence {
  return {
    read: () => files.read(name),
    async write(text) {
      if (!files.rename) { await files.write(name, text); return; }
      const temp = `${name}.tmp`;
      await files.write(temp, text);
      await files.rename(temp, name);
    },
    keepAside: (text) => files.write(`${name}.corrupt`, text),
    ...(files.remove ? { remove: () => files.remove!(name) } : {}),
  };
}

const entryOf = (rootId: string, files: KnowledgeFiles): Entry => {
  let held = entries.get(rootId);
  if (!held) {
    const made: Entry = {
      queue: createReplicaQueue(persistenceOf(files, dirtyFileName(rootId)), {
        legacy: persistenceOf(files, replicaFileName(rootId)),
        analysis: persistenceOf(files, analysisPendingFileName(rootId)),
        onError: (error) => report("replica queue", error),
        onCorrupt: () => { made.corrupt = true; },
      }),
      state: emptyReplicaState(), reviewing: 0, waiters: [], corrupt: false,
    };
    entries.set(rootId, made);
    held = made;
  }
  return held;
};

/** The root's replica queue: ONE per root in this process. */
export const replicaQueueFor = (rootId: string, files: KnowledgeFiles): ReplicaQueue => entryOf(rootId, files).queue;

/** The root's replica state, with the queue's current length. */
export async function replicaStatusOf(rootId: string, files: KnowledgeFiles): Promise<ReplicaState> {
  const held = entryOf(rootId, files);
  return { ...held.state, failed: [...held.state.failed], dirty: await held.queue.size() };
}

export function onReplicaState(cb: (rootId: string, state: ReplicaState) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** What a pump needs, read when it starts (the client and store may change with the linked project). */
export interface PumpSource {
  rootId: string;
  files: KnowledgeFiles;
  local: KnowledgeStore;
  client: KnowledgeClient;
  /** The project `client` talks to. */
  projectId: number;
  /** The root's manifest: the current sources (path and content hash) the pack is built from. */
  manifest: IngestManifest;
  /** A source's size in bytes (root-relative path), from the directory source's stat cache; absent when unknown. */
  sizeOf?: (path: string) => number | undefined;
}

/** The server's copy as the seed reads it: extracted output by hash, and the root's human-authored facts. */
function readThroughOf(pump: PumpSource): ReadThrough {
  const { client, rootId } = pump;
  return {
    preloadExtracted: async (hashes) => { await client.store.preloadExtracted?.(hashes); },
    getExtracted: (hash) => client.store.getExtracted?.(hash) ?? Promise.resolve(undefined),
    async humanKnowledge() {
      const [facts, relations] = await Promise.all([client.facts(rootId), client.store.relations({ rootId })]);
      return { facts: (facts?.facts ?? []).filter((f) => f.origin === "human"), relations: relations.filter((r) => r.origin === "human") };
    },
  };
}

/**
 * The store every review of the root uses: its ONE local store, wrapped for replication. Linked
 * (`pump` given), writes are queued for the pump's project; `readThrough` is the "Use the server's
 * copy" seed. `resolve` gives the CURRENT pump source when a queued live edit kicks the pump, so a
 * pump never starts with the client of a project the workspace has left.
 */
export function replicatedStoreOf(
  rootId: string, files: KnowledgeFiles, local: KnowledgeStore, pump: PumpSource | undefined, readThrough: boolean,
  resolve: () => PumpSource | undefined = () => pump,
): KnowledgeStore {
  if (pump) entryOf(rootId, files).resolve = resolve;
  return replicatedKnowledgeStore({
    local,
    rootId,
    queue: replicaQueueFor(rootId, files),
    ...(pump ? {
      // What the last local review held: a file is marked dirty only when its hash differs from it.
      knownHashes: async () => new Map((await currentSourcesOf(pump.manifest, rootId)).map((s) => [s.ref, s.hash] as const)),
      replica: { projectId: pump.projectId, ...(readThrough ? { readThrough: readThroughOf(pump) } : {}) },
      onQueued: () => kickReplicaPump(rootId, files, resolve),
    } : {}),
    onError: (error) => report("replica", error),
  });
}

/** Runs a review of the root: the pump waits for its end, then drains the queue off the review's path. */
export async function duringReview<T>(rootId: string, files: KnowledgeFiles, pump: PumpSource | undefined, run: () => Promise<T>): Promise<T> {
  setRootReviewing(rootId, files, true);
  try {
    return await run();
  } finally {
    setRootReviewing(rootId, files, false);
    if (pump) void startReplicaPump(pump);
  }
}

/** Marks a review of the root as running or ended: a pump waits for the end. */
export function setRootReviewing(rootId: string, files: KnowledgeFiles, active: boolean): void {
  const held = entryOf(rootId, files);
  held.reviewing = Math.max(0, held.reviewing + (active ? 1 : -1));
  if (held.reviewing === 0) for (const wake of held.waiters.splice(0)) wake();
}

/** Whether a review of the root is running (or held, like a Retry marking files owed) anywhere in this process. */
export const isRootReviewing = (rootId: string): boolean => (entries.get(rootId)?.reviewing ?? 0) > 0;

/** Resolves when no review of the root is running, or the pump is stopped. */
function waitNotReviewing(held: Entry, signal: AbortSignal): Promise<void> {
  if (held.reviewing === 0 || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = (): void => { signal.removeEventListener("abort", done); resolve(); };
    held.waiters.push(done);
    signal.addEventListener("abort", done, { once: true });
  });
}

/** Resolves when the root's running pump (if any) has stopped. */
export const replicaDrained = (rootId: string): Promise<void> => entries.get(rootId)?.running ?? Promise.resolve();

/** Stops the root's pump (unlinked, or linked to another project) and waits for it to end. */
export async function stopReplicaPump(rootId: string): Promise<void> {
  const held = entries.get(rootId);
  if (!held) return;
  if (held.timer) { clearTimeout(held.timer); held.timer = undefined; }
  if (held.quiet) { clearInterval(held.quiet); held.quiet = undefined; }
  held.abort?.abort();
  await held.running;
}

/**
 * One timer per linked root: every `GENERATION_CHECK_INTERVAL_MS` it starts a pump unless one or a review is running, and asks the
 * pump to read the server's generation (the previous check time is forgotten, so it is never skipped as "recent"). Unref'd, and
 * cleared by `stopReplicaPump` and `disposeReplicas`.
 */
function armQuietCheck(held: Entry): void {
  if (held.quiet) return;
  held.quiet = setInterval(() => { void quietTick(held).catch((error) => report("replica quiet check", error)); }, GENERATION_CHECK_INTERVAL_MS);
  (held.quiet as { unref?: () => void }).unref?.();
}

async function quietTick(held: Entry): Promise<void> {
  if (held.running || held.reviewing > 0) return;
  const source = (held.resolve ?? (() => held.lastSource))();
  if (!source || (await held.queue.projectId()) !== source.projectId) {
    // Unlinked, the folder left the workspace, or the queue moved to another project: nothing here to check any more.
    if (held.quiet) { clearInterval(held.quiet); held.quiet = undefined; }
    return;
  }
  // Only a quiet, healthy root: a failed one waits for Retry upload, an auth-paused one for sign-in (unreachable may recover by itself).
  if ((await held.queue.size()) > 0 || held.state.failed.length > 0 || (held.state.paused !== undefined && held.state.paused !== "unreachable")) return;
  const { generationCheckedAt: _checked, ...rest } = held.state;
  held.state = rest; // forget the last check, so this pump really asks the server
  void startReplicaPump(source, { probe: true });
}

/**
 * Starts draining the root's queue unless a pump for the SAME project is already running (one for
 * another project is stopped first). Never throws; resolves when the pump has stopped.
 */
export async function startReplicaPump(source: PumpSource, opts: { probe?: boolean } = {}): Promise<void> {
  const held = entryOf(source.rootId, source.files);
  if (held.running) {
    if (held.projectId === source.projectId) return held.running;
    await stopReplicaPump(source.rootId);
  }
  const abort = new AbortController();
  held.abort = abort;
  held.projectId = source.projectId;
  held.lastSource = source;
  if (!opts.probe) held.lastStartAt = Date.now(); // only real sends delay a live edit's pump
  armQuietCheck(held);
  const running: Promise<void> = (async () => {
    // Only the window holding the lock pumps: another window's pump on this folder is not ours to double.
    const lock = await acquireReplicaLock(source.files, source.rootId).catch(() => undefined);
    if (!lock) return;
    try {
      const state = await pumpReplica({
        queue: held.queue, local: source.local, client: source.client, signal: abort.signal, initial: held.state,
        projectId: source.projectId, rootId: source.rootId, maxTransientStreak: BACKGROUND_TRANSIENT_STREAK, sources: async () => (await currentSourcesOf(source.manifest, source.rootId)).map((s) => {
          const bytes = source.sizeOf?.(s.ref.slice(s.ref.indexOf("::") + 2));
          return bytes === undefined ? s : { ...s, bytes };
        }),
        idle: (signal) => waitNotReviewing(held, signal),
        onState: (next) => {
          held.state = next;
          for (const cb of [...listeners]) { try { cb(source.rootId, next); } catch { /* a listener never stops the pump */ } }
        },
      });
      const mark = held.pendingMark;
      if (mark && mark.projectId === source.projectId && !abort.signal.aborted && state.dirty === 0 && !state.paused && state.failed.length === 0) {
        held.pendingMark = undefined;
        await mark.run();
      }
    } catch (error) {
      report("replica pump", error);
    } finally {
      await lock.release();
    }
  })().finally(() => {
    if (held.abort === abort) { held.running = undefined; held.abort = undefined; }
  });
  held.running = running;
  return running;
}

/**
 * Retry upload (the Reviews panel's Server tab): forgets the root's recorded failures and drains its queue now, through the pump's
 * own entry (`startReplicaPump`), not on the live-edit schedule. The queue keeps what failed, so nothing is lost; a pump already
 * running is left to finish (it is retrying already). Never throws. RETURNS ONCE THE PUMP HAS STARTED, never when it ends: an upload can outlast any request timeout, so the caller follows it through the sync status (the view polls it while the replica sends).
 */
export function retryReplica(source: PumpSource): void {
  const held = entryOf(source.rootId, source.files);
  if (held.timer) { clearTimeout(held.timer); held.timer = undefined; }
  if (!held.running) {
    const { paused: _paused, pausedStatus: _pausedStatus, waitingUntil: _waitingUntil, waitingFor: _waitingFor, ...rest } = held.state;
    held.state = { ...rest, failed: [] };
    for (const cb of [...listeners]) { try { cb(source.rootId, held.state); } catch { /* a listener never stops the pump */ } }
  }
  void startReplicaPump(source);
}

/** The person signed in again: every pump that paused on auth (401/403) resumes with its queue intact. */
export async function resumeAuthPaused(): Promise<void> {
  await Promise.all([...entries.values()]
    .filter((e) => e.state.paused === "auth" && e.lastSource && !e.running)
    .map((e) => startReplicaPump(e.lastSource!)));
}

/** A live edit marked a key: send a pack, at most once a minute, unless a review is running (its end starts the pump). */
export function kickReplicaPump(rootId: string, files: KnowledgeFiles, resolve: () => PumpSource | undefined): void {
  const held = entryOf(rootId, files);
  if (held.timer) clearTimeout(held.timer);
  const wait = Math.max(KICK_DEBOUNCE_MS, (held.lastStartAt ?? 0) + MIN_SEND_INTERVAL_MS - Date.now());
  held.timer = setTimeout(() => {
    held.timer = undefined;
    if (held.reviewing > 0) return;
    const source = resolve(); // resolved NOW: the project may have changed since the key was marked
    if (source) void startReplicaPump(source);
  }, wait);
}

/** Starts the pump when the workspace opens with a queue bound to this project (keys to send, an ack to check, or a reconcile owed). */
export async function resumeReplica(source: PumpSource): Promise<void> {
  const queue = entryOf(source.rootId, source.files).queue;
  if ((await queue.projectId()) !== source.projectId) return;
  // Keys waiting, an ack to check against the server's generation, or NO ack (a reconcile is owed: it compares manifests, cheaply
  // equal when nothing differs): a queue bound to this project always gets a pump on open.
  void startReplicaPump(source);
}

/**
 * The first-sync case: a root reviewed before it was linked (or linked to another project) is queued
 * whole, once per project. The mark is set only when the queue has DRAINED, so a sync that never
 * finished is queued again. A project change stops the old pump and discards the other project's queue;
 * a queue that did not parse is rebuilt from the local snapshot. Returns whether anything was queued.
 */
export async function queueFirstSyncOnce(args: PumpSource & { manifest: IngestManifest; marks: UploadMarks }): Promise<boolean> {
  const { rootId, marks, projectId } = args;
  const held = entryOf(rootId, args.files);
  if (held.running && held.projectId !== projectId) await stopReplicaPump(rootId);
  await held.queue.size(); // loads the file, so a corrupt one is known
  const rebuild = held.corrupt;
  held.corrupt = false;
  await held.queue.adopt(projectId);
  if (!rebuild && marks.get(rootId) === projectId) return false;
  const counts = await enqueueFirstSync({ rootId, local: args.local, manifest: args.manifest, queue: held.queue });
  if (!counts) return false;
  await held.queue.flush();
  held.pendingMark = { projectId, run: () => marks.set(rootId, projectId) };
  void startReplicaPump(args);
  return true;
}

/** Makes every queue durable, then stops every pump and timer (extension deactivate). The queues stay on disk. */
export async function disposeReplicas(): Promise<void> {
  const all = [...entries.values()];
  await Promise.all(all.map((e) => e.queue.flush().catch(() => undefined)));
  for (const held of all) {
    if (held.timer) clearTimeout(held.timer);
    if (held.quiet) clearInterval(held.quiet);
    held.abort?.abort();
  }
  await Promise.all(all.map((e) => e.running));
  await Promise.all(all.map((e) => e.queue.flush().catch(() => undefined)));
  entries.clear();
  listeners.clear();
}
