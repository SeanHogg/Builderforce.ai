/**
 * Writes an OLD window made to `local-first-v3.journal` after v4 was cut from it (AE-G031 "Old windows").
 *
 * The same seam as the v2 -> v3 merge (`localFirstLegacyMerge.ts`, whose `planLegacyMerge` this calls): a
 * sidecar (`local-first-v4.import.json`) records where v3 stood when v4 was cut — its committed length, the
 * file size seen, its base generation, when, and the event ids already merged. Every open compares v3's size
 * to it with one stat, and does nothing when they match. When v3 grew:
 *
 *   - SAME FILE: the frames past the baseline length are read as a tail (`readJournalTail`) and merged as
 *     ONE v4 commit, in full: rows, deletions, events, acknowledgements, mappings, receipts, conflicts, cursors;
 *   - A CHANGED GENERATION (an old window compacted v3), or v3 recreated after its retirement, or a tail
 *     that holds a base frame: v3 is read whole and DIFFED — the slow case. With no baseline of rows, a row
 *     counts only when its `updatedAt` is after the baseline's `migratedAt` (an event: its `occurredAt`, and
 *     not an id already merged). Only rows and events come from a diff: v3's whole receipts and mappings say
 *     nothing about what this window pruned or deleted since.
 *
 * After a merge the baseline moves: `migratedAt` advances to when the merge began and every event v3 held is
 * remembered by id, so a later diff never re-queues one.
 *
 * The plan looks rows up by `get`/`stub` (`RowLookup`), never in `view().records`, which holds no message
 * row. A row absent from v4 that v4 has a mapping for was deleted since (a pulled tombstone hard-deletes):
 * an old window's edit does not bring it back.
 */

import nodeFs from "node:fs";
import nodePath from "node:path";
import {
  destinationKey,
  isEmptyDelta,
  readJournalTail,
  stubOf,
  type AnyRecordPartition,
  type JournalEvent,
  type LocalFirstDelta,
  type LocalFirstSnapshot,
  type LocalRecord,
  type RecordPartition,
  type ServerMapping,
  type SyncConflict,
  type SyncReceipt,
} from "@builderforce/local-first";
import { writeFileAtomically } from "./localFirstAtomicFile";
import { JOURNAL_FILE, createNodeJournalIo, yieldToEventLoop } from "./localFirstJournalIo";
import { readBaseGeneration } from "./localFirstJournalHeader";
import { planLegacyMerge, type RowVersions } from "./localFirstLegacyMerge";
import { V4_IMPORT_SIDECAR_FILE } from "./localFirstPartitionNames";

const fs = nodeFs.promises;

/** Where v3 stood when v4 was cut from it (or last merged). */
export interface V3Baseline {
  /** Where the committed frames end: a tail starts here. */
  v3Length: number;
  /** The file size last seen. A torn tail makes it larger than `v3Length`; it is what a stat is compared to. */
  v3Size?: number;
  v3Generation: string | undefined;
  /** ISO time taken before v3 was last folded or merged. */
  migratedAt: string;
  /** Events v3 held at the last fold or merge: never merged again. */
  eventIds?: string[];
}

export async function writeV3Baseline(directory: string, baseline: V3Baseline): Promise<void> {
  await writeFileAtomically(nodePath.join(directory, V4_IMPORT_SIDECAR_FILE), JSON.stringify(baseline));
}

