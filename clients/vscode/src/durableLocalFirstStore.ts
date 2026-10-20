/**
 * The VSIX host's durable local-first store over a directory (G03/G26).
 *
 * Commit boundary for writes this store owns: a transaction is one journal
 * frame (every record and sync event the callback put/appended) fsynced to
 * `local-first-v2.journal` before the promise resolves. `local-first-v1.json`
 * is republished afterwards as a cache. Deleting it does not drop committed
 * rows. A corrupt cache is moved aside and the open continues from the journal.
 *
 * Every commit runs under the cross-process file lock (`localFirstLock.ts`),
 * and first reloads the journal when another window committed since this
 * process last saw it — so a commit never lands on a stale snapshot. The
 * journal is compacted to one frame on the shared `shouldCompactJournal`
 * policy.
 *
 * No `vscode` import: `bootVsixHost` opens the same store over a plain
 * directory, and `createVsCodeLocalFirstStore` over global storage.
 */

import nodeFs from "node:fs";
import nodePath from "node:path";
import {
  INDEXEDDB_REDACTION_RULE,
  createMemoryLocalFirstStore,
  encodeJournalFrame,
  redactSnapshotForUploadOrLog,
  shouldCompactJournal,
  type JournalCompactionPolicy,
  type LocalFirstSnapshot,
  type LocalFirstStore,
} from "@builderforce/local-first";
import { createLocalFirstFileLock, type LocalFirstFileLockOptions } from "./localFirstLock";
import { createNodeJournalIo, sameStamp, type FileStamp } from "./localFirstJournalIo";
import { planSnapshotLoad, snapshotHasState } from "./localFirstSnapshotFile";

const fs = nodeFs.promises;

export const SNAPSHOT_FILE = "local-first-v1.json";
export const LOCK_FILE = "local-first-v1.lock";

/** Journal-backed store. `local-first-v1.json` is a republished cache, not the commit. */
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
  /** A cache republish or a compaction failed after the commit was durable. Default `console.warn`. */
  onBackgroundError?: (error: unknown) => void;
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
  const listeners = new Set<() => void>();
  let memory = createMemoryLocalFirstStore();
  let durable: LocalFirstSnapshot | undefined;
  let opened: Promise<void> | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  let republished: Promise<void> = Promise.resolve();
  let inTransaction = false;
  let commitGeneration = 0;
  let peeked: FileStamp | undefined;

  const readLegacySnapshot = async (): Promise<LocalFirstSnapshot | undefined> => {
    let text: string;
    try {
      text = await fs.readFile(snapshotFile, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    // The snapshot is a derived cache / one-way legacy import, not the record (the
    // journal is). A corrupt copy is MOVED aside — kept whole, exportable — and the
    // open continues from the journal. Throwing here would fail every later open too,
    // locking the person out of their local store over a cache file.
    const plan = planSnapshotLoad(text, snapshotFile, Date.now());
    if (plan.action === "preserve") {
      await fs.rename(snapshotFile, plan.recoveryPath);
      return undefined;
    }
    return plan.snapshot;
  };

  /** Load the journal's committed state into memory. */
  const load = async (): Promise<void> => {
    const { latest } = await io.open();
    durable = latest;
    memory = createMemoryLocalFirstStore(durable);
  };

  const ensureOpen = (): Promise<void> => {
    opened ??= (async () => {
      const { latest } = await io.open();
      if (latest) {
        // The journal is the record, so the cache is not imported — but a corrupt
        // cache is still moved aside here, not left for an older reader to open.
        // Failing to move it must not fail the open: the journal already loaded.
        await readLegacySnapshot().catch(onBackgroundError);
      }
      const legacy = latest ?? await readLegacySnapshot();
      if (!latest && legacy && snapshotHasState(legacy)) {
        await io.append(encodeJournalFrame(legacy));
      }
      durable = legacy && (latest || snapshotHasState(legacy)) ? legacy : undefined;
      memory = createMemoryLocalFirstStore(durable);
    })().catch((error: unknown) => {
      opened = undefined;
      throw error;
    });
    return opened;
  };

  /**
   * Under the lock: another window committed since this process last saw the
   * journal, so reload before committing on top of it.
   */
  const refreshForCommit = async (): Promise<void> => {
    await ensureOpen();
    if (await io.changedSinceSeen()) await load();
  };

  /**
   * Lock-free readers see another window's commits too. A read never moves the
   * journal's tracked prefix (`peek`), never waits on a running commit, and
   * discards its reload if a commit started or landed meanwhile — the commit's
   * own refresh is the authoritative one.
   */
  const refreshForRead = async (): Promise<void> => {
    await ensureOpen();
    if (inTransaction) return;
    const current = await io.currentStamp();
    if (sameStamp(current, io.seenStamp()) || sameStamp(current, peeked)) return;
    const generation = commitGeneration;
    const view = await io.peek();
    if (inTransaction || generation !== commitGeneration) return;
    peeked = view.stamp;
    durable = view.latest;
    memory = createMemoryLocalFirstStore(durable);
  };

  const serialized = <T,>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work);
    tail = run.then(() => undefined, () => undefined);
    return run;
  };

  const republish = async (): Promise<void> => {
    const snapshot = await memory.export();
    const temporary = `${snapshotFile}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(temporary, JSON.stringify(snapshot), { encoding: "utf8", flag: "wx" });
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
      return serialized(async () => {
        await fs.mkdir(directory, { recursive: true });
        await lock.acquire();
        inTransaction = true;
        commitGeneration += 1;
        try {
          await refreshForCommit();
          await beforeWrite;
          let result: Awaited<ReturnType<typeof work>>;
          let next: LocalFirstSnapshot;
          try {
            result = await memory.transact(work);
            next = await memory.export();
            await io.append(encodeJournalFrame(next));
          } catch (error) {
            memory = createMemoryLocalFirstStore(durable);
            throw error;
          }
          durable = next;
          if (shouldCompactJournal({ frames: io.frames(), bytes: await io.size() }, options.compaction)) {
            // The commit is already durable; a failed compaction leaves a longer journal, not a lost write.
            await io.replace(encodeJournalFrame(next)).catch(onBackgroundError);
          }
          for (const listener of [...listeners]) listener();
          const pending = republished.then(() => republish()).catch(onBackgroundError);
          republished = pending;
          return result;
        } finally {
          inTransaction = false;
          await lock.release();
        }
      });
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
      await tail;
      await republished;
    },
  };
  return store;
}
