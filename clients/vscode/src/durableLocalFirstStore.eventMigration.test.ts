import nodeFs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createMemoryLocalFirstStore,
  newLocalRecord,
  type LocalFirstDelta,
  type LocalFirstTransaction,
  type MemoryLocalFirstStore,
} from "@builderforce/local-first";
import { createDurableLocalFirstStore, type DurableLocalFirstStore } from "./durableLocalFirstStore";
import { JOURNAL_FILE } from "./localFirstJournalIo";
import { PRE_MIGRATION_SUFFIX, migrateEventBacklog } from "./localFirstEventMigration";

const directories: string[] = [];
async function directory(): Promise<string> {
  const created = await mkdtemp(nodePath.join(tmpdir(), "bf-event-migration-"));
  directories.push(created);
  return created;
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** What a pre-marker build wrote for each offline message: the row AND an unbound event carrying its payload. */
async function writeLegacy(tx: LocalFirstTransaction, from: number, count: number): Promise<void> {
  for (let n = from; n < from + count; n += 1) {
    const record = newLocalRecord({ id: uuid(n), entityType: "message", payload: { chatId: 1, message: { id: n, content: "x".repeat(200) } }, deviceId: "d1" });
    await tx.put(record);
    await tx.append({
      idempotencyKey: `message:${n}`, clientEntityId: record.id, entityType: "message", operation: "create", schemaVersion: 1,
      occurredAt: record.occurredAt, dependsOn: [], destination: { kind: "unbound" }, payload: record.payload,
    });
  }
}

const payloadEvents = async (store: { read: DurableLocalFirstStore["read"] }): Promise<number> =>
  store.read(async (tx) => {
    let copies = 0;
    await tx.scanPending((event) => { if (event.payload !== null) copies += 1; });
    return copies;
  });

const journalBytes = (root: string): number => nodeFs.statSync(nodePath.join(root, JOURNAL_FILE)).size;
const backupOf = (root: string): string => nodePath.join(root, `${JOURNAL_FILE}${PRE_MIGRATION_SUFFIX}`);

describe("event-backlog migration at open", () => {
  it("strips the payload copies, keeps a pre-migration backup, compacts, and retires the backup on the next open", async () => {
    const root = await directory();
    const legacy = createDurableLocalFirstStore(root);
    await legacy.transact((tx) => writeLegacy(tx, 0, 50));
    await legacy.flush();
    const before = journalBytes(root);
    const original = nodeFs.readFileSync(nodePath.join(root, JOURNAL_FILE));

    const opened = createDurableLocalFirstStore(root);
    expect(await payloadEvents(opened)).toBe(0);
    await opened.flush(); // the compaction the migration queued
    expect(nodeFs.readFileSync(backupOf(root))).toEqual(original);
    expect(journalBytes(root)).toBeLessThan(before);
    const state = await opened.export();
    expect(state.records).toHaveLength(50);
    expect(state.events).toHaveLength(50);
    expect(state.events.every((event) => event.payload === null && typeof (event as { payloadSize?: unknown }).payloadSize === "number")).toBe(true);

    // A later healthy open has nothing to migrate: the backup has done its job.
    const again = createDurableLocalFirstStore(root);
    await again.read(async () => 0);
    expect(nodeFs.existsSync(backupOf(root))).toBe(false);
    expect((await again.export()).events).toEqual(state.events);
  });

  it("another window holding the pre-migration state catches up and keeps committing", async () => {
    const root = await directory();
    const older = createDurableLocalFirstStore(root);
    await older.transact((tx) => writeLegacy(tx, 0, 20));
    expect(await payloadEvents(older)).toBe(20);

    const newer = createDurableLocalFirstStore(root);
    await newer.read(async () => 0);
    await newer.flush();

    // The older window sees the markers (the migrated, compacted file), then writes on top of it.
    expect(await payloadEvents(older)).toBe(0);
    await older.transact((tx) => writeLegacy(tx, 100, 1));
    const seen = await newer.export();
    expect(seen.records).toHaveLength(21);
    expect(seen.events.filter((event) => event.payload !== null)).toHaveLength(1);
  });
});

describe("compaction after a drain", () => {
  it("a queue drained by sync folds a new base without the acknowledged events, under the tail thresholds", async () => {
    const root = await directory();
    const store = createDurableLocalFirstStore(root, { compactAfterAcknowledged: 30 });
    await store.transact((tx) => writeLegacy(tx, 0, 40));
    await store.flush();
    const queued = journalBytes(root);
    await store.transact(async (tx) => { await tx.acknowledge((await tx.pending()).map((event) => event.eventId)); });
    await store.flush();
    // The acknowledgements tripped a compaction: the base holds the rows and no events.
    expect(journalBytes(root)).toBeLessThan(queued);
    const reopened = createDurableLocalFirstStore(root);
    expect((await reopened.export()).events).toEqual([]);
    expect((await reopened.export()).records).toHaveLength(40);
  });
});

describe("migrateEventBacklog", () => {
  const portsOver = (memory: MemoryLocalFirstStore, journalFile: string, commit: (delta: LocalFirstDelta) => Promise<void>) => ({
    journalFile,
    view: () => memory.view(),
    locked: <T,>(work: () => Promise<T>) => work(),
    commit,
  });

  it("a kill mid-migration keeps the FIRST backup and the next run finishes the rest", async () => {
    const root = await directory();
    const journalFile = nodePath.join(root, JOURNAL_FILE);
    nodeFs.writeFileSync(journalFile, "pre-migration bytes");
    const memory = createMemoryLocalFirstStore();
    await memory.transact((tx) => writeLegacy(tx, 0, 2_500)); // two slices

    let calls = 0;
    await expect(migrateEventBacklog(portsOver(memory, journalFile, async (delta) => {
      calls += 1;
      if (calls === 2) throw new Error("killed");
      memory.applyDelta(delta);
    }))).rejects.toThrow("killed");
    expect(await payloadEvents(memory)).toBe(500);
    expect(nodeFs.readFileSync(`${journalFile}${PRE_MIGRATION_SUFFIX}`, "utf8")).toBe("pre-migration bytes");

    nodeFs.writeFileSync(journalFile, "half-migrated bytes");
    const plan = await migrateEventBacklog(portsOver(memory, journalFile, async (delta) => { memory.applyDelta(delta); }));
    expect(plan?.stripped).toBe(500);
    expect(await payloadEvents(memory)).toBe(0);
    expect(nodeFs.readFileSync(`${journalFile}${PRE_MIGRATION_SUFFIX}`, "utf8")).toBe("pre-migration bytes");

    // Idempotent: nothing left, nothing committed, and the backup is retired.
    let committed = 0;
    expect(await migrateEventBacklog(portsOver(memory, journalFile, async () => { committed += 1; }))).toBeUndefined();
    expect(committed).toBe(0);
    expect(nodeFs.existsSync(`${journalFile}${PRE_MIGRATION_SUFFIX}`)).toBe(false);
  });
});
