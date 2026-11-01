import nodeFs from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newLocalRecord, scanJournal } from "@builderforce/local-first";
import { createDurableLocalFirstStore, type DurableLocalFirstStore } from "./durableLocalFirstStore";
import { JOURNAL_FILE, createNodeJournalIo } from "./localFirstJournalIo";

const directories: string[] = [];

async function directory(): Promise<string> {
  const created = await mkdtemp(nodePath.join(tmpdir(), "bf-durable-compaction-"));
  directories.push(created);
  return created;
}

const ticket = (id: string) => newLocalRecord({ id, entityType: "ticket", payload: { title: id }, deviceId: "device-1" });
const put = (store: DurableLocalFirstStore, id: string) => store.transact(async (tx) => { await tx.put(ticket(id)); });
const idsOf = async (store: DurableLocalFirstStore): Promise<string[]> =>
  (await store.export()).records.map((record) => record.id).sort();
const temporaries = async (root: string): Promise<string[]> => (await readdir(root)).filter((name) => name.endsWith(".tmp"));
const journalIds = (root: string): string[] =>
  (scanJournal(new Uint8Array(nodeFs.readFileSync(nodePath.join(root, JOURNAL_FILE)))).latest?.records ?? []).map((record) => record.id).sort();

/** Record renames onto the journal; `fail` decides (by call number, from 1) whether one throws instead. */
function watchJournalRenames(fail: (call: number) => Error | undefined = () => undefined): string[] {
  const realRename = nodeFs.promises.rename.bind(nodeFs.promises);
  const calls: string[] = [];
  vi.spyOn(nodeFs.promises, "rename").mockImplementation(async (from, to) => {
    if (!String(to).endsWith(JOURNAL_FILE)) return realRename(from, to);
    calls.push(String(from));
    const error = fail(calls.length);
    if (error) throw error;
    return realRename(from, to);
  });
  return calls;
}

