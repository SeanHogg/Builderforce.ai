/**
 * WHEN the VSIX journal compacts (the HOW is `localFirstCompaction.ts`).
 *
 * Fold the tail into a new base: stream the temp WITHOUT the cross-window lock, then catch up and
 * rename UNDER it. Queued on the store's serial queue behind the commit that tripped it, never
 * inside it, so this window's own commits wait for it; only other windows interleave. One job at
 * a time: a burst of commits queues one, and a failing compaction (a rename or lock that keeps
 * refusing) backs off rather than re-streaming the store per commit.
 *
 * Two triggers besides the shared tail policy (`shouldCompactJournal`):
 *   - a DRAINED queue: a sync that acknowledged tens of thousands of events leaves their rows in
 *     the base, parsed on every open, while its own frames stay under the tail thresholds — so
 *     `compactAfterAcknowledged` acknowledgements fold a new base whatever the tail measures;
 *   - `compactNow`: the open that migrated the event backlog folds the slim state at once.
 */

import type { JournalCompactionPolicy, LocalFirstDelta, LocalFirstSnapshot } from "@builderforce/local-first";
import { shouldCompactJournal } from "@builderforce/local-first";
import { compactJournal, type CompactionPorts } from "./localFirstCompaction";
import type { CompactionBackoff } from "./localFirstCompactionBackoff";

/** Events this window acknowledged since its last compaction that fold a new base. */
export const COMPACT_AFTER_ACKNOWLEDGED = 20_000;

export interface CompactionSchedulerPorts {
  readonly io: CompactionPorts["io"];
  view(): LocalFirstSnapshot;
  exclusive: CompactionPorts["exclusive"];
  /** The store's serial queue. */
  serialized(work: () => Promise<void>): Promise<void>;
  readonly backoff: CompactionBackoff;
  readonly policy?: Partial<JournalCompactionPolicy>;
  readonly compactAfterAcknowledged?: number;
  onBackgroundError(error: unknown): void;
}

export interface CompactionScheduler {
  /** Every commit this window appends (the drained-queue count). */
  noteCommit(delta: LocalFirstDelta): void;
  /** After a commit: queue a compaction when a trigger holds. */
  schedule(): void;
  /** Queue one now, whatever the tail measures. */
  compactNow(): void;
}

export function createCompactionScheduler(ports: CompactionSchedulerPorts): CompactionScheduler {
  let pending = false;
  let acknowledged = 0;
  const threshold = ports.compactAfterAcknowledged ?? COMPACT_AFTER_ACKNOWLEDGED;

  const queue = (policy: Partial<JournalCompactionPolicy> | undefined): void => {
    pending = true;
    void ports.serialized(async () => {
      try {
        if (!ports.backoff.allowed()) return; // re-checked before the temp is streamed
        const counted = acknowledged;
        await compactJournal({ io: ports.io, view: ports.view, exclusive: ports.exclusive, policy });
        acknowledged = Math.max(0, acknowledged - counted);
        ports.backoff.succeeded();
      } catch (error) {
        ports.backoff.failed();
        throw error;
      } finally {
        pending = false;
      }
    }).catch(ports.onBackgroundError);
  };

  return {
    noteCommit(delta) {
      acknowledged += delta.acknowledgedEvents?.length ?? 0;
    },
    schedule() {
      const drained = acknowledged >= threshold;
      if (pending || !(drained || shouldCompactJournal(ports.io.tail(), ports.policy)) || !ports.backoff.allowed()) return;
      // A drained queue folds whatever the tail measures: one frame is enough.
      queue(drained ? { maxFrames: 1 } : ports.policy);
    },
    compactNow() {
      queue({ maxFrames: 1 });
    },
  };
}
