/**
 * Writes an OLD window made to `local-first-v3.journal` after v4 was cut from it (AE-G031 "Old windows").
 *
 * The same seam as the v2 -> v3 merge (`localFirstLegacyMerge.ts`, whose `planLegacyMerge` this calls): a
 * sidecar (`local-first-v4.import.json`) records where v3 stood when v4 was cut — its committed length, its
 * base generation, and when. Every open compares v3's size to it with one stat, and does nothing when they
 * match. When v3 grew:
 *
 *   - SAME FILE: the frames past the baseline length are read as a tail (`readJournalTail`) and merged as
 *     ONE v4 commit;
 *   - A CHANGED GENERATION (an old window compacted v3), or v3 recreated after its retirement, or a tail
 *     that holds a base frame: v3 is read whole and DIFFED — the slow case. With no baseline of rows, a row
 *     counts only when its `updatedAt` is after the cut (an event: its `occurredAt`).
 *
 * The plan looks rows up by `get`/`stub` (`RowLookup`), never in `view().records`, which holds no message
 * row. A row absent from v4 that v4 has a mapping for was deleted since (a pulled tombstone hard-deletes):
 * an old window's edit does not bring it back.
 */

import nodeFs from "node:fs";
import nodePath from "node:path";
import {
  readJournalTail,
  stubOf,
  type AnyRecordPartition,
  type LocalFirstDelta,
  type LocalFirstSnapshot,
  type LocalRecord,
  type RecordPartition,
  type JournalEvent,
} from "@builderforce/local-first";
import { writeFileAtomically } from "./localFirstAtomicFile";
import { JOURNAL_FILE, createNodeJournalIo, yieldToEventLoop } from "./localFirstJournalIo";
import { readBaseGeneration } from "./localFirstJournalHeader";
import { planLegacyMerge, type RowVersions } from "./localFirstLegacyMerge";
import { V4_IMPORT_SIDECAR_FILE } from "./localFirstPartitionNames";

const fs = nodeFs.promises;

/** Where v3 stood when v4 was cut from it (or last merged). */
export interface V3Baseline {
  v3Length: number;
  v3Generation: string | undefined;
  /** ISO time taken before v3 was folded. */
  migratedAt: string;
}

export async function writeV3Baseline(directory: string, baseline: V3Baseline): Promise<void> {
  await writeFileAtomically(nodePath.join(directory, V4_IMPORT_SIDECAR_FILE), JSON.stringify(baseline));
}

export async function readV3Baseline(directory: string): Promise<V3Baseline | undefined> {
  try {
    const parsed = JSON.parse(await fs.readFile(nodePath.join(directory, V4_IMPORT_SIDECAR_FILE), "utf8")) as Partial<V3Baseline>;
    return typeof parsed.v3Length === "number" && typeof parsed.migratedAt === "string" ? parsed as V3Baseline : undefined;
  } catch {
    return undefined;
  }
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
    return size === baseline.v3Length ? undefined : { baseline, size };
  } catch {
    return undefined;
  }
}

/** What v3 holds that can be merged: rows (last version of each) and events. */
interface V3Writes {
  rows: LocalRecord[];
  events: JournalEvent[];
  /** The baseline to record once the merge is durable. */
  next: V3Baseline;
}

