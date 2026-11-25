/**
 * The VSIX durable local-first store's CONTRACT: what `createDurableLocalFirstStore` returns and
 * takes. Split out of `durableLocalFirstStore.ts`, which re-exports all of it.
 */

import {
  INDEXEDDB_REDACTION_RULE,
  type JournalCompactionPolicy,
  type LocalFirstSnapshot,
  type LocalFirstStore,
} from "@builderforce/local-first";
import type { LocalFirstFileLockOptions } from "./localFirstLock";
import type { CompactionBackoff } from "./localFirstCompactionBackoff";
import type { JournalStageTiming } from "./localFirstJournalIo";
import type { LocalFirstView } from "./localFirstView";

/** Journal-backed store. `local-first-v1.json` is a cache written by `flush()`, not the commit. */
export interface DurableLocalFirstStore extends LocalFirstStore {
  flush(): Promise<void>;
  readonly snapshotFile: string;
  readonly journalFile: string;
  /**
   * The committed state WITHOUT cloning its rows (`export` clones every row, megabytes once a store
   * holds a whole chat history). Read-only and valid until the next commit: derive from it, never
   * mutate or retain a row. What the rail and the sync summary read their statuses from.
   */
  view(): Promise<LocalFirstView>;
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
  /** Acknowledged events that fold a new base whatever the tail measures (default 20,000; tests). */
  compactAfterAcknowledged?: number;
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
