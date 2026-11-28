/**
 * The VSIX store with a partition declared (AE-G031): one journal file per home, the main journal holding
 * stubs and pointers. The partition is declared HERE, over a test index, never imported from brain-embedded.
 */

import nodeFs from "node:fs";
import { mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defineRecordIndex,
  defineRecordPartition,
  newLocalRecord,
  scanJournal,
  selectByIndex,
  type LocalFirstSnapshot,
  type LocalRecord,
} from "@builderforce/local-first";
import { createDurableLocalFirstStore, type DurableLocalFirstStore, type DurableLocalFirstStoreOptions } from "./durableLocalFirstStore";
import { JOURNAL_FILE } from "./localFirstJournalIo";
import { PARTITIONS_DIR, V4_IMPORT_SIDECAR_FILE, V4_JOURNAL_FILE } from "./localFirstPartitionNames";
import { RETIRE_AFTER_MS } from "./localFirstRetire";

interface Msg { chatId: number; n: number; text: string }

const BY_CHAT = defineRecordIndex<Msg>("message", "test.vsixPartitions.byChat", (row) => row.payload.chatId);
const PARTITION = defineRecordPartition<Msg>({ index: BY_CHAT, homeOf: (row) => row.payload.chatId, ordinalOf: (row) => row.payload.n });

