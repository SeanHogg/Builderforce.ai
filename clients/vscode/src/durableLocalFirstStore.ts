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
 * commit resolves, a compaction is queued on the same serial queue and writes the store as
 * a stream of small frames, giving the thread back between them.
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
  snapshotFrames,
  type JournalCompactionPolicy,
  type LocalFirstDelta,
  type LocalFirstListener,
  type LocalFirstSnapshot,
  type LocalFirstStore,
  type MemoryLocalFirstStore,
} from "@builderforce/local-first";
import { createLocalFirstFileLock, type LocalFirstFileLockOptions } from "./localFirstLock";
import { createNodeJournalIo, yieldToEventLoop, type LoadedJournal, type TailRead } from "./localFirstJournalIo";
import {
  checkSnapshotCache,
  hasLegacyState,
  readLegacyJournal,
  readSnapshotCache,
  removeOrphanedTemporaries,
  retireSnapshotCache,
} from "./localFirstMigration";
import { snapshotHasState } from "./localFirstSnapshotFile";

const fs = nodeFs.promises;

export const SNAPSHOT_FILE = "local-first-v1.json";
export const LOCK_FILE = "local-first-v1.lock";

/** A commit slower than this is reported through `onSlowCommit`. */
const SLOW_COMMIT_MS = 250;

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
  /** A cache write or a compaction failed after the commit was durable. Default `console.warn`. */
  onBackgroundError?: (error: unknown) => void;
  /** A commit took longer than 250 ms: how long, and the size of the frame it appended. */
  onSlowCommit?: (ms: number, frameBytes: number) => void;
}

export function createDurableLocalFirstStore(
  directory: string,
  options: DurableLocalFirstStoreOptions = {},
): DurableLocalFirstStore {
  const snapshotFile = nodePath.join(directory, SNAPSHOT_FILE);
  const io = createNodeJournalIo(directory);
  const lock = createLocalFirstFileLock(nodePath.join(directory, LOCK_FILE), options.lock);
  const beforeWrite = options.beforeWrite ?? Promise.resolve();
  const onBackgroundError = options.onBackgroundError
    ?? ((error: unknown) => console.warn("local-first: background write failed", error));
  const listeners = new Set<LocalFirstListener>();
  let quiet = false;
  let opened: Promise<void> | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  let inTransaction = false;
  let commitGeneration = 0;
  let dirty = false;
  let lastFrameBytes = 0;

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
      const frame = io.frames() === 0 ? encodeJournalFrame(snapshotAfter(delta)) : encodeDeltaFrame(delta);
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
    quiet = silent;
    try {
      memory.applyDelta(resetDeltaOf(snapshot));
    } finally {
      quiet = false;
    }
  };

  /**
   * First open with no v3 journal and an older store to bring over. UNDER THE LOCK: two
   * windows can open at once, and the loser must find the winner's v3 rather than write its
   * own. v2 is only read; v3 is written as a stream of frames; the JSON cache of v2's state is
   * set aside so it is never parsed again.
   */
  const importLegacy = async (): Promise<void> => {
    await fs.mkdir(directory, { recursive: true });
    await lock.acquire();
    try {
      const raced = await io.load(yieldToEventLoop);
      if (raced.latest) {
        adopt(raced, true);
        return;
      }
      const fromJournal = await readLegacyJournal(directory, yieldToEventLoop);
      const source = fromJournal ?? await readSnapshotCache(snapshotFile);
      if (source && snapshotHasState(source)) {
        await io.compact(snapshotFrames(source, yieldToEventLoop));
        replaceMemory(source, true);
      } else {
        adopt(raced, true);
      }
      if (fromJournal) await retireSnapshotCache(snapshotFile);
    } finally {
      await lock.release();
    }
  };

  const openStore = async (): Promise<void> => {
    const loaded = await io.load(yieldToEventLoop);
    if (loaded.latest) {
      adopt(loaded, true);
      // The journal is the record, so the cache is not imported — but a small corrupt cache
      // is still moved aside here. Failing to do so must not fail the open.
      await checkSnapshotCache(snapshotFile).catch(onBackgroundError);
    } else if (await hasLegacyState(directory, snapshotFile)) {
      await importLegacy();
    } else {
      adopt(loaded, true);
    }
    await removeOrphanedTemporaries(directory);
  };

  /** Never call this while holding the lock: an import takes it. */
  const ensureOpen = (): Promise<void> => {
    opened ??= openStore().catch((error: unknown) => {
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
    else if (read.kind === "reload") adopt(await io.load(yieldToEventLoop), false);
  };

  /**
   * Lock-free readers see another window's commits too. A read never waits on a running
   * commit, never truncates, and discards what it read if a commit started or landed (or
   * another read overtook it) meanwhile — the commit's own refresh is the authoritative one.
   */
  const refreshForRead = async (): Promise<void> => {
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
    if (stale()) return;
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
    await lock.acquire();
    inTransaction = true;
    commitGeneration += 1;
    try {
      await refreshForCommit();
      return await work();
    } finally {
      inTransaction = false;
      await lock.release();
    }
  };

  /**
   * Fold the tail into a new base. Queued behind the commit that tripped the policy, never
   * inside it: the commit has already resolved. Re-checks the policy after catching up,
   * because another window may have compacted first.
   */
  const scheduleCompaction = (): void => {
    if (!shouldCompactJournal(io.tail(), options.compaction)) return;
    void serialized(() => exclusive(async () => {
      if (!shouldCompactJournal(io.tail(), options.compaction)) return;
      await io.compact(snapshotFrames(memory.view(), yieldToEventLoop));
    })).catch(onBackgroundError);
  };

  const writeCache = async (): Promise<void> => {
    const temporary = `${snapshotFile}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(temporary, JSON.stringify(memory.view()), { encoding: "utf8", flag: "wx" });
      await fs.rename(temporary, snapshotFile);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
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
        scheduleCompaction();
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
      await writeCache().catch(onBackgroundError);
    },
  };
  return store;
}
