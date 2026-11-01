import nodeFs from "node:fs";
import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeJournalFrame, newLocalRecord, scanJournal, type LocalFirstSnapshot } from "@builderforce/local-first";
import { createDurableLocalFirstStore } from "./durableLocalFirstStore";
import { JOURNAL_FILE, LEGACY_JOURNAL_FILE } from "./localFirstJournalIo";

const directories: string[] = [];

async function directory(): Promise<string> {
  const created = await mkdtemp(nodePath.join(tmpdir(), "bf-durable-delta-"));
  directories.push(created);
  return created;
}

const ticket = (id: string) => newLocalRecord({ id, entityType: "ticket", payload: { title: id }, deviceId: "device-1" });

const snapshotOf = (...ids: string[]): LocalFirstSnapshot => ({
  records: ids.map(ticket),
  events: [],
  mappings: [],
  receipts: [],
  conflicts: [],
  cursors: {},
  nextSequence: 3,
});

const idsOf = async (store: ReturnType<typeof createDurableLocalFirstStore>): Promise<string[]> =>
  (await store.export()).records.map((record) => record.id).sort();

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("opening over a v2 journal", () => {
  it("imports it once, under the lock, and leaves v2 byte-for-byte untouched", async () => {
    const root = await directory();
    const v2 = nodePath.join(root, LEGACY_JOURNAL_FILE);
    const cache = nodePath.join(root, "local-first-v1.json");
    await writeFile(v2, encodeJournalFrame(snapshotOf("from-v2", "also-v2")));
    await writeFile(cache, JSON.stringify(snapshotOf("from-v2", "also-v2")));
    const before = nodeFs.readFileSync(v2);
    const link = vi.spyOn(nodeFs.promises, "link");

    const first = createDurableLocalFirstStore(root);
    const second = createDurableLocalFirstStore(root);
    // Two windows opening at once: both find the same store, and v3 is written once.
    const [a, b] = await Promise.all([idsOf(first), idsOf(second)]);
    expect(a).toEqual(["also-v2", "from-v2"]);
    expect(b).toEqual(a);
    expect(link.mock.calls.some(([, target]) => String(target).endsWith("local-first-v1.lock"))).toBe(true);

    const v3 = nodeFs.readFileSync(nodePath.join(root, JOURNAL_FILE));
    expect(scanJournal(new Uint8Array(v3))).toMatchObject({ frames: 1 });
    expect(scanJournal(new Uint8Array(v3)).latest?.records.map((record) => record.id).sort()).toEqual(["also-v2", "from-v2"]);
    expect(nodeFs.existsSync(cache)).toBe(false);
    expect(nodeFs.existsSync(`${cache}.pre-v3`)).toBe(true);

    await first.transact(async (tx) => { await tx.put(ticket("after-import")); });
    await first.flush();
    expect(nodeFs.readFileSync(v2).equals(before)).toBe(true);
    expect(nodeFs.existsSync(nodePath.join(root, "local-first-v1.lock"))).toBe(false);

    // A later open reads v3 alone: v2 is never read again.
    const reads = vi.spyOn(nodeFs.promises, "readFile");
    const later = createDurableLocalFirstStore(root);
    expect(await idsOf(later)).toEqual(["after-import", "also-v2", "from-v2"]);
    expect(reads.mock.calls.some(([target]) => String(target).endsWith(LEGACY_JOURNAL_FILE))).toBe(false);
  });

  it("still imports a lone local-first-v1.json when there is no v2", async () => {
    const root = await directory();
    await writeFile(nodePath.join(root, "local-first-v1.json"), JSON.stringify(snapshotOf("legacy-only")));
    const store = createDurableLocalFirstStore(root);
    expect(await idsOf(store)).toEqual(["legacy-only"]);
    expect(scanJournal(new Uint8Array(nodeFs.readFileSync(store.journalFile))).latest?.records).toHaveLength(1);
  });
});

describe("orphaned temp files", () => {
  it("removes only the exact temp patterns, and only once they are old", async () => {
    const root = await directory();
    const old = ["local-first-v1.json.4242.1700000000000.tmp", "local-first-v1.lock.9f1c2b.tmp", "local-first-v2.journal.4242.17.tmp", "local-first-v3.journal.4242.17.tmp"];
    const kept = ["local-first-v1.json.corrupt-1700000000000", "local-first-v1.json.pre-v3", "notes.tmp", "local-first-v3.journal.keep", "local-first-v3.journal.x.tmp", "local-first-v2.journal"];
    const fresh = "local-first-v1.json.4242.1700000000001.tmp";
    for (const name of [...old, ...kept, fresh]) await writeFile(nodePath.join(root, name), "x");
    const longAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    for (const name of [...old, ...kept]) await utimes(nodePath.join(root, name), longAgo, longAgo);

    await idsOf(createDurableLocalFirstStore(root));

    const left = await readdir(root);
    for (const name of old) expect(left, name).not.toContain(name);
    for (const name of [...kept, fresh]) expect(left, name).toContain(name);
  });
});

