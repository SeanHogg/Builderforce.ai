/**
 * Everything the durable store does differently when it declares partitions (AE-G031), composed from the
 * modules that own each concern, so `durableLocalFirstStore.ts` only wires them:
 *
 *   commit protocol            `localFirstPartitionCommit.ts`
 *   loader (reads, retries)    `localFirstPartitionLoader.ts`
 *   partition compaction       `localFirstPartitionCompaction.ts`  (queued by the existing compaction scheduler)
 *   damaged partition          `localFirstPartitionRecovery.ts`
 *   v3 -> v4, import, rebuild  `localFirstV4Migration.ts`
 *   old-window v3 writes       `localFirstV4Merge.ts`
 *   retirement                 `localFirstRetire.ts`
 *
 * With no partition declared the store never builds this: its behaviour and files are v3's, unchanged.
 * The store and this module reference each other (the memory store needs the loader, the loader needs a
 * refresh of the store), so the store `bind`s its host once its own parts exist.
 */

import nodeFs from "node:fs";
import nodePath from "node:path";
import {
  eventBacklogMigrated,
  isRecordPayloadMarker,
  partitionDeclarationOf,
  stubOf,
  type AnyRecordPartition,
  type JournalCompactionPolicy,
  type LocalEntityType,
  type LocalFirstDelta,
  type LocalFirstSnapshot,
  type LocalRecord,
  type MemoryLocalFirstStore,
  type PartitionLoader,
  type RecordPartition,
} from "@builderforce/local-first";
import type { LoadedJournal } from "./localFirstJournalIo";
import type { LocalFirstFileLock } from "./localFirstLock";
import type { RowVersions } from "./localFirstLegacyMerge";
import { createPartitionCommit, PointerTracker, type PartitionCommit } from "./localFirstPartitionCommit";
import { createPartitionCompactor, type PartitionCompactor } from "./localFirstPartitionCompaction";
import { createPartitionLoader } from "./localFirstPartitionLoader";
import { createPartitionRecovery } from "./localFirstPartitionRecovery";
import { V4_JOURNAL_FILE } from "./localFirstPartitionNames";
import { retireOldFormats } from "./localFirstRetire";
import { migrateV3ToV4, partitionizeSnapshot, withBacklogMigrated } from "./localFirstV4Migration";
import { mergeV3Writes, type RowLookup } from "./localFirstV4Merge";

const fs = nodeFs.promises;

export interface PartitionedStorageConfig {
  directory: string;
  partitions: readonly AnyRecordPartition[];
  lock: LocalFirstFileLock;
  openWaitMs: number;
  compaction?: Partial<JournalCompactionPolicy>;
  onBackgroundError(error: unknown): void;
}

/** What the store hands over once its own parts exist. */
export interface PartitionHost {
  memory: MemoryLocalFirstStore;
  serialized<T>(work: () => Promise<T>): Promise<T>;
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  /** Under the open's lock: one main frame appended and applied. */
  commitOpenDelta(delta: LocalFirstDelta): Promise<void>;
  underOpenLock<T>(work: () => Promise<T>): Promise<T>;
  /** A lock-free catch-up with the main journal; a no-op while the store is still opening. */
  refreshMain(): Promise<void>;
}

export interface PartitionedStorage {
  readonly loader: PartitionLoader;
  readonly partitions: readonly AnyRecordPartition[];
  readonly pointers: PointerTracker;
  readonly commit: PartitionCommit;
  bind(host: PartitionHost): void;
  /** Built after `bind`: the scheduler's partition half. */
  compactor(): PartitionCompactor;
  /** The store adopted a loaded journal: its pointers are the tracker's now. */
  adopted(loaded: LoadedJournal): void;
  /** Before the first read: cut v4 out of v3 when v4 does not exist yet. */
  ensureV4(): Promise<void>;
  /** An open-time delta of rows (a v2 merge) gets the stubs its partitioned rows need. */
  complete(delta: LocalFirstDelta): LocalFirstDelta;
  /** The versions of these rows in the store, by lookup (`view().records` holds no partitioned row). */
  versionsOf(rows: LocalFirstSnapshot["records"]): Promise<RowVersions>;
  /** A snapshot an import or rebuild produced: its partitioned rows are written to partition files. */
  prepareSnapshot(snapshot: LocalFirstSnapshot): Promise<LocalFirstSnapshot>;
  /** What the event-backlog planner reads: the committed state plus the rows its candidates name, by lookup. */
  planSnapshot(): Promise<LocalFirstSnapshot>;
  mergeV3(): Promise<void>;
  retire(): Promise<void>;
}

