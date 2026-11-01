import nodeFs from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newLocalRecord, scanJournal } from "@builderforce/local-first";
import { createDurableLocalFirstStore, type DurableLocalFirstStore } from "./durableLocalFirstStore";
import { JOURNAL_FILE } from "./localFirstJournalIo";

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

describe("two-phase compaction", () => {
  it("lands a commit made by another window while streaming, and it survives reopen", async () => {
    const root = await directory();
    const errors: unknown[] = [];
    const a = createDurableLocalFirstStore(root, { compaction: { maxFrames: 2 }, onBackgroundError: (e) => errors.push(e) });
    const b = createDurableLocalFirstStore(root);
    await put(a, "one");
    await put(a, "two");
    hookStreaming(() => put(b, "mid-stream"));
    await put(a, "three");
    await a.flush();

    expect(errors).toEqual([]);
    expect(await temporaries(root)).toEqual([]);
    expect(journalIds(root)).toEqual(["mid-stream", "one", "three", "two"]);
    expect(await idsOf(a)).toEqual(["mid-stream", "one", "three", "two"]);
    // A later commit and another window's tail read neither re-apply nor lose frames.
    await put(a, "after");
    expect(await idsOf(b)).toEqual(["after", "mid-stream", "one", "three", "two"]);
    await put(b, "from-b");
    expect(await idsOf(a)).toEqual(["after", "from-b", "mid-stream", "one", "three", "two"]);
    expect(await idsOf(createDurableLocalFirstStore(root))).toEqual(["after", "from-b", "mid-stream", "one", "three", "two"]);
  });

  it("discards its temp, losing nothing, when another window compacted while streaming", async () => {
    const root = await directory();
    const errors: unknown[] = [];
    const a = createDurableLocalFirstStore(root, { compaction: { maxFrames: 2 }, onBackgroundError: (e) => errors.push(e) });
    const b = createDurableLocalFirstStore(root, { compaction: { maxFrames: 1 } });
    await put(a, "one");
    await put(a, "two");
    const realRename = nodeFs.promises.rename.bind(nodeFs.promises);
    const journalRenames: string[] = [];
    vi.spyOn(nodeFs.promises, "rename").mockImplementation(async (from, to) => {
      if (String(to).endsWith(JOURNAL_FILE)) journalRenames.push(String(from));
      return realRename(from, to);
    });
    hookStreaming(async () => {
      await put(b, "mid-stream");
      await b.flush(); // b's own compaction publishes: the journal file is replaced
    });
    await put(a, "three");
    await a.flush();

    expect(errors).toEqual([]);
    expect(journalRenames).toHaveLength(1); // b's; a's temp was dropped, not published
    expect(await temporaries(root)).toEqual([]);
    expect(journalIds(root)).toEqual(["mid-stream", "one", "three", "two"]);
    expect(await idsOf(a)).toEqual(["mid-stream", "one", "three", "two"]);
    await put(a, "after");
    expect(await idsOf(createDurableLocalFirstStore(root))).toEqual(["after", "mid-stream", "one", "three", "two"]);
  });

  it("leaves the journal intact and no temp behind when the rename fails", async () => {
    const root = await directory();
    const errors: unknown[] = [];
    const a = createDurableLocalFirstStore(root, { compaction: { maxFrames: 2 }, onBackgroundError: (e) => errors.push(e) });
    await put(a, "one");
    await put(a, "two");
    const realRename = nodeFs.promises.rename.bind(nodeFs.promises);
    let before: Buffer | undefined;
    vi.spyOn(nodeFs.promises, "rename").mockImplementation(async (from, to) => {
      if (!String(to).endsWith(JOURNAL_FILE)) return realRename(from, to);
      before = nodeFs.readFileSync(nodePath.join(root, JOURNAL_FILE));
      throw new Error("rename refused");
    });
    await put(a, "three");
    await a.flush();

    expect(errors).toHaveLength(1);
    expect(before).toBeDefined();
    expect(nodeFs.readFileSync(nodePath.join(root, JOURNAL_FILE)).equals(before!)).toBe(true);
    expect(await temporaries(root)).toEqual([]);
    expect(await idsOf(createDurableLocalFirstStore(root))).toEqual(["one", "three", "two"]);
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