describe("another window's commits", () => {
  it("are applied from the tail alone, without reading the journal back whole", async () => {
    const root = await directory();
    const a = createDurableLocalFirstStore(root);
    const b = createDurableLocalFirstStore(root);
    await a.transact(async (tx) => { await tx.put(ticket("one")); });
    expect(await idsOf(b)).toEqual(["one"]);
    await a.transact(async (tx) => { await tx.put(ticket("two")); });
    await a.transact(async (tx) => { await tx.put(ticket("three")); });

    const probe = await nodeFs.promises.open(nodePath.join(root, JOURNAL_FILE), "r");
    const wholeFile = vi.spyOn(Object.getPrototypeOf(probe) as { readFile: () => unknown }, "readFile");
    await probe.close();
    const pathRead = vi.spyOn(nodeFs.promises, "readFile");
    const notified: unknown[] = [];
    b.subscribe((change) => { notified.push(change); });

    expect(await idsOf(b)).toEqual(["one", "three", "two"]);
    await b.transact(async (tx) => { await tx.put(ticket("from-b")); });
    expect(wholeFile).not.toHaveBeenCalled();
    // (The lock file is read on release; the journal never is.)
    expect(pathRead.mock.calls.some(([target]) => String(target).includes(".journal"))).toBe(false);
    // The foreign commit was announced with a change hint, not as "everything changed".
    expect(notified[0]).toMatchObject({ records: expect.any(Map) });

    expect(await idsOf(a)).toEqual(["from-b", "one", "three", "two"]);
    expect(wholeFile).not.toHaveBeenCalled();
  });

  it("are picked up by a full reload when the other window compacted the journal", async () => {
    const root = await directory();
    const a = createDurableLocalFirstStore(root, { compaction: { maxFrames: 2 } });
    const b = createDurableLocalFirstStore(root);
    await a.transact(async (tx) => { await tx.put(ticket("one")); });
    expect(await idsOf(b)).toEqual(["one"]);
    await a.transact(async (tx) => { await tx.put(ticket("two")); });
    await a.flush();
    await a.transact(async (tx) => { await tx.put(ticket("three")); });
    expect(await idsOf(b)).toEqual(["one", "three", "two"]);
    await b.transact(async (tx) => { await tx.put(ticket("four")); });
    expect(await idsOf(a)).toEqual(["four", "one", "three", "two"]);
  });
});

describe("commit side effects", () => {
  it("writes the JSON cache only from flush()", async () => {
    const root = await directory();
    const store = createDurableLocalFirstStore(root);
    await store.transact(async (tx) => { await tx.put(ticket("cached")); });
    expect(nodeFs.existsSync(store.snapshotFile)).toBe(false);
    await store.flush();
    expect(JSON.parse(nodeFs.readFileSync(store.snapshotFile, "utf8")).records).toHaveLength(1);
  });

  it("does not write a frame for a transaction that changed nothing", async () => {
    const root = await directory();
    const store = createDurableLocalFirstStore(root);
    await store.transact(async (tx) => { await tx.get("ticket", "nothing"); });
    expect(nodeFs.existsSync(store.journalFile)).toBe(false);
  });

  it("reports a failed compaction without failing the commit", async () => {
    const root = await directory();
    const failures: unknown[] = [];
    const store = createDurableLocalFirstStore(root, { compaction: { maxFrames: 2 }, onBackgroundError: (error) => failures.push(error) });
    const rename = vi.spyOn(nodeFs.promises, "rename").mockRejectedValueOnce(new Error("EPERM: rename"));
    await store.transact(async (tx) => { await tx.put(ticket("one")); });
    await store.transact(async (tx) => { await tx.put(ticket("two")); });
    await store.flush();
    expect(rename).toHaveBeenCalled();
    expect(failures).toHaveLength(1);
    await store.transact(async (tx) => { await tx.put(ticket("three")); });
    await store.flush();
    expect(await idsOf(createDurableLocalFirstStore(root))).toEqual(["one", "three", "two"]);
    expect(nodeFs.readdirSync(root).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("reports a commit slower than 250 ms with its frame size", async () => {
    const root = await directory();
    const slow: Array<[number, number]> = [];
    const store = createDurableLocalFirstStore(root, { onSlowCommit: (ms, bytes) => slow.push([ms, bytes]) });
    await store.transact(async (tx) => { await tx.put(ticket("fast")); });
    expect(slow).toEqual([]);
    await store.transact(async (tx) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await tx.put(ticket("slow"));
    });
    expect(slow).toHaveLength(1);
    expect(slow[0]![0]).toBeGreaterThanOrEqual(250);
    expect(slow[0]![1]).toBeGreaterThan(0);
  });
});
