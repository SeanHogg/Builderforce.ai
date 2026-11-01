import nodeFs from "node:fs";
import { mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  encodeDeltaFrame,
  encodeJournalFrame,
  newLocalRecord,
  scanJournal,
  snapshotFrames,
  type JournalEvent,
  type LocalFirstSnapshot,
} from "@builderforce/local-first";
import { createDurableLocalFirstStore } from "./durableLocalFirstStore";
import { JOURNAL_FILE, LEGACY_JOURNAL_FILE } from "./localFirstJournalIo";
import { IMPORT_SIDECAR_FILE } from "./localFirstLegacyMerge";

const directories: string[] = [];

async function directory(): Promise<string> {
  const created = await mkdtemp(nodePath.join(tmpdir(), "bf-durable-legacy-"));
  directories.push(created);
  return created;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })));
});

const ticket = (id: string, version = 1) => ({
  ...newLocalRecord({ id, entityType: "ticket", payload: { title: id, version }, deviceId: "device-1" }),
  version,
});

const event = (eventId: string, localSequence: number): JournalEvent => ({
  eventId,
  clientEntityId: "a",
  entityType: "ticket",
  operation: "update",
  schemaVersion: 1,
  localSequence,
  occurredAt: "2026-11-01T00:00:00.000Z",
  dependsOn: [],
  destination: { kind: "unbound" },
  payload: { eventId },
  payloadHash: eventId,
});

const snapshot = (records: ReturnType<typeof ticket>[], events: JournalEvent[], nextSequence: number): LocalFirstSnapshot => ({
  records, events, mappings: [], receipts: [], conflicts: [], cursors: {}, nextSequence,
});

type Store = ReturnType<typeof createDurableLocalFirstStore>;
const idsOf = async (store: Store): Promise<string[]> => (await store.export()).records.map((record) => record.id).sort();
const eventIdsOf = async (store: Store): Promise<string[]> => (await store.export()).events.map((e) => e.eventId).sort();
const names = (root: string, part: string): string[] => nodeFs.readdirSync(root).filter((name) => name.includes(part));

describe("writes an older window made to v2 after the import", () => {
  async function importedThenDiverged() {
    const root = await directory();
    const v2 = nodePath.join(root, LEGACY_JOURNAL_FILE);
    nodeFs.writeFileSync(v2, encodeJournalFrame(snapshot([ticket("a"), ticket("b"), ticket("c")], [event("e1", 1), event("e2", 2)], 3)));
    const first = createDurableLocalFirstStore(root);
    expect(await idsOf(first)).toEqual(["a", "b", "c"]);
    expect(nodeFs.existsSync(nodePath.join(root, IMPORT_SIDECAR_FILE))).toBe(true);
    // v3 moves on: c is deleted, e1 is sent and dropped.
    await first.transact(async (tx) => {
      await tx.delete("ticket", "c");
      await tx.acknowledge(["e1"]);
    });
    await first.flush();
    // The old window keeps committing whole snapshots to v2: b changed, d new, e3 new; c and e1 still in it.
    nodeFs.appendFileSync(v2, encodeJournalFrame(snapshot(
      [ticket("a"), ticket("b", 2), ticket("c"), ticket("d")],
      [event("e1", 1), event("e2", 2), event("e3", 3)],
      4,
    )));
    return { root, v2 };
  }

  it("merges a new row, a changed row and a new event on the next open, and resurrects nothing", async () => {
    const { root } = await importedThenDiverged();
    const reports: string[] = [];
    const second = createDurableLocalFirstStore(root, { onBackgroundError: (error) => reports.push(String((error as Error).message)) });
    expect(await idsOf(second)).toEqual(["a", "b", "d"]);
    expect((await second.export()).records.find((record) => record.id === "b")?.version).toBe(2);
    expect(await eventIdsOf(second)).toEqual(["e2", "e3"]);
    expect(reports.filter((line) => line.includes("merged 2 rows and 1 events"))).toHaveLength(1);

    // It was ONE v3 commit and it is durable: a window opened later sees the same.
    const reopened = createDurableLocalFirstStore(root);
    expect(await idsOf(reopened)).toEqual(["a", "b", "d"]);
    expect(await eventIdsOf(reopened)).toEqual(["e2", "e3"]);
  });

  it("merges nothing on a second open, and does not read v2 again", async () => {
    const { root } = await importedThenDiverged();
    await idsOf(createDurableLocalFirstStore(root));
    const before = nodeFs.readFileSync(nodePath.join(root, JOURNAL_FILE));
    const reads = vi.spyOn(nodeFs.promises, "readFile");
    const reports: unknown[] = [];
    const third = createDurableLocalFirstStore(root, { onBackgroundError: (error) => reports.push(error) });
    expect(await idsOf(third)).toEqual(["a", "b", "d"]);
    expect(await eventIdsOf(third)).toEqual(["e2", "e3"]);
    expect(reads.mock.calls.some(([target]) => String(target).endsWith(LEGACY_JOURNAL_FILE))).toBe(false);
    expect(reports).toEqual([]);
    expect(nodeFs.readFileSync(nodePath.join(root, JOURNAL_FILE)).equals(before)).toBe(true);
  });

  it("re-merges nothing when a crash left the sidecar behind the v3 commit", async () => {
    const { root } = await importedThenDiverged();
    const sidecar = nodePath.join(root, IMPORT_SIDECAR_FILE);
    const stale = nodeFs.readFileSync(sidecar);
    await idsOf(createDurableLocalFirstStore(root));
    nodeFs.writeFileSync(sidecar, stale); // the merge committed to v3, the sidecar write never happened
    const before = nodeFs.readFileSync(nodePath.join(root, JOURNAL_FILE));
    const again = createDurableLocalFirstStore(root);
    expect(await idsOf(again)).toEqual(["a", "b", "d"]);
    expect(await eventIdsOf(again)).toEqual(["e2", "e3"]);
    // Rows already at their version and events already in v3 are skipped: no second frame.
    expect(nodeFs.readFileSync(nodePath.join(root, JOURNAL_FILE)).equals(before)).toBe(true);
  });
});