/** Run `duringStream` once, right after the first compaction temp file is created (the lock-free phase). */
function hookStreaming(duringStream: () => Promise<void>): void {
  const realOpen = nodeFs.promises.open.bind(nodeFs.promises) as (...args: unknown[]) => Promise<unknown>;
  let fired = false;
  vi.spyOn(nodeFs.promises, "open").mockImplementation((async (...args: unknown[]) => {
    const handle = await realOpen(...args);
    if (!fired && args[1] === "wx" && String(args[0]).endsWith(".tmp")) {
      fired = true;
      await duringStream();
    }
    return handle;
  }) as never);
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

// maxFrames 2: the second commit trips the policy, so the hook is installed before it.
describe("two-phase compaction", () => {
  const all = ["mid-stream", "one", "two"];

  it("lands a commit made by another window while streaming, exactly, in the published file", async () => {
    const root = await directory();
    const errors: unknown[] = [];
    const a = createDurableLocalFirstStore(root, { compaction: { maxFrames: 2 }, onBackgroundError: (e) => errors.push(e) });
    const b = createDurableLocalFirstStore(root);
    await put(a, "one");
    hookStreaming(() => put(b, "mid-stream"));
    await put(a, "two");
    await a.flush();

    expect(errors).toEqual([]);
    expect(await temporaries(root)).toEqual([]);
    expect(journalIds(root)).toEqual(all);
    const bytes = nodeFs.readFileSync(nodePath.join(root, JOURNAL_FILE));
    const loaded = await createNodeJournalIo(root).load();
    expect(loaded.corrupt).toBeUndefined();
    expect(loaded.committedBytes).toBe(bytes.byteLength); // no torn or missing bytes
    expect(scanJournal(new Uint8Array(bytes)).frames).toBe(loaded.frames);
    expect(loaded.tailFrames).toBe(1); // the one caught-up frame follows the new base
    expect(loaded.tailBytes).toBeGreaterThan(0);
    expect(await idsOf(a)).toEqual(all);
    expect(await idsOf(createDurableLocalFirstStore(root))).toEqual(all);
  });

  it("keeps its counters exact: later commits in either window neither re-apply nor lose frames", async () => {
    const root = await directory();
    const a = createDurableLocalFirstStore(root, { compaction: { maxFrames: 2 } });
    const b = createDurableLocalFirstStore(root);
    await put(a, "one");
    hookStreaming(() => put(b, "mid-stream"));
    await put(a, "two");
    await a.flush();
    await put(a, "after");
    expect(await idsOf(b)).toEqual(["after", ...all]);
    await put(b, "from-b");
    expect(await idsOf(a)).toEqual(["after", "from-b", ...all]);
    expect(await idsOf(createDurableLocalFirstStore(root))).toEqual(["after", "from-b", ...all]);
  });

  it("discards its temp, losing nothing, when another window compacted while streaming", async () => {
    const root = await directory();
    const errors: unknown[] = [];
    const a = createDurableLocalFirstStore(root, { compaction: { maxFrames: 2 }, onBackgroundError: (e) => errors.push(e) });
    const b = createDurableLocalFirstStore(root, { compaction: { maxFrames: 1 } });
    await put(a, "one");
    const renames = watchJournalRenames();
    hookStreaming(async () => {
      await put(b, "mid-stream");
      await b.flush(); // b's own compaction publishes: the journal file is replaced
    });
    await put(a, "two");
    await a.flush();

    expect(errors).toEqual([]);
    expect(renames).toHaveLength(1); // b's; a's temp was dropped, not published
    expect(await temporaries(root)).toEqual([]);
    expect(journalIds(root)).toEqual(all);
    expect(await idsOf(a)).toEqual(all);
    await put(a, "after");
    expect(await idsOf(createDurableLocalFirstStore(root))).toEqual(["after", ...all]);
  });

  it("discards its temp when the same file shrank between the phases", async () => {
    const root = await directory();
    const errors: unknown[] = [];
    const a = createDurableLocalFirstStore(root, { compaction: { maxFrames: 3 }, onBackgroundError: (e) => errors.push(e) });
    const b = createDurableLocalFirstStore(root);
    const journal = nodePath.join(root, JOURNAL_FILE);
    await put(a, "one");
    const afterOne = nodeFs.statSync(journal).size;
    await put(a, `two-${"p".repeat(2000)}`);
    const renames = watchJournalRenames();
    hookStreaming(async () => {
      await nodeFs.promises.truncate(journal, afterOne); // same inode, fewer committed bytes
      for (const id of ["x", "y", "z"]) await put(b, id); // 3 tail frames: the policy still holds, so only the shrink check can stop the publish
    });
    await put(a, `three-${"q".repeat(2000)}`);
    await a.flush();

    expect(errors).toEqual([]);
    expect(renames).toHaveLength(0);
    expect(await temporaries(root)).toEqual([]);
    expect(await idsOf(a)).toEqual(["one", "x", "y", "z"]);
    expect(await idsOf(createDurableLocalFirstStore(root))).toEqual(["one", "x", "y", "z"]);
  });

  it("leaves the journal intact and no temp behind when the rename fails once", async () => {
    const root = await directory();
    const errors: unknown[] = [];
    const a = createDurableLocalFirstStore(root, { compaction: { maxFrames: 2 }, onBackgroundError: (e) => errors.push(e) });
    await put(a, "one");
    let before: Buffer | undefined;
    const renames = watchJournalRenames((call) => {
      if (call !== 1) return undefined;
      before = nodeFs.readFileSync(nodePath.join(root, JOURNAL_FILE));
      return new Error("rename refused");
    });
    await put(a, "two");
    await a.flush();

    expect(renames).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(before).toBeDefined();
    expect(nodeFs.readFileSync(nodePath.join(root, JOURNAL_FILE)).equals(before!)).toBe(true);
    expect(await temporaries(root)).toEqual([]);
    expect(await idsOf(createDurableLocalFirstStore(root))).toEqual(["one", "two"]);
  });

  it("retries a transient Windows rename error and still publishes", async () => {
    const root = await directory();
    const errors: unknown[] = [];
    const a = createDurableLocalFirstStore(root, { compaction: { maxFrames: 2 }, onBackgroundError: (e) => errors.push(e) });
    await put(a, "one");
    const renames = watchJournalRenames((call) => (call <= 2 ? Object.assign(new Error("EPERM: rename"), { code: "EPERM" }) : undefined));
    await put(a, "two");
    await a.flush();

    expect(errors).toEqual([]);
    expect(renames).toHaveLength(3);
    expect(await temporaries(root)).toEqual([]);
    expect(scanJournal(new Uint8Array(nodeFs.readFileSync(nodePath.join(root, JOURNAL_FILE)))).frames).toBe(1); // folded
    expect(await idsOf(createDurableLocalFirstStore(root))).toEqual(["one", "two"]);
  });

  it("folds queued commits once: later queued jobs find the policy already satisfied", async () => {
    const root = await directory();
    const errors: unknown[] = [];
    const a = createDurableLocalFirstStore(root, { compaction: { maxFrames: 2 }, onBackgroundError: (e) => errors.push(e) });
    await put(a, "one");
    const renames = watchJournalRenames();
    await Promise.all([put(a, "two"), put(a, "three"), put(a, "four")]);
    await a.flush(); // waits for the queued jobs

    expect(errors).toEqual([]);
    expect(renames).toHaveLength(1);
    expect(await temporaries(root)).toEqual([]);
    expect(await idsOf(createDurableLocalFirstStore(root))).toEqual(["four", "one", "three", "two"]);
  });

  it("reopens to identical rows after a compaction", async () => {
    const root = await directory();
    const a = createDurableLocalFirstStore(root, { compaction: { maxFrames: 2 } });
    for (const id of ["one", "two", "three", "four"]) await put(a, id);
    await a.flush();

    const reopened = createDurableLocalFirstStore(root);
    const sorted = async (store: DurableLocalFirstStore) => (await store.export()).records.sort((x, y) => x.id.localeCompare(y.id));
    expect(await sorted(reopened)).toEqual(await sorted(a));
    expect(await temporaries(root)).toEqual([]);
  });
});
