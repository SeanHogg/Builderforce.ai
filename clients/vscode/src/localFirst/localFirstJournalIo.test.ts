import nodeFs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_JOURNAL_COMPACTION, decodeJournalFrames, encodeJournalFrame, newLocalRecord } from "@builderforce/local-first";
import { createDurableLocalFirstStore } from "./durableLocalFirstStore";
import { createNodeJournalIo } from "./localFirstJournalIo";

const directories: string[] = [];

async function directory(): Promise<string> {
  const created = await mkdtemp(nodePath.join(tmpdir(), "bf-journal-io-"));
  directories.push(created);
  return created;
}

const empty = { records: [], events: [], mappings: [], receipts: [], conflicts: [], cursors: {}, nextSequence: 1 };

function ticket(id: string) {
  return newLocalRecord({ id, entityType: "ticket", payload: { title: id }, deviceId: "device-1" });
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("VSIX journal io", () => {
  it("appends without re-reading the journal: the committed prefix is tracked in memory", async () => {
    const root = await directory();
    const io = createNodeJournalIo(root);
    await io.open();
    const reads = vi.spyOn(nodeFs.promises, "readFile");
    await io.append(encodeJournalFrame(empty));
    await io.append(encodeJournalFrame({ ...empty, nextSequence: 2 }));
    expect(reads).not.toHaveBeenCalled();
    expect(io.frames()).toBe(2);
    reads.mockRestore();
    expect(decodeJournalFrames(new Uint8Array(nodeFs.readFileSync(io.journalFile)))).toHaveLength(2);
  });

  it("cuts a torn tail before the next frame and keeps every committed frame", async () => {
    const root = await directory();
    const io = createNodeJournalIo(root);
    await io.append(encodeJournalFrame(empty));
    nodeFs.appendFileSync(io.journalFile, Buffer.from([0x42, 0x46, 0x4a]));
    const reopened = createNodeJournalIo(root);
    expect((await reopened.open()).frames).toBe(1);
    await reopened.append(encodeJournalFrame({ ...empty, nextSequence: 3 }));
    const frames = decodeJournalFrames(new Uint8Array(nodeFs.readFileSync(io.journalFile)));
    expect(frames.map((frame) => frame.nextSequence)).toEqual([1, 3]);
  });

  it("compacts the store's journal to one frame on the shared policy, without losing a commit", async () => {
    const root = await directory();
    const store = createDurableLocalFirstStore(root, { compaction: { maxFrames: 3 } });
    for (const id of ["t-1", "t-2", "t-3", "t-4"]) {
      await store.transact(async (tx) => {
        await tx.put(ticket(id));
      });
    }
    await store.flush();
    const frames = decodeJournalFrames(new Uint8Array(nodeFs.readFileSync(store.journalFile)));
    // Compacted at the third commit, then one more frame.
    expect(frames).toHaveLength(2);
    expect(frames.at(-1)?.records.map((record) => record.id).sort()).toEqual(["t-1", "t-2", "t-3", "t-4"]);
    expect(DEFAULT_JOURNAL_COMPACTION.maxFrames).toBeGreaterThan(3);

    const restarted = createDurableLocalFirstStore(root);
    expect((await restarted.export()).records).toHaveLength(4);
  });

  it("reloads another window's commit before committing, so neither write is lost", async () => {
    const root = await directory();
    const windowA = createDurableLocalFirstStore(root);
    const windowB = createDurableLocalFirstStore(root);
    await windowA.transact(async (tx) => { await tx.put(ticket("from-a")); });
    // B opened nothing yet; A commits again after B's first read.
    expect((await windowB.export()).records.map((record) => record.id)).toEqual(["from-a"]);
    await windowA.transact(async (tx) => { await tx.put(ticket("from-a-2")); });
    await windowB.transact(async (tx) => { await tx.put(ticket("from-b")); });
    await windowA.flush();
    await windowB.flush();
    const ids = (await windowA.export()).records.map((record) => record.id).sort();
    expect(ids).toEqual(["from-a", "from-a-2", "from-b"]);
  });
});