async function readV3Writes(directory: string, baseline: V3Baseline, size: number): Promise<V3Writes> {
  const file = nodePath.join(directory, JOURNAL_FILE);
  const handle = await fs.open(file, "r");
  let generation: string | undefined;
  let sameFile = false;
  let bytes: Buffer | undefined;
  try {
    generation = await readBaseGeneration(handle);
    sameFile = size > baseline.v3Length && (baseline.v3Generation === undefined || generation === baseline.v3Generation);
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
      const rows = new Map<string, LocalRecord>();
      const events = new Map<string, JournalEvent>();
      for (const delta of tail.deltas) {
        for (const row of delta.records ?? []) rows.set(keyOf(row), row);
        for (const event of delta.events ?? []) events.set(event.eventId, event);
        for (const id of delta.acknowledgedEvents ?? []) events.delete(id);
      }
      return { rows: [...rows.values()], events: [...events.values()], next: { ...baseline, v3Length: baseline.v3Length + tail.consumedBytes, v3Generation: baseline.v3Generation ?? generation } };
    }
  }
  // The slow case: v3 is a different file (or unreadable as a tail). Diff it whole.
  const whole = await createNodeJournalIo(directory).load(yieldToEventLoop);
  const snapshot = whole.corrupt && !whole.baseClosed ? undefined : whole.latest;
  return {
    rows: (snapshot?.records ?? []).filter((row) => row.updatedAt > baseline.migratedAt),
    events: (snapshot?.events ?? []).filter((event) => event.occurredAt > baseline.migratedAt),
    next: { ...baseline, v3Length: whole.committedBytes, v3Generation: whole.identity?.generation },
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

/** Merge what an old window wrote to v3 since the baseline, as one v4 commit. Never fails the open. */
export async function mergeV3Writes(ports: V3MergePorts): Promise<void> {
  if (!(await v3Moved(ports.directory))) return;
  await ports.locked(async () => {
    const moved = await v3Moved(ports.directory); // another window may have merged while this one waited
    if (!moved) return;
    const writes = await readV3Writes(ports.directory, moved.baseline, moved.size);
    const delta = await planV3Merge(ports, writes);
    if (delta) await ports.commit(delta);
    await writeV3Baseline(ports.directory, writes.next);
    if (delta) ports.onBackgroundError(new Error(`local-first: merged ${delta.records?.length ?? 0} rows and ${delta.events?.length ?? 0} events an older window wrote to the v3 journal`));
  });
}

async function planV3Merge(ports: V3MergePorts, writes: V3Writes): Promise<LocalFirstDelta | undefined> {
  if (writes.rows.length === 0 && writes.events.length === 0) return undefined;
  const current = ports.view();
  const found = await ports.lookup(writes.rows);
  const mapped = new Set<string>();
  if (writes.rows.some((row) => !found.get(keyOf(row)))) for (const mapping of current.mappings) mapped.add(`${mapping.entityType}/${mapping.clientEntityId}`);
  const known: Map<string, number | undefined> = new Map();
  for (const row of writes.rows) {
    const key = keyOf(row);
    // Absent from v4 but mapped: deleted since. Infinity keeps `planLegacyMerge` from bringing it back.
    known.set(key, found.get(key)?.version ?? (mapped.has(key) ? Number.POSITIVE_INFINITY : undefined));
  }
  const legacy: LocalFirstSnapshot = { ...current, records: writes.rows, events: writes.events, mappings: [], receipts: [] };
  const plan = planLegacyMerge({ v2Size: 0, v2MtimeMs: 0, rows: {}, eventIds: [] }, legacy, { ...current, records: [] }, known as RowVersions);
  if (!plan || (!plan.records?.length && !plan.events?.length)) return undefined;
  const types = new Map(ports.partitions.map((partition) => [partition.index.entityType, partition as RecordPartition]));
  const stubs: NonNullable<LocalFirstDelta["stubs"]> = [];
  const deletedStubs: NonNullable<LocalFirstDelta["deletedStubs"]> = [];
  const deletedRecords: NonNullable<LocalFirstDelta["deletedRecords"]> = [];
  for (const row of plan.records ?? []) {
    const partition = types.get(row.entityType);
    const stub = partition && stubOf(partition, row);
    if (!stub) continue;
    stubs.push(stub);
    const prior = found.get(keyOf(row));
    if (prior?.home !== undefined && prior.home !== stub.home) {
      deletedStubs.push({ entityType: row.entityType, id: row.id, home: prior.home });
      deletedRecords.push({ entityType: row.entityType, id: row.id });
    }
  }
  return {
    ...plan,
    ...(stubs.length > 0 ? { stubs } : {}),
    ...(deletedStubs.length > 0 ? { deletedStubs, deletedRecords } : {}),
  };
}