/** `undefined`: there is no sidecar. A sidecar that does not parse THROWS: the caller reports it and retires nothing. */
export async function readV3Baseline(directory: string): Promise<V3Baseline | undefined> {
  let text: string;
  try {
    text = await fs.readFile(nodePath.join(directory, V4_IMPORT_SIDECAR_FILE), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const parsed = JSON.parse(text) as Partial<V3Baseline>;
  if (typeof parsed.v3Length !== "number" || typeof parsed.migratedAt !== "string") {
    throw new Error(`local-first: ${V4_IMPORT_SIDECAR_FILE} is not a v3 baseline`);
  }
  return parsed as V3Baseline;
}

/** The row's version (and, for a partitioned row, its home) in v4, by lookup. `undefined`: no such row. */
export type RowLookup = (rows: ReadonlyArray<{ entityType: string; id: string }>) => Promise<Map<string, { version: number; home?: string | number } | undefined>>;

const keyOf = (row: { entityType: string; id: string }): string => `${row.entityType}/${row.id}`;

/** v3's size when it differs from the baseline: one stat plus the sidecar. */
export async function v3Moved(directory: string): Promise<{ baseline: V3Baseline; size: number } | undefined> {
  const baseline = await readV3Baseline(directory);
  if (!baseline) return undefined;
  try {
    const size = (await fs.stat(nodePath.join(directory, JOURNAL_FILE))).size;
    return size === (baseline.v3Size ?? baseline.v3Length) ? undefined : { baseline, size };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** What a v3 TAIL carries beyond rows and events. */
interface TailExtras {
  deleted: Map<string, { entityType: LocalRecord["entityType"]; id: string }>;
  /** The newest version the old window held of a row it put (a deletion is kept only against a row not newer). */
  seen: Map<string, number>;
  mappings: ServerMapping[];
  receipts: SyncReceipt[];
  conflicts: SyncConflict[];
  acknowledged: Set<string>;
  cursors: Record<string, string>;
  unsetCursors: Set<string>;
}

const noExtras = (): TailExtras => ({
  deleted: new Map(), seen: new Map(), mappings: [], receipts: [], conflicts: [], acknowledged: new Set(), cursors: {}, unsetCursors: new Set(),
});

/** What v3 holds that can be merged. */
interface V3Writes {
  rows: LocalRecord[];
  events: JournalEvent[];
  extras: TailExtras;
  /** The baseline to record once the merge is durable. */
  next: V3Baseline;
}

function foldTail(deltas: readonly LocalFirstDelta[]): Pick<V3Writes, "rows" | "events" | "extras"> {
  const rows = new Map<string, LocalRecord>();
  const events = new Map<string, JournalEvent>();
  const extras = noExtras();
  for (const delta of deltas) {
    for (const gone of delta.deletedRecords ?? []) {
      rows.delete(keyOf(gone));
      extras.deleted.set(keyOf(gone), gone);
    }
    for (const row of delta.records ?? []) {
      rows.set(keyOf(row), row);
      extras.deleted.delete(keyOf(row));
      extras.seen.set(keyOf(row), row.version);
    }
    for (const event of delta.events ?? []) events.set(event.eventId, event);
    for (const id of delta.acknowledgedEvents ?? []) {
      if (!events.delete(id)) extras.acknowledged.add(id);
    }
    extras.mappings.push(...(delta.mappings ?? []));
    extras.receipts.push(...(delta.receipts ?? []));
    extras.conflicts.push(...(delta.conflicts ?? []));
    for (const [key, cursor] of Object.entries(delta.cursors ?? {})) {
      extras.cursors[key] = cursor;
      extras.unsetCursors.delete(key);
    }
    for (const key of delta.unsetCursors ?? []) {
      delete extras.cursors[key];
      extras.unsetCursors.add(key);
    }
  }
  return { rows: [...rows.values()], events: [...events.values()], extras };
}

async function readV3Writes(directory: string, baseline: V3Baseline, size: number, startedAt: string): Promise<V3Writes> {
  const file = nodePath.join(directory, JOURNAL_FILE);
  const handle = await fs.open(file, "r");
  let generation: string | undefined;
  let bytes: Buffer | undefined;
  try {
    generation = await readBaseGeneration(handle);
    // The same file opens with the same base generation (none for a journal never compacted): a compacted one is another file.
    const sameFile = size > baseline.v3Length && generation === baseline.v3Generation;
    if (sameFile) {
      bytes = Buffer.alloc(size - baseline.v3Length);
      let read = 0;
      while (read < bytes.length) {
        const { bytesRead } = await handle.read(bytes, read, bytes.length - read, baseline.v3Length + read);
        if (bytesRead === 0) break;
        read += bytesRead;
      }
      bytes = bytes.subarray(0, read);
    }
  } finally {
    await handle.close();
  }
  if (bytes) {
    const tail = readJournalTail(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    if (!tail.needsReload && !tail.damaged) {
      const folded = foldTail(tail.deltas);
      return {
        ...folded,
        next: {
          v3Length: baseline.v3Length + tail.consumedBytes,
          v3Size: size,
          v3Generation: generation,
          migratedAt: startedAt,
          eventIds: [...(baseline.eventIds ?? []), ...folded.events.map((event) => event.eventId)],
        },
      };
    }
  }
  // The slow case: v3 is a different file (or unreadable as a tail). Diff it whole.
  const whole = await createNodeJournalIo(directory).load(yieldToEventLoop);
  const snapshot = whole.corrupt && !whole.baseClosed ? undefined : whole.latest;
  const events = (snapshot?.events ?? []).filter((event) => event.occurredAt > baseline.migratedAt);
  return {
    rows: (snapshot?.records ?? []).filter((row) => row.updatedAt > baseline.migratedAt),
    events,
    extras: noExtras(),
    next: {
      v3Length: whole.committedBytes,
      v3Size: size,
      v3Generation: whole.identity?.generation,
      migratedAt: startedAt,
      eventIds: [...(baseline.eventIds ?? []), ...(snapshot?.events ?? []).map((event) => event.eventId)],
    },
  };
}

export interface V3MergePorts {
  directory: string;
  partitions: readonly AnyRecordPartition[];
  /** The committed state, read synchronously: events, receipts and mappings are all in it. */
  view(): LocalFirstSnapshot;
  lookup: RowLookup;
  /** Hold the cross-window lock, caught up (the open's `underOpenLock`). */
  locked<T>(work: () => Promise<T>): Promise<T>;
  /** Append one v4 frame and apply it (the open's `commitOpenDelta`). */
  commit(delta: LocalFirstDelta): Promise<void>;
  onBackgroundError(error: unknown): void;
}

/** Merge what an old window wrote to v3 since the baseline, as one v4 commit. A failure is the caller's to report. */
export async function mergeV3Writes(ports: V3MergePorts): Promise<void> {
  if (!(await v3Moved(ports.directory))) return;
  await ports.locked(async () => {
    const startedAt = new Date().toISOString();
    const moved = await v3Moved(ports.directory); // another window may have merged while this one waited
    if (!moved) return;
    const writes = await readV3Writes(ports.directory, moved.baseline, moved.size, startedAt);
    const delta = await planV3Merge(ports, writes, moved.baseline);
    if (delta) await ports.commit(delta);
    await writeV3Baseline(ports.directory, writes.next);
    if (delta) ports.onBackgroundError(new Error(`local-first: merged ${delta.records?.length ?? 0} rows and ${delta.events?.length ?? 0} events an older window wrote to the v3 journal`));
  });
}

async function planV3Merge(ports: V3MergePorts, writes: V3Writes, baseline: V3Baseline): Promise<LocalFirstDelta | undefined> {
  const { extras } = writes;
  const current = ports.view();
  const found = await ports.lookup([...writes.rows, ...extras.deleted.values()]);
  const mapped = new Set<string>();
  if (writes.rows.some((row) => !found.get(keyOf(row)))) for (const mapping of current.mappings) mapped.add(`${mapping.entityType}/${mapping.clientEntityId}`);
  const known: Map<string, number | undefined> = new Map();
  for (const row of writes.rows) {
    const key = keyOf(row);
    // Absent from v4 but mapped: deleted since. Infinity keeps `planLegacyMerge` from bringing it back.
    known.set(key, found.get(key)?.version ?? (mapped.has(key) ? Number.POSITIVE_INFINITY : undefined));
  }
  const legacy: LocalFirstSnapshot = { ...current, records: writes.rows, events: writes.events, mappings: [], receipts: [] };
  const plan = planLegacyMerge({ v2Size: 0, v2MtimeMs: 0, rows: {}, eventIds: baseline.eventIds ?? [] }, legacy, { ...current, records: [] }, known as RowVersions);

  const types = new Map(ports.partitions.map((partition) => [partition.index.entityType, partition as RecordPartition]));
  const stubs: NonNullable<LocalFirstDelta["stubs"]> = [];
  const deletedStubs: NonNullable<LocalFirstDelta["deletedStubs"]> = [];
  const deletedRecords = new Map<string, { entityType: LocalRecord["entityType"]; id: string }>();
  for (const row of plan?.records ?? []) {
    const partition = types.get(row.entityType);
    const stub = partition && stubOf(partition, row);
    if (!stub) continue;
    stubs.push(stub);
    const prior = found.get(keyOf(row));
    if (prior?.home !== undefined && prior.home !== stub.home) {
      deletedStubs.push({ entityType: row.entityType, id: row.id, home: prior.home });
      deletedRecords.set(keyOf(row), { entityType: row.entityType, id: row.id });
    }
  }
  // A deletion by the old window applies to a row v4 still holds and the old window's copy is not older than.
  for (const [key, gone] of extras.deleted) {
    const have = found.get(key);
    if (!have || have.version > (extras.seen.get(key) ?? Number.POSITIVE_INFINITY)) continue;
    deletedRecords.set(key, gone);
    if (have.home !== undefined) deletedStubs.push({ entityType: gone.entityType, id: gone.id, home: have.home });
  }

  const mappingKeys = new Set(current.mappings.map((mapping) => `${destinationKey(mapping.destination)}:${mapping.entityType}:${mapping.clientEntityId}`));
  const mappings = extras.mappings
    .filter((mapping) => !mappingKeys.has(`${destinationKey(mapping.destination)}:${mapping.entityType}:${mapping.clientEntityId}`))
    .map(({ mappedSeq: _theirs, ...mapping }) => mapping as ServerMapping); // v4 numbers its own `mappedSeq`
  const receiptIds = new Set(current.receipts.map((receipt) => receipt.eventId));
  const receipts = extras.receipts.filter((receipt) => !receiptIds.has(receipt.eventId));
  const conflictIds = new Set(current.conflicts.map((conflict) => conflict.id));
  const conflicts = extras.conflicts.filter((conflict) => !conflictIds.has(conflict.id));
  const pending = new Set(current.events.map((event) => event.eventId));
  const acknowledgedEvents = [...extras.acknowledged].filter((id) => pending.has(id));
  const cursors = Object.fromEntries(Object.entries(extras.cursors).filter(([key]) => current.cursors[key] === undefined));
  const unsetCursors = [...extras.unsetCursors].filter((key) => current.cursors[key] !== undefined);

  const delta: LocalFirstDelta = {
    ...(plan ?? {}),
    ...(stubs.length > 0 ? { stubs } : {}),
    ...(deletedStubs.length > 0 ? { deletedStubs } : {}),
    ...(deletedRecords.size > 0 ? { deletedRecords: [...deletedRecords.values()] } : {}),
    ...(mappings.length > 0 ? { mappings } : {}),
    ...(receipts.length > 0 ? { receipts } : {}),
    ...(conflicts.length > 0 ? { conflicts } : {}),
    ...(acknowledgedEvents.length > 0 ? { acknowledgedEvents } : {}),
    ...(Object.keys(cursors).length > 0 ? { cursors } : {}),
    ...(unsetCursors.length > 0 ? { unsetCursors } : {}),
  };
  return isEmptyDelta(delta) ? undefined : delta;
}