describe("a damaged v3 journal", () => {
  const base = async (): Promise<Buffer> => {
    const frames: Uint8Array[] = [];
    const noPause = async (): Promise<void> => undefined;
    for await (const frame of snapshotFrames(snapshot([ticket("x"), ticket("y"), ticket("z")], [], 1), noPause, { maxBytes: 1, maxRows: 1 })) frames.push(frame);
    expect(frames.length).toBeGreaterThan(2);
    return Buffer.concat(frames);
  };
  const damage = (bytes: Buffer, at: "first" | "last"): Buffer => {
    const copy = Buffer.from(bytes);
    if (at === "first") copy[13 + 5] = (copy[13 + 5]! + 1) % 256;
    else copy[copy.length - 3] = (copy[copy.length - 3]! + 1) % 256;
    return copy;
  };

  it.each(["first", "last"] as const)("in the %s frame of a compacted base opens neither partial nor truncated: the copy is whole and v2 is used", async (at) => {
    const root = await directory();
    const v3 = nodePath.join(root, JOURNAL_FILE);
    const damaged = damage(await base(), at);
    nodeFs.writeFileSync(v3, damaged);
    nodeFs.writeFileSync(nodePath.join(root, LEGACY_JOURNAL_FILE), encodeJournalFrame(snapshot([ticket("from-v2")], [], 2)));
    const reports: string[] = [];
    const store = createDurableLocalFirstStore(root, { onBackgroundError: (error) => reports.push(String((error as Error).message)) });
    expect(await idsOf(store)).toEqual(["from-v2"]);
    const copies = names(root, `${JOURNAL_FILE}.corrupt-`);
    expect(copies).toHaveLength(1);
    expect(nodeFs.readFileSync(nodePath.join(root, copies[0]!)).equals(damaged)).toBe(true);
    expect(reports.some((line) => line.includes("rebuilt from the v2 journal"))).toBe(true);
    expect(scanJournal(new Uint8Array(nodeFs.readFileSync(v3))).latest?.records.map((record) => record.id)).toEqual(["from-v2"]);
  });

  it.each(["first", "last"] as const)("in the %s frame, with no v2, rejects local_first_store_corrupt and leaves the file as it was", async (at) => {
    const root = await directory();
    const v3 = nodePath.join(root, JOURNAL_FILE);
    const damaged = damage(await base(), at);
    nodeFs.writeFileSync(v3, damaged);
    const store = createDurableLocalFirstStore(root);
    await expect(store.export()).rejects.toThrow("local_first_store_corrupt");
    await expect(store.transact(async (tx) => { await tx.put(ticket("late")); })).rejects.toThrow("local_first_store_corrupt");
    expect(nodeFs.readFileSync(v3).equals(damaged)).toBe(true);
    const copies = names(root, `${JOURNAL_FILE}.corrupt-`);
    expect(copies).toHaveLength(1); // retries reuse the identical copy
    expect(nodeFs.readFileSync(nodePath.join(root, copies[0]!)).equals(damaged)).toBe(true);
  });

  it("is not a torn tail: a torn tail still recovers, truncated, with no corrupt copy", async () => {
    const root = await directory();
    const writer = createDurableLocalFirstStore(root);
    await writer.transact(async (tx) => { await tx.put(ticket("one")); });
    await writer.transact(async (tx) => { await tx.put(ticket("two")); });
    nodeFs.appendFileSync(writer.journalFile, Buffer.from([0x42, 0x46, 0x4a]));
    nodeFs.appendFileSync(writer.journalFile, encodeDeltaFrame({ records: [ticket("never")] }).subarray(0, 25));
    const reopened = createDurableLocalFirstStore(root);
    expect(await idsOf(reopened)).toEqual(["one", "two"]);
    await reopened.transact(async (tx) => { await tx.put(ticket("three")); });
    expect(await idsOf(createDurableLocalFirstStore(root))).toEqual(["one", "three", "two"]);
    expect(names(root, ".corrupt-")).toEqual([]);
  });
});

