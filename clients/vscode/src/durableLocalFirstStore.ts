/**
 * The VSIX host's durable local-first store over a directory (G03/G26).
 *
 * Commit boundary for writes this store owns: a transaction is one journal frame — a
 * delta of just the rows (and sync events) the callback put/appended — fsynced to
 * `local-first-v3.journal` before the promise resolves. A commit costs O(rows it changed);
 * it never exports, encodes or listens to the whole store. `local-first-v1.json` is a cache
 * written only by `flush()`: deleting it does not drop committed rows, and a corrupt one
 * is moved aside.
 *
 * Every commit runs under the cross-process file lock (`localFirstLock.ts`) and first
 * catches up with whatever another window committed since this process last saw the
 * journal — a positional read of the new tail, applied as deltas (`localFirstJournalIo.ts`).
 * Only a different file (another window compacted) costs a full reload. The journal's tail
 * is compacted on the shared `shouldCompactJournal` policy, OFF the commit path: after a
 * commit resolves, a compaction job is queued on the same serial queue (this window's commits
 * wait for it; other windows do not). It streams the store as small frames WITHOUT the
 * cross-window lock, then holds the lock only to catch up the tail and rename.
 *
 * No `vscode` import: `bootVsixHost` opens the same store over a plain directory, and
 * `createVsCodeLocalFirstStore` over global storage.
 */

import nodeFs from "node:fs";
import nodePath from "node:path";
import {
  EMPTY_LOCAL_FIRST_SNAPSHOT,
  INDEXEDDB_REDACTION_RULE,
  createMemoryLocalFirstStore,
  encodeDeltaFrame,
  encodeJournalFrame,
  redactSnapshotForUploadOrLog,
  resetDeltaOf,
  shouldCompactJournal,
  type JournalCompactionPolicy,
  type LocalFirstDelta,
  type LocalFirstListener,
  type LocalFirstSnapshot,
  type LocalFirstStore,
  type MemoryLocalFirstStore,
} from "@builderforce/local-first";
import { LOCAL_FIRST_OPEN_BUSY_TIMEOUT_MS, createLocalFirstFileLock, type LocalFirstFileLockOptions } from "./localFirstLock";
import { legacyMoved, readLegacyMerge, writeLegacyBaseline } from "./localFirstLegacyMerge";
import { createRecovery } from "./durableLocalFirstRecovery";
import { writeSnapshotCache } from "./localFirstSnapshotCacheWrite";
import { compactJournal } from "./localFirstCompaction";
import { createCompactionBackoff, type CompactionBackoff } from "./localFirstCompactionBackoff";
import { createNodeJournalIo, yieldToEventLoop, type JournalStageTiming, type LoadedJournal, type TailRead } from "./localFirstJournalIo";
import {
  checkSnapshotCache,
  hasLegacyState,
  removeOrphanedTemporaries,
} from "./localFirstMigration";
import { hostLog } from "./hostLog";

const fs = nodeFs.promises;

export const SNAPSHOT_FILE = "local-first-v1.json";
export const LOCK_FILE = "local-first-v1.lock";

/** A commit slower than this is reported through `onSlowCommit`. */
const SLOW_COMMIT_MS = 250;

/**
 * Stage timings for the first import and every commit. Off by default (zero overhead);
 * `BUILDERFORCE_LOCAL_FIRST_PERF` enables them, emitted through the host debug log.
 */
const envPerfFlag = (): boolean => {
  const value = process.env.BUILDERFORCE_LOCAL_FIRST_PERF;
  return value !== undefined && value !== "0" && value.toLowerCase() !== "false";
};

/** Journal-backed store. `local-first-v1.json` is a cache written by `flush()`, not the commit. */
export interface DurableLocalFirstStore extends LocalFirstStore {
  flush(): Promise<void>;
  readonly snapshotFile: string;
  readonly journalFile: string;
  /**
   * Only snapshot eligible to be uploaded or logged.
   * Rule: `VSIX_LOCAL_FIRST_REDACTION_RULE`, which is `INDEXEDDB_REDACTION_RULE`.
   */
  exportForUploadOrLog(): Promise<LocalFirstSnapshot>;
}

/**
 * Stated redaction rule for this surface. Identical to the IndexedDB adapter:
 * only `exportForUploadOrLog()` may leave the device. Not a second policy.
 */
export const VSIX_LOCAL_FIRST_REDACTION_RULE = INDEXEDDB_REDACTION_RULE;

