/**
 * The two merges an open runs once the journal is adopted and healthy, as ordinary commits under the
 * cross-window lock: what an old window wrote to v2 after the import (`localFirstLegacyMerge.ts`), and the
 * one-time event-backlog migration (`localFirstEventMigration.ts`). Split from `durableLocalFirstStore.ts`,
 * which supplies the ports. A partitioned store looks rows up through a transaction instead of
 * `view().records`, and keeps no main-only backup of the journal.
 */

import type { LocalFirstDelta, LocalFirstSnapshot } from "@builderforce/local-first";
import { hostLog } from "../host/hostLog";
import { migrateEventBacklog } from "./localFirstEventMigration";
import { yieldToEventLoop } from "./localFirstJournalIo";
import { legacyMoved, readLegacyMerge, writeLegacyBaseline } from "./localFirstLegacyMerge";
import type { PartitionedStorage } from "./localFirstPartitionedStorage";

export interface OpenMergePorts {
  directory: string;
  journalFile: string;
  view(): LocalFirstSnapshot;
  partitioned: PartitionedStorage | undefined;
  /** Hold the cross-window lock, caught up with the journal. */
  underOpenLock<T>(work: () => Promise<T>): Promise<T>;
  /** One frame appended and applied, under the lock. */
  commitOpenDelta(delta: LocalFirstDelta): Promise<void>;
  onBackgroundError(error: unknown): void;
}

export function createOpenMerges(ports: OpenMergePorts): {
  mergeLegacyWrites(): Promise<void>;
  /** Returns whether the backlog was migrated (the slim state is then folded into a new base). */
  migrateBacklog(): Promise<boolean>;
} {
  const { directory, partitioned } = ports;
  return {
    /**
     * A lock-free check first — one stat plus the sidecar — so the usual open never takes the lock; then, under
     * it and caught up, merge what the baseline says is new as ONE commit and move the baseline.
     */
    async mergeLegacyWrites() {
      if (!(await legacyMoved(directory))) return;
      await ports.underOpenLock(async () => {
        const merge = await readLegacyMerge(directory, ports.view(), yieldToEventLoop, partitioned?.versionsOf);
        if (!merge) return;
        if (merge.delta) await ports.commitOpenDelta(merge.delta);
        await writeLegacyBaseline(directory, merge.baseline);
        if (merge.delta) ports.onBackgroundError(new Error(`local-first: merged ${merge.rows} rows and ${merge.events} events an older window wrote to the v2 journal`));
      });
    },

    async migrateBacklog() {
      const plan = await migrateEventBacklog({
        journalFile: ports.journalFile,
        view: partitioned ? partitioned.planSnapshot : ports.view,
        backup: !partitioned,
        stampWhenClean: !!partitioned,
        locked: ports.underOpenLock,
        commit: ports.commitOpenDelta,
      });
      if (!plan) return false;
      hostLog(`local-first: migrated the event backlog — ${plan.stripped} payload copies became markers, ${plan.dropped} dead events dropped, ${plan.kept} kept (payload differs from the row)`);
      return true;
    },
  };
}