describe("a damaged v3 journal is rebuilt from the best source left", () => {
  const sizeOf = (file: string): number => nodeFs.statSync(file).size;
  const flip = (file: string, at: number): void => {
    const bytes = nodeFs.readFileSync(file);
    bytes[at] = (bytes[at]! + 1) % 256;
    nodeFs.writeFileSync(file, bytes);
  };

  it("keeps the good rows committed after the import when the tail is damaged: v2 unused, sidecar untouched", async () => {
    const root = await directory();
    nodeFs.writeFileSync(nodePath.join(root, LEGACY_JOURNAL_FILE), encodeJournalFrame(snapshot([ticket("a"), ticket("b")], [], 1)));
    const writer = createDurableLocalFirstStore(root);
    await idsOf(writer);
    await writer.transact(async (tx) => { await tx.put(ticket("good1")); });
    const afterGood = sizeOf(writer.journalFile);
    await writer.transact(async (tx) => { await tx.put(ticket("bad")); });
    await writer.transact(async (tx) => { await tx.put(ticket("after-bad")); });
    flip(writer.journalFile, afterGood + 20);
    const sidecar = nodeFs.readFileSync(nodePath.join(root, IMPORT_SIDECAR_FILE));
    const reports: string[] = [];
    const reopened = createDurableLocalFirstStore(root, { onBackgroundError: (error) => reports.push(String((error as Error).message)) });
    expect(await idsOf(reopened)).toEqual(["a", "b", "good1"]);
    expect(names(root, `${JOURNAL_FILE}.corrupt-`)).toHaveLength(1);
    expect(nodeFs.readFileSync(nodePath.join(root, IMPORT_SIDECAR_FILE)).equals(sidecar)).toBe(true);
    expect(reports.some((line) => line.includes("rebuilt from the sound prefix"))).toBe(true);
  });

  it("keeps everything this window holds when the damage turns up on the commit path", async () => {
    const root = await directory();
    const window = createDurableLocalFirstStore(root);
    await window.transact(async (tx) => { await tx.put(ticket("one")); });
    const first = sizeOf(window.journalFile);
    await window.transact(async (tx) => { await tx.put(ticket("two")); });
    await window.transact(async (tx) => { await tx.put(ticket("three")); });
    flip(window.journalFile, first + 20);
    nodeFs.truncateSync(window.journalFile, sizeOf(window.journalFile) - 3); // the file is now shorter than this window tracked
    await window.transact(async (tx) => { await tx.put(ticket("four")); });
    expect(await idsOf(createDurableLocalFirstStore(root))).toEqual(["four", "one", "three", "two"]);
    expect(names(root, `${JOURNAL_FILE}.corrupt-`)).toHaveLength(1);
  });

  it("falls back to the newer of the cache and v2 when the base itself is damaged", async () => {
    const root = await directory();
    const frames: Uint8Array[] = [];
    for await (const frame of snapshotFrames(snapshot([ticket("x"), ticket("y")], [], 1), async () => undefined, { maxBytes: 1, maxRows: 1 })) frames.push(frame);
    const damaged = Buffer.concat(frames);
    damaged[13 + 5] = (damaged[13 + 5]! + 1) % 256;
    nodeFs.writeFileSync(nodePath.join(root, JOURNAL_FILE), damaged);
    const v2 = nodePath.join(root, LEGACY_JOURNAL_FILE);
    const cache = nodePath.join(root, "local-first-v1.json");
    nodeFs.writeFileSync(v2, encodeJournalFrame(snapshot([ticket("from-v2")], [], 2)));
    nodeFs.writeFileSync(cache, JSON.stringify(snapshot([ticket("from-cache")], [], 2)));
    const old = new Date(Date.now() - 60_000);
    await utimes(v2, old, old);
    expect(await idsOf(createDurableLocalFirstStore(root))).toEqual(["from-cache"]);
  });

  it("rejects when the base is damaged and there is no v2 and no cache", async () => {
    const root = await directory();
    const frames: Uint8Array[] = [];
    for await (const frame of snapshotFrames(snapshot([ticket("x"), ticket("y")], [], 1), async () => undefined, { maxBytes: 1, maxRows: 1 })) frames.push(frame);
    const damaged = Buffer.concat(frames);
    damaged[13 + 5] = (damaged[13 + 5]! + 1) % 256;
    nodeFs.writeFileSync(nodePath.join(root, JOURNAL_FILE), damaged);
    await expect(createDurableLocalFirstStore(root).export()).rejects.toThrow("local_first_store_corrupt");
  });
});