export interface DurableLocalFirstStoreOptions {
  /** Awaited before the first commit (the device id becoming durable, G04). */
  beforeWrite?: Promise<void>;
  /** Overrides the shared compaction thresholds (tests). */
  compaction?: Partial<JournalCompactionPolicy>;
  lock?: LocalFirstFileLockOptions;
  /** Pause between failed compactions (default: real clock, 30 s doubling to 15 min). Tests inject one. */
  compactionBackoff?: CompactionBackoff;
  /** A cache write or a compaction failed after the commit was durable. Default `console.warn`. */
  onBackgroundError?: (error: unknown) => void;
  /** A commit took longer than 250 ms: how long, and the size of the frame it appended. */
  onSlowCommit?: (ms: number, frameBytes: number) => void;
  /**
   * Stage timings for the first import and every commit. Off by default (zero overhead);
   * `localFirstStore.ts` fills it from the `BUILDERFORCE_LOCAL_FIRST_PERF` env flag.
   */
  onStageTiming?: (timing: JournalStageTiming) => void;
}

export function createDurableLocalFirstStore(
  directory: string,
  options: DurableLocalFirstStoreOptions = {},
): DurableLocalFirstStore {
  const snapshotFile = nodePath.join(directory, SNAPSHOT_FILE);
  // Timings are opt-in: a caller's `onStageTiming`, else the BUILDERFORCE_LOCAL_FIRST_PERF
  // env flag through the host debug log. With neither, no clock is read (zero overhead).
  const onStageTiming = options.onStageTiming
    ?? (envPerfFlag()
      ? ({ stage, ms, detail }: JournalStageTiming) =>
          hostLog(`local-first perf: ${stage} ${ms}ms${detail ? ` (${detail})` : ""}`)
      : undefined);
  const io = createNodeJournalIo(directory, { onStageTiming });
  const lock = createLocalFirstFileLock(nodePath.join(directory, LOCK_FILE), options.lock);
  const beforeWrite = options.beforeWrite ?? Promise.resolve();
  const compactionBackoff = options.compactionBackoff ?? createCompactionBackoff();
  const onBackgroundError = options.onBackgroundError
    ?? ((error: unknown) => console.warn("local-first: background write failed", error));
  // An open or import holds the lock far longer than a commit does (a measured 3.3 s import).
  const openWaitMs = options.lock?.busyTimeoutMs ?? LOCAL_FIRST_OPEN_BUSY_TIMEOUT_MS;
  const listeners = new Set<LocalFirstListener>();
  let quiet = false;
  let opened: Promise<void> | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  let inTransaction = false;
  /** Set while a commit (or compaction) holding the lock catches up; readers wait for it. `mergeLegacyWrites` also
   *  catches up under the lock unpublished: safe only as every read awaits `ensureOpen`, so it must stay inside the open. */
  let catchingUp: Promise<void> | undefined;
  let commitGeneration = 0;
  let dirty = false;
  let lastFrameBytes = 0;
  let compactionPending = false;

  /** The delta applied to the memory store's own rows — the state a first frame must hold. */
  const snapshotAfter = (delta: LocalFirstDelta): LocalFirstSnapshot => {
    const draft = createMemoryLocalFirstStore(memory.view());
    draft.applyDelta(delta);
    return draft.view();
  };

  const memory: MemoryLocalFirstStore = createMemoryLocalFirstStore(undefined, {
    // The commit boundary: the memory store publishes the commit only after this resolves.
    onCommit: async (delta) => {
      // An empty journal opens with a whole-snapshot frame (a base); every later commit is a delta.
      const serializeStart = onStageTiming ? Date.now() : 0;
      const frame = io.frames() === 0 ? encodeJournalFrame(snapshotAfter(delta)) : encodeDeltaFrame(delta);
      if (onStageTiming) onStageTiming({ stage: "commit.serialize", ms: Date.now() - serializeStart, detail: `${frame.byteLength} bytes` });
      lastFrameBytes = frame.byteLength;
      await io.append(frame);
    },
  });
  memory.subscribe((change) => {
    if (quiet) return;
    for (const listener of [...listeners]) listener(change);
  });

  /** Adopt a loaded journal as the store's state. `silent` for the open, which nobody is waiting on. */
  const adopt = (loaded: LoadedJournal, silent: boolean): void => {
    io.adopt(loaded);
    replaceMemory(loaded.latest ?? EMPTY_LOCAL_FIRST_SNAPSHOT, silent);
  };

  const replaceMemory = (snapshot: LocalFirstSnapshot, silent: boolean): void => {
    const rebuildStart = onStageTiming ? Date.now() : 0;
    quiet = silent;
    try {
      memory.applyDelta(resetDeltaOf(snapshot));
    } finally {
      quiet = false;
    }
    if (onStageTiming) onStageTiming({ stage: "import.rebuild", ms: Date.now() - rebuildStart });
  };

  // The one-time v2 import, the damaged-v3 rebuild and the pre-v3 copy's retirement (`durableLocalFirstRecovery.ts`).
  const { importLegacy, rebuildCorrupt, retirePreV3Snapshot } = createRecovery({
    directory, snapshotFile, io, lock, openWaitMs, onBackgroundError, adopt, replaceMemory,
  });

  /**
   * Writes an old window made to v2 after the import (`localFirstLegacyMerge.ts`). A lock-free
   * check first — one stat plus the sidecar — so the usual open never takes the lock; then, under
   * it and caught up with v3, merge what the baseline says is new as ONE v3 commit and move the baseline.
   */
  const mergeLegacyWrites = async (): Promise<void> => {
    if (!(await legacyMoved(directory))) return;
    await lock.acquire(openWaitMs);
    try {
      await refreshForCommit();
      const merge = await readLegacyMerge(directory, memory.view(), yieldToEventLoop);
      if (!merge) return;
      if (merge.delta) {
        await io.append(encodeDeltaFrame(merge.delta));
        memory.applyDelta(merge.delta);
        dirty = true;
      }
      await writeLegacyBaseline(directory, merge.baseline);
      if (merge.delta) onBackgroundError(new Error(`local-first: merged ${merge.rows} rows and ${merge.events} events an older window wrote to the v2 journal`));
    } finally {
      await lock.release();
    }
  };

  const openStore = async (): Promise<void> => {
    const loaded = await io.load(yieldToEventLoop);
    if (loaded.corrupt) {
      await importLegacy();
    } else if (loaded.latest) {
      adopt(loaded, true);
      // The journal is the record, so the cache is not imported — but a small corrupt cache
      // is still moved aside here. Failing to do so must not fail the open.
      await checkSnapshotCache(snapshotFile).catch(onBackgroundError);
      await mergeLegacyWrites().catch(onBackgroundError);
      // v3 is live and healthy: the pre-v3 rollback copy only costs disk now.
      await retirePreV3Snapshot();
    } else if (await hasLegacyState(directory, snapshotFile)) {
      await importLegacy();
    } else {
      adopt(loaded, true);
    }
    await removeOrphanedTemporaries(directory);
  };

  /** Never call this while holding the lock: an import takes it. */
  const ensureOpen = (): Promise<void> => {
    const openedAt = onStageTiming ? Date.now() : 0;
    opened ??= openStore().then(() => {
      if (onStageTiming) onStageTiming({ stage: "import.open", ms: Date.now() - openedAt });
    }).catch((error: unknown) => {
      opened = undefined;
      throw error;
    });
    return opened;
  };

  const applyTail = (read: Extract<TailRead, { kind: "deltas" }>): void => {
    for (const delta of read.deltas) memory.applyDelta(delta);
    io.advance(read);
  };

  /**
   * Under the lock: another window committed since this process last saw the journal, so
   * catch up before committing on top of it — its new frames, or a reload if it compacted.
   */
  const refreshForCommit = async (): Promise<void> => {
    const read = await io.readTail();
    if (read.kind === "deltas") applyTail(read);
    else if (read.kind === "reload") {
      const loaded = await io.load(yieldToEventLoop);
      if (loaded.corrupt) await rebuildCorrupt(loaded, io.frames() > 0 ? memory.view() : undefined); // only state this window really tracked
      else adopt(loaded, false);
    }
  };

  /**
   * Lock-free readers see another window's commits too. A read never waits on a running
   * commit's WORK, never truncates, and discards what it read if a commit started or landed (or
   * another read overtook it) meanwhile — the commit's own refresh is the authoritative one, so
   * a read that discarded waits for that refresh (`catchingUp`) rather than return state that
   * predates a commit another window already finished.
   */
  const refreshForRead = async (): Promise<void> => {
    await readTailIfIdle();
    const pending = catchingUp, epoch = io.epoch();
    await pending;
    if (pending && io.epoch() === epoch) await readTailIfIdle(); // catch-up threw: look once more, never loop
  };

  const readTailIfIdle = async (): Promise<void> => {
    await ensureOpen();
    if (inTransaction) return;
    const generation = commitGeneration;
    const epoch = io.epoch();
    const stale = (): boolean => inTransaction || generation !== commitGeneration || epoch !== io.epoch();
    const read = await io.readTail();
    if (read.kind === "unchanged" || stale()) return;
    if (read.kind === "deltas") {
      applyTail(read);
      return;
    }
    const loaded = await io.load(yieldToEventLoop);
    // A damaged journal is left for the next commit (under the lock) to set aside and rebuild.
    if (stale() || loaded.corrupt) return;
    adopt(loaded, false);
  };

  const serialized = <T,>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work);
    tail = run.then(() => undefined, () => undefined);
    return run;
  };

  /** Run `work` as the lock holder, with lock-free readers held off. */
  const exclusive = async <T,>(work: () => Promise<T>): Promise<T> => {
    await ensureOpen();
    await fs.mkdir(directory, { recursive: true });
    const lockStart = onStageTiming ? Date.now() : 0;
    await lock.acquire();
    if (onStageTiming) onStageTiming({ stage: "commit.lock", ms: lockStart ? Date.now() - lockStart : 0 });
    inTransaction = true;
    commitGeneration += 1;
    let caughtUp!: () => void;
    catchingUp = new Promise<void>((resolve) => { caughtUp = resolve; });
    try {
      const refreshStart = onStageTiming ? Date.now() : 0;
      try {
        await refreshForCommit();
      } finally {
        catchingUp = undefined;
        caughtUp();
      }
      if (onStageTiming) onStageTiming({ stage: "commit.refresh", ms: refreshStart ? Date.now() - refreshStart : 0 });
      return await work();
    } finally {
      inTransaction = false;
      await lock.release();
    }
  };

  /**
   * Fold the tail into a new base (`localFirstCompaction.ts`): stream the temp WITHOUT the
   * cross-window lock, then catch up and rename UNDER it. Queued on the serial queue behind
   * the commit that tripped the policy, never inside it, so this window's own commits wait for
   * it; only other windows interleave. `flush()` waits for it.
   */
  const scheduleCompaction = (): void => {
    // One job at a time: a burst of commits queues one, and a failing compaction (a rename or
    // lock that keeps refusing) backs off rather than re-streaming the store per commit.
    if (compactionPending || !shouldCompactJournal(io.tail(), options.compaction) || !compactionBackoff.allowed()) return;
    compactionPending = true;
    void serialized(async () => {
      try {
        if (!compactionBackoff.allowed()) return; // re-checked before the temp is streamed
        await compactJournal({ io, view: () => memory.view(), exclusive, policy: options.compaction });
        compactionBackoff.succeeded();
      } catch (error) {
        compactionBackoff.failed();
        throw error;
      } finally {
        compactionPending = false;
      }
    }).catch(onBackgroundError);
  };

  const store: DurableLocalFirstStore = {
    snapshotFile,
    journalFile: io.journalFile,
    async read(work) {
      await refreshForRead();
      return memory.read(work);
    },
    transact(work) {
      return serialized(() => exclusive(async () => {
        await beforeWrite;
        const started = Date.now();
        lastFrameBytes = 0;
        const result = await memory.transact(work);
        if (lastFrameBytes > 0) dirty = true;
        const elapsed = Date.now() - started;
        if (elapsed > SLOW_COMMIT_MS) options.onSlowCommit?.(elapsed, lastFrameBytes);
        const compactStart = onStageTiming ? Date.now() : 0;
        scheduleCompaction();
        if (onStageTiming) onStageTiming({ stage: "commit.compact-check", ms: Date.now() - compactStart });
        if (onStageTiming) onStageTiming({ stage: "commit.total", ms: elapsed, detail: `${lastFrameBytes} byte frame` });
        return result;
      }));
    },
    async export() {
      await refreshForRead();
      return memory.export();
    },
    /** Upload/log boundary. The rule is VSIX_LOCAL_FIRST_REDACTION_RULE. */
    async exportForUploadOrLog() {
      return redactSnapshotForUploadOrLog(await store.export());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async flush() {
      // A compaction queued by the last commit is part of "everything settled".
      let settled: Promise<unknown>;
      do {
        settled = tail;
        await settled;
      } while (settled !== tail);
      if (!dirty) return;
      dirty = false;
      await writeSnapshotCache(snapshotFile, memory.view()).catch(onBackgroundError);
    },
  };
  return store;
}