const directories: string[] = [];
async function directory(): Promise<string> {
  const created = await mkdtemp(nodePath.join(tmpdir(), "bf-partitions-"));
  directories.push(created);
  return created;
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const message = (id: string, chatId: number, n: number, text = "hello"): LocalRecord<Msg> =>
  newLocalRecord<Msg>({ id, entityType: "message", payload: { chatId, n, text }, deviceId: "d1" });

const open = (root: string, options: DurableLocalFirstStoreOptions = {}): DurableLocalFirstStore =>
  createDurableLocalFirstStore(root, { partitions: [PARTITION], ...options });

const put = (store: DurableLocalFirstStore, ...rows: LocalRecord<Msg>[]): Promise<void> =>
  store.transact(async (tx) => { for (const row of rows) await tx.put(row); });

const chat = async (store: DurableLocalFirstStore, chatId: number): Promise<string[]> =>
  (await store.read((tx) => selectByIndex(tx, BY_CHAT, chatId))).map((row) => row.id).sort();

const partitionDir = (root: string): string => nodePath.join(root, PARTITIONS_DIR);
const partitionFilesOf = (root: string, chatId: number): string[] =>
  nodeFs.readdirSync(partitionDir(root)).filter((name) => name.startsWith(`message.${chatId}.`) && name.endsWith(".journal")).sort();
const partitionPathOf = (root: string, chatId: number): string => nodePath.join(partitionDir(root), partitionFilesOf(root, chatId)[0]!);
const framesOf = (path: string) => scanJournal(new Uint8Array(nodeFs.readFileSync(path)));
const mainFramesOf = (root: string) => framesOf(nodePath.join(root, V4_JOURNAL_FILE));

const sorted = (snapshot: LocalFirstSnapshot) => ({
  records: [...snapshot.records].sort((a, b) => `${a.entityType}/${a.id}`.localeCompare(`${b.entityType}/${b.id}`)),
  events: [...snapshot.events].sort((a, b) => a.eventId.localeCompare(b.eventId)),
  mappings: [...snapshot.mappings].sort((a, b) => `${a.entityType}:${a.clientEntityId}`.localeCompare(`${b.entityType}:${b.clientEntityId}`)),
  receipts: [...snapshot.receipts].sort((a, b) => a.eventId.localeCompare(b.eventId)),
  conflicts: [...snapshot.conflicts].sort((a, b) => a.id.localeCompare(b.id)),
  nextSequence: snapshot.nextSequence,
});

const BOUND = { kind: "bound", platformInstance: "https://example.test", tenantId: "1" } as const;

describe("a store with a partition declared", () => {
  it("regression: v3 -> v4 migration exports equal, and main holds no message row", async () => {
    const root = await directory();
    const v3 = createDurableLocalFirstStore(root);
    await v3.transact(async (tx) => {
      const ticket = newLocalRecord({ id: "t1", entityType: "ticket", payload: { title: "t1" }, deviceId: "d1" });
      await tx.put(ticket);
      await tx.putMapping({ destination: BOUND, entityType: "message", clientEntityId: "m1", syncId: 1, serverId: "1", serverVersion: 1 } as never);
      await tx.putReceipt({ eventId: "ev-receipt", entityType: "message", clientEntityId: "m1", status: "accepted", receivedAt: "2026-11-01T00:00:00.000Z" });
      await tx.putConflict({ id: "conflict-1", clientEntityId: "t1", entityType: "ticket", local: ticket, remote: ticket, reason: "test", createdAt: "2026-11-01T00:00:00.000Z" });
      for (let n = 1; n <= 9; n += 1) {
        const row = message(`m${n}`, (n % 3) + 1, n);
        await tx.put(row);
        await tx.append({
          idempotencyKey: `message:${n}`, clientEntityId: row.id, entityType: "message", operation: "update", schemaVersion: 1,
          occurredAt: row.occurredAt, dependsOn: [], destination: BOUND, payload: row.payload,
        });
      }
    });
    await v3.flush();
    const before = sorted(await v3.export());

    const v4 = open(root);
    const after = sorted(await v4.export());
    expect(after).toEqual(before);
    expect(mainFramesOf(root).latest?.records.filter((row) => row.entityType === "message")).toEqual([]);
    expect(mainFramesOf(root).latest?.stubs).toHaveLength(9);
    expect([1, 2, 3].map((chatId) => partitionFilesOf(root, chatId).length)).toEqual([1, 1, 1]);
    expect(nodeFs.existsSync(nodePath.join(root, JOURNAL_FILE))).toBe(true);
    // A cold open reads only the files: the same store.
    expect(sorted(await open(root).export())).toEqual(before);
  });

  it("regression: a crash between the partition frame and the main frame leaves the commit invisible and the leftover truncated", async () => {
    const root = await directory();
    const store = open(root);
    await put(store, message("m1", 1, 1));
    const file = partitionPathOf(root, 1);
    const real = nodeFs.promises.open.bind(nodeFs.promises);
    const spy = vi.spyOn(nodeFs.promises, "open").mockImplementation(((path: nodeFs.PathLike, ...rest: unknown[]) =>
      String(path).endsWith(V4_JOURNAL_FILE) && typeof rest[0] === "number"
        ? Promise.reject(new Error("disk full"))
        : (real as (...args: unknown[]) => unknown)(path, ...rest)) as never);
    await expect(put(store, message("m2", 1, 2))).rejects.toThrow("disk full");
    spy.mockRestore();
    // The partition frame landed (the "crash" is the main frame's absence)…
    expect(framesOf(file).frames).toBe(2);

    const reopened = open(root);
    expect(await chat(reopened, 1)).toEqual(["m1"]); // …and no reader sees it
    await put(reopened, message("m3", 1, 3));
    expect(framesOf(file).frames).toBe(2); // the leftover was cut before m3's frame
    expect(await chat(open(root), 1)).toEqual(["m1", "m3"]);
  });

  it("regression: a failed main append leaves no aborted write visible after the next commit", async () => {
    const root = await directory();
    const store = open(root);
    await put(store, message("m1", 1, 1));
    const real = nodeFs.promises.open.bind(nodeFs.promises);
    const spy = vi.spyOn(nodeFs.promises, "open").mockImplementation(((path: nodeFs.PathLike, ...rest: unknown[]) =>
      String(path).endsWith(V4_JOURNAL_FILE) && typeof rest[0] === "number"
        ? Promise.reject(new Error("disk full"))
        : (real as (...args: unknown[]) => unknown)(path, ...rest)) as never);
    await expect(put(store, message("m2", 1, 2))).rejects.toThrow("disk full");
    spy.mockRestore();
    expect(await chat(store, 1)).toEqual(["m1"]);
    await put(store, message("m3", 1, 3));
    expect(await chat(store, 1)).toEqual(["m1", "m3"]);
    expect(await chat(open(root), 1)).toEqual(["m1", "m3"]);
    expect(framesOf(partitionPathOf(root, 1)).latest?.records.map((row) => row.id).sort()).toEqual(["m1", "m3"]);
  });

  it("regression: a cross-window partition tail is applied lazily when loaded and ignored when not", async () => {
    const root = await directory();
    const a = open(root);
    const b = open(root);
    await put(a, message("a1", 1, 1), message("a2", 2, 1));
    expect(await chat(b, 1)).toEqual(["a1"]); // b loads chat 1 only

    const partitionReads: string[] = [];
    const reads = (chatId: number): number => partitionReads.filter((path) => path.includes(`message.${chatId}.`)).length;
    const real = nodeFs.promises.open.bind(nodeFs.promises);
    vi.spyOn(nodeFs.promises, "open").mockImplementation(((path: nodeFs.PathLike, ...rest: unknown[]) => {
      if (rest[0] === "r" && String(path).includes(PARTITIONS_DIR)) partitionReads.push(String(path));
      return (real as (...args: unknown[]) => unknown)(path, ...rest);
    }) as never);

    await put(a, message("a3", 1, 2), message("a4", 2, 2));
    expect(await chat(b, 1)).toEqual(["a1", "a3"]); // caught up lazily, from the pointer
    expect(reads(2)).toBe(0); // chat 2 was never loaded here: its tail is not read
    expect(await chat(b, 2)).toEqual(["a2", "a4"]);
    expect(reads(2)).toBeGreaterThan(0);
  });

  it("regression: a load racing a pointer move never installs older rows", async () => {
    const root = await directory();
    const a = open(root);
    const b = open(root);
    await put(a, message("r1", 1, 1));
    await b.read(async () => 0);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let reached!: () => void;
    const hit = new Promise<void>((resolve) => { reached = resolve; });
    const real = nodeFs.promises.open.bind(nodeFs.promises);
    vi.spyOn(nodeFs.promises, "open").mockImplementation((async (path: nodeFs.PathLike, ...rest: unknown[]) => {
      if (rest[0] === "r" && String(path).includes(`message.1.`) && String(path).includes(PARTITIONS_DIR)) {
        reached();
        await gate;
      }
      return (real as (...args: unknown[]) => unknown)(path, ...rest);
    }) as never);

    const first = chat(b, 1); // starts reading up to the pointer it holds, then waits
    await hit;
    await put(a, message("r2", 1, 2)); // the pointer moves under it
    await b.read(async () => 0); // b's main tail applies the move while the first read is still in flight
    release();
    expect(await first).toEqual(["r1", "r2"]);
  });

  it("regression: compaction of either kind never loses a row", async () => {
    const root = await directory();
    const errors: unknown[] = [];
    const store = open(root, { partitionCompaction: { maxFrames: 2 }, compaction: { maxFrames: 3 }, onBackgroundError: (error) => errors.push(error) });
    for (let n = 1; n <= 6; n += 1) await put(store, message(`c${n}`, 1 + (n % 2), n, `v${n}`));
    // `transact` queues the compaction its commit tripped before it resolves; `flush` waits for the queue to drain.
    await store.flush();
    expect(errors).toEqual([]);
    expect(partitionFilesOf(root, 1)).toHaveLength(1); // old generations are gone once no pointer names them
    expect(partitionFilesOf(root, 2)).toHaveLength(1);
    expect(await chat(store, 1)).toEqual(["c2", "c4", "c6"]);
    const cold = open(root);
    expect(await chat(cold, 1)).toEqual(["c2", "c4", "c6"]);
    expect(await chat(cold, 2)).toEqual(["c1", "c3", "c5"]);
    expect(mainFramesOf(root).latest?.records.filter((row) => row.entityType === "message")).toEqual([]);
    // Every commit and compaction fsyncs and renames: generous on a slow disk, bounded by the awaits above.
  }, 30_000);

  it("regression: an old generation deleted under a reader is retried, not set aside", async () => {
    const root = await directory();
    const errors: unknown[] = [];
    const a = open(root, { partitionCompaction: { maxFrames: 2 }, onBackgroundError: (error) => errors.push(error) });
    const b = open(root, { onBackgroundError: (error) => errors.push(error) });
    await put(a, message("g1", 1, 1));
    await b.read(async () => 0); // b holds the pointer to the first generation

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let reached!: () => void;
    const hit = new Promise<void>((resolve) => { reached = resolve; });
    let armed = true;
    const real = nodeFs.promises.open.bind(nodeFs.promises);
    vi.spyOn(nodeFs.promises, "open").mockImplementation((async (path: nodeFs.PathLike, ...rest: unknown[]) => {
      if (armed && rest[0] === "r" && String(path).includes(`message.1.`) && String(path).includes(PARTITIONS_DIR)) {
        reached();
        await gate;
      }
      return (real as (...args: unknown[]) => unknown)(path, ...rest);
    }) as never);

    const first = chat(b, 1);
    await hit;
    // Only b's read waits: from here on a's own fold of the file (its compaction) opens it freely.
    armed = false;
    await put(a, message("g2", 1, 2)); // the second frame trips a's partition compaction: a new generation, the old one removed
    await a.flush();
    release();
    expect(await first).toEqual(["g1", "g2"]);
    expect(errors).toEqual([]);
    expect(nodeFs.readdirSync(partitionDir(root)).some((name) => name.includes(".corrupt-"))).toBe(false);
  });

  it("regression: a tombstoned message stays in its partition (main does not grow on delete)", async () => {
    const root = await directory();
    const store = open(root);
    const row = message("t1", 1, 1, "x".repeat(20_000));
    await put(store, row);
    const before = nodeFs.statSync(nodePath.join(root, V4_JOURNAL_FILE)).size;
    await store.transact(async (tx) => {
      const current = (await tx.get<Msg>("message", "t1"))!;
      await tx.put({ ...current, version: current.version + 1, deletedAt: new Date().toISOString() });
    });
    const grew = nodeFs.statSync(nodePath.join(root, V4_JOURNAL_FILE)).size - before;
    expect(grew).toBeLessThan(5_000); // a stub change, not a 20 kB row
    expect(mainFramesOf(root).latest?.records.filter((r) => r.entityType === "message")).toEqual([]);
    expect(framesOf(partitionPathOf(root, 1)).latest?.records[0]?.deletedAt).toBeDefined();
    expect((await store.view()).stubs?.find((stub) => stub.id === "t1")?.deleted).toBe(true);
  });

  it("regression: an old-window v3 edit of a message after the migration is merged", async () => {
    const root = await directory();
    const old = createDurableLocalFirstStore(root);
    await old.transact(async (tx) => { await tx.put(message("o1", 1, 1, "original")); await tx.put(message("o2", 2, 1)); });
    await old.flush();
    await old.read(async () => 0);

    await chat(open(root), 1); // v4 is cut from v3 here
    expect(nodeFs.existsSync(nodePath.join(root, V4_IMPORT_SIDECAR_FILE))).toBe(true);

    // The old window is still on v3: it edits o1 and adds o3.
    await old.transact(async (tx) => {
      const current = (await tx.get<Msg>("message", "o1"))!;
      await tx.put({ ...current, version: current.version + 1, payload: { ...current.payload, text: "edited" } });
      await tx.put(message("o3", 1, 2));
    });

    const merged = open(root);
    expect(await chat(merged, 1)).toEqual(["o1", "o3"]);
    const row = await merged.read((tx) => tx.get<Msg>("message", "o1"));
    expect(row?.version).toBe(2);
    expect(row?.payload.text).toBe("edited");
    // Merged once: a later open finds v3 where the baseline says it is.
    const errors: unknown[] = [];
    await chat(open(root, { onBackgroundError: (error) => errors.push(error) }), 1);
    expect(errors).toEqual([]);
  });

  it("regression: the backlog migration never drops an event whose row is in an unloaded partition", async () => {
    const root = await directory();
    const first = open(root);
    const row = message("e1", 7, 1, "queued offline");
    await first.transact(async (tx) => {
      await tx.put(row);
      await tx.append({
        idempotencyKey: "message:e1", clientEntityId: row.id, entityType: "message", operation: "create", schemaVersion: 1,
        occurredAt: row.occurredAt, dependsOn: [], destination: { kind: "unbound" }, payload: row.payload,
      });
    });
    await first.flush();

    const reopened = open(root); // chat 7 is not loaded: its row is only in its partition file
    await reopened.read(async () => 0);
    await reopened.flush();
    const events = (await reopened.export()).events;
    expect(events).toHaveLength(1); // looked up through a transaction: kept, its payload copy turned into a marker
    expect(events[0]?.payload).toBeNull();
  });

  it("regression: a damaged partition leaves no stale stub", async () => {
    const root = await directory();
    const first = open(root);
    await put(first, message("d1", 1, 1), message("d2", 1, 2), message("d3", 2, 1));
    await first.flush();
    const file = partitionPathOf(root, 1);
    const bytes = nodeFs.readFileSync(file);
    bytes.fill(0xff, 20, 40);
    nodeFs.writeFileSync(file, bytes);

    const errors: unknown[] = [];
    const store = open(root, { onBackgroundError: (error) => errors.push(error) });
    await expect(chat(store, 1)).rejects.toThrow(/damaged/); // that read fails and installs nothing: never an empty chat
    await store.flush(); // the recovery queued on the store's own queue
    expect((await store.view()).stubs?.map((stub) => stub.id)).toEqual(["d3"]);
    expect(errors.map(String).join("\n")).toMatch(/partition message\/1 is damaged/);
    expect(nodeFs.readdirSync(partitionDir(root)).some((name) => name.includes(".corrupt-"))).toBe(true);
    expect(await chat(store, 2)).toEqual(["d3"]);
    await put(store, message("d4", 1, 3)); // the chat is writable again
    expect(await chat(open(root), 1)).toEqual(["d4"]);
  });

  it("regression: v3 is retired only 14 days after v4 was cut from it, and only once fully merged", async () => {
    const root = await directory();
    const v3 = createDurableLocalFirstStore(root);
    await v3.transact((tx) => tx.put(message("r1", 1, 1)));
    await v3.flush();
    await chat(open(root), 1);
    const v3File = nodePath.join(root, JOURNAL_FILE);
    const sidecar = nodePath.join(root, V4_IMPORT_SIDECAR_FILE);
    // A v3 that was idle for 15 days BEFORE the cut survives the cut: the age counts from `migratedAt`.
    const idle = new Date(Date.now() - RETIRE_AFTER_MS - 60_000);
    await utimes(v3File, idle, idle);
    await chat(open(root), 1);
    expect(nodeFs.existsSync(v3File)).toBe(true);

    // An unreadable sidecar keeps it, and is reported.
    const errors: unknown[] = [];
    nodeFs.writeFileSync(sidecar, "{not json");
    await chat(open(root, { onBackgroundError: (error) => errors.push(error) }), 1);
    expect(nodeFs.existsSync(v3File)).toBe(true);
    expect(errors.length).toBeGreaterThan(0);

    // Fully merged (the baseline sits at v3's end), the cut 15 days ago and v3 idle since: retired.
    nodeFs.writeFileSync(sidecar, JSON.stringify({ v3Length: nodeFs.statSync(v3File).size, v3Generation: undefined, migratedAt: idle.toISOString() }));
    await chat(open(root), 1);
    expect(nodeFs.existsSync(v3File)).toBe(false);
    expect(await chat(open(root), 1)).toEqual(["r1"]);
  });

  it("regression: an old-window v3 deletion and acknowledgement are merged too", async () => {
    const root = await directory();
    const old = createDurableLocalFirstStore(root);
    await old.transact(async (tx) => {
      await tx.put(message("k1", 1, 1));
      await tx.put(message("k2", 1, 2));
      await tx.append({
        idempotencyKey: "message:k1", clientEntityId: "k1", entityType: "message", operation: "update", schemaVersion: 1,
        occurredAt: new Date().toISOString(), dependsOn: [], destination: BOUND, payload: { text: "x" },
      });
    });
    await old.flush();
    const eventId = (await old.export()).events[0]!.eventId;
    await chat(open(root), 1); // v4 is cut here

    await old.transact(async (tx) => {
      await tx.delete("message", "k2");
      await tx.acknowledge([eventId]);
    });
    const merged = open(root);
    expect(await chat(merged, 1)).toEqual(["k1"]);
    expect((await merged.export()).events).toEqual([]);
    expect((await merged.view()).stubs?.map((stub) => stub.id)).toEqual(["k1"]);
  });

  it("regression: a re-merge after the old window compacted v3 does not re-queue an event already merged", async () => {
    const root = await directory();
    const old = createDurableLocalFirstStore(root, { compaction: { maxFrames: 1 } });
    await old.transact((tx) => tx.put(message("q1", 1, 1)));
    await old.flush();
    await chat(open(root), 1); // v4 is cut here
    const queue = (id: string) => old.transact(async (tx) => {
      await tx.put(message(id, 1, 2));
      await tx.append({
        idempotencyKey: `message:${id}`, clientEntityId: id, entityType: "message", operation: "update", schemaVersion: 1,
        occurredAt: new Date().toISOString(), dependsOn: [], destination: BOUND, payload: { text: id },
      });
    });
    await queue("q2");
    await old.flush(); // v3 compacted: a new generation, so the next open diffs it whole

    const first = open(root);
    expect(await chat(first, 1)).toEqual(["q1", "q2"]);
    const merged = (await first.export()).events;
    expect(merged).toHaveLength(1);
    await first.transact((tx) => tx.acknowledge(merged.map((event) => event.eventId)));

    await old.transact((tx) => tx.put(message("q3", 1, 3)));
    await old.flush(); // compacted again
    const second = open(root);
    expect(await chat(second, 1)).toEqual(["q1", "q2", "q3"]);
    expect((await second.export()).events).toEqual([]); // the acknowledged event is not queued again
  });

  it("regression: a transient EBUSY or EPERM rejects the load, empties no chat and deletes no stub", async () => {
    const root = await directory();
    const first = open(root);
    await put(first, message("b1", 1, 1));
    await first.flush();
    for (const code of ["EBUSY", "EPERM"]) {
      const errors: unknown[] = [];
      const store = open(root, { onBackgroundError: (error) => errors.push(error) });
      const real = nodeFs.promises.open.bind(nodeFs.promises);
      const spy = vi.spyOn(nodeFs.promises, "open").mockImplementation(((path: nodeFs.PathLike, ...rest: unknown[]) =>
        rest[0] === "r" && String(path).includes(PARTITIONS_DIR) && String(path).includes("message.1.")
          ? Promise.reject(Object.assign(new Error(`${code} held by a scanner`), { code }))
          : (real as (...args: unknown[]) => unknown)(path, ...rest)) as never);
      await expect(chat(store, 1)).rejects.toThrow(/unavailable/);
      await store.flush();
      spy.mockRestore();
      expect(errors.length).toBeGreaterThan(0); // reported
      expect((await store.view()).stubs?.map((stub) => stub.id)).toEqual(["b1"]); // no stub deleted
      expect(await chat(store, 1)).toEqual(["b1"]); // the next read loads it in full
      expect(nodeFs.readdirSync(partitionDir(root)).some((name) => name.includes(".corrupt-"))).toBe(false);
    }
  });
});