describe("a row v3 deleted", () => {
  it("stays deleted when the older window edits it in v2", async () => {
    const root = await directory();
    const v2 = nodePath.join(root, LEGACY_JOURNAL_FILE);
    nodeFs.writeFileSync(v2, encodeJournalFrame(snapshot([ticket("a"), ticket("c")], [], 1)));
    const first = createDurableLocalFirstStore(root);
    await idsOf(first);
    await first.transact(async (tx) => { await tx.delete("ticket", "c"); });
    nodeFs.appendFileSync(v2, encodeJournalFrame(snapshot([ticket("a"), ticket("c", 2)], [], 1)));
    expect(await idsOf(createDurableLocalFirstStore(root))).toEqual(["a"]);
  });
});

describe("a second window waiting on the lock", () => {
  it("succeeds when the holder keeps it past the old 1.5 s timeout", async () => {
    const root = await directory();
    const first = createDurableLocalFirstStore(root);
    const second = createDurableLocalFirstStore(root);
    const holding = first.transact(async (tx) => {
      await new Promise((resolve) => setTimeout(resolve, 2_200));
      await tx.put(ticket("from-first"));
    });
    const lock = nodePath.join(root, "local-first-v1.lock");
    for (let waited = 0; !nodeFs.existsSync(lock) && waited < 5_000; waited += 5) await new Promise((resolve) => setTimeout(resolve, 5));
    const started = Date.now();
    await second.transact(async (tx) => { await tx.put(ticket("from-second")); });
    expect(Date.now() - started).toBeGreaterThanOrEqual(1_500);
    await holding;
    expect(await idsOf(createDurableLocalFirstStore(root))).toEqual(["from-first", "from-second"]);
  }, 20_000);
});

describe("the commit path", () => {
  it("never calls an API client", () => {
    const source = nodeFs.readFileSync(new URL("./durableLocalFirstStore.ts", import.meta.url), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).not.toMatch(/\bbfApi\b/);
    expect(code).not.toMatch(/node:https?/);
    expect(code).not.toMatch(/XMLHttpRequest/);
  });
});