export function createPartitionedStorage(config: PartitionedStorageConfig): PartitionedStorage {
  const { directory, partitions } = config;
  const pointers = new PointerTracker();
  let host!: PartitionHost;
  let onDamaged!: ReturnType<typeof createPartitionRecovery>;
  let compactor!: PartitionCompactor;
  const damaged: ReturnType<typeof createPartitionRecovery> = (id, pointer, reason) => onDamaged(id, pointer, reason);
  const types = partitions.map(partitionDeclarationOf);
  const byType = new Map(partitions.map((partition) => [partition.index.entityType, partition as RecordPartition]));

  const commit = createPartitionCommit({ directory, pointers, types, onDamaged: damaged });
  const loader = createPartitionLoader({
    directory,
    pointerOf: (id) => pointers.get(id),
    refreshMain: () => host.refreshMain(),
    onDamaged: damaged,
  });

  /** Rows by lookup: a partitioned row through its stub (and `get`), any other through `get`. */
  const lookup: RowLookup = (rows) => host.memory.read(async (tx) => {
    const found = new Map<string, { version: number; home?: string | number } | undefined>();
    for (const row of rows) {
      const type = row.entityType as LocalEntityType;
      const stub = await tx.stub?.(type, row.id);
      if (stub) {
        found.set(`${row.entityType}/${row.id}`, { version: stub.version, home: stub.home });
        continue;
      }
      const present = await tx.get(type, row.id);
      found.set(`${row.entityType}/${row.id}`, present ? { version: present.version } : undefined);
    }
    return found;
  });

  return {
    loader,
    partitions,
    pointers,
    commit,
    bind(bound) {
      host = bound;
      onDamaged = createPartitionRecovery({
        directory,
        pointers,
        view: () => host.memory.view(),
        serialized: host.serialized,
        exclusive: host.exclusive,
        commitMain: (delta) => host.commitOpenDelta(delta),
        onBackgroundError: config.onBackgroundError,
      });
      compactor = createPartitionCompactor({
        directory,
        pointers,
        ...(config.compaction ? { policy: config.compaction } : {}),
        exclusive: host.exclusive,
        commitMain: (delta) => host.commitOpenDelta(delta),
        onDamaged: damaged,
      });
    },
    compactor: () => compactor,

    adopted(loaded) {
      const table = loaded.state?.table;
      pointers.seed(table && Object.fromEntries(table.allPartitionIds().flatMap((id) => {
        const pointer = table.pointer(id);
        return pointer ? [[id, pointer] as const] : [];
      })));
    },

    async ensureV4() {
      try {
        if ((await fs.stat(nodePath.join(directory, V4_JOURNAL_FILE))).size > 0) return;
      } catch {
        // no v4 yet
      }
      await migrateV3ToV4({ directory, partitions, lock: config.lock, openWaitMs: config.openWaitMs, onBackgroundError: config.onBackgroundError });
    },

    complete(delta) {
      const have = new Set((delta.stubs ?? []).map((stub) => `${stub.entityType}/${stub.id}`));
      const added = [];
      for (const row of delta.records ?? []) {
        const partition = byType.get(row.entityType);
        const stub = partition && !have.has(`${row.entityType}/${row.id}`) ? stubOf(partition, row) : undefined;
        if (stub) added.push(stub);
      }
      return added.length > 0 ? Object.assign(delta, { stubs: [...(delta.stubs ?? []), ...added] }) : delta;
    },

    async versionsOf(rows) {
      return new Map([...(await lookup(rows))].map(([key, found]) => [key, found?.version]));
    },

    async prepareSnapshot(snapshot) {
      // A snapshot that already carries stubs is a v4 state: its `records` lack the partitioned rows the planner would look for.
      const stamped = withBacklogMigrated(snapshot, new Date().toISOString(), !snapshot.stubs?.length);
      const base = await partitionizeSnapshot(directory, partitions, stamped);
      await base.publish(); // under the lock (the caller's): a rebuild or import writes the main journal right after
      return base.main;
    },

    async planSnapshot() {
      const view = host.memory.view();
      if (eventBacklogMigrated(view)) return view;
      // Only an event that carries a payload copy can be a candidate; its row is looked up, never assumed absent.
      const refs = view.events
        .filter((event) => event.payload !== null && event.payload !== undefined && !isRecordPayloadMarker(event))
        .map((event) => ({ entityType: event.entityType as LocalEntityType, id: event.clientEntityId }));
      const records = await host.memory.read(async (tx) => {
        const rows: LocalRecord[] = [];
        for (const ref of refs) {
          const row = await tx.get(ref.entityType, ref.id);
          if (row) rows.push(row);
        }
        return rows;
      });
      return { ...view, records };
    },

    mergeV3: () => mergeV3Writes({
      directory,
      partitions,
      view: () => host.memory.view(),
      lookup,
      locked: host.underOpenLock,
      commit: (delta) => host.commitOpenDelta(delta),
      onBackgroundError: config.onBackgroundError,
    }),

    async retire() {
      await retireOldFormats(directory).catch(config.onBackgroundError);
    },
  };
}
