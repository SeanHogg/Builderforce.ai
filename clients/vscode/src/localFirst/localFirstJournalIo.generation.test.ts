import nodeFs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createMemoryLocalFirstStore,
  encodeDeltaFrame,
  newLocalRecord,
  scanJournalAsync,
  snapshotFrames,
  type LocalFirstDelta,
  type LocalFirstSnapshot,
} from "@builderforce/local-first";
import { compactJournal } from "./localFirstCompaction";
import { JOURNAL_FILE, createNodeJournalIo, sameFile } from "./localFirstJournalIo";

const directories: string[] = [];

async function directory(): Promise<string> {
  const created = await mkdtemp(nodePath.join(tmpdir(), "bf-journal-generation-"));
  directories.push(created);
  return created;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const ticket = (id: string) => newLocalRecord({ id, entityType: "ticket", payload: { title: id }, deviceId: "device-1" });

/** A snapshot of `ids`, and the delta the last put committed. */
async function build(...ids: string[]): Promise<{ snapshot: LocalFirstSnapshot; lastDelta: LocalFirstDelta | undefined }> {
  let lastDelta: LocalFirstDelta | undefined;
  const store = createMemoryLocalFirstStore(undefined, { onCommit: async (delta) => { lastDelta = delta; } });
  for (const id of ids) await store.transact(async (tx) => { await tx.put(ticket(id)); });
  return { snapshot: store.view(), lastDelta };
}

/** The base generation the file itself carries, read with the open scan (the one that returns `JournalOpenScan`). */
const fileGeneration = async (root: string): Promise<string | undefined> =>
  (await scanJournalAsync(new Uint8Array(nodeFs.readFileSync(nodePath.join(root, JOURNAL_FILE))), async () => undefined)).generation;

describe("journal identity generation", () => {
  it("io.compact tracks the generation of the base it just wrote", async () => {
    const root = await directory();
    const io = createNodeJournalIo(root);
    await io.compact((await build("one")).snapshot);
    expect(io.identity()?.generation).toBeDefined();
    expect(io.identity()?.generation).toBe(await fileGeneration(root));
  });

  it("a two-phase compaction (publishCompacted) tracks the new base's generation", async () => {
    const root = await directory();
    const io = createNodeJournalIo(root);
    await io.compact((await build("one")).snapshot);
    const before = io.identity()?.generation;
    const two = await build("one", "two");
    await io.append(encodeDeltaFrame(two.lastDelta!));
    await compactJournal({ io, view: () => two.snapshot, exclusive: (work) => work(), policy: { maxFrames: 1 } });
    const after = io.identity()?.generation;
    expect(after).toBeDefined();
    expect(after).not.toBe(before);
    expect(after).toBe(await fileGeneration(root));
  });

  it("a foreign compaction (another generation, same ino) is a different file", async () => {
    const root = await directory();
    const io = createNodeJournalIo(root);
    await io.compact((await build("one")).snapshot);
    const mine = io.identity()!;
    expect(sameFile(mine, { ...mine, generation: "someone-elses-base" })).toBe(false);
    expect(sameFile(mine, { ...mine })).toBe(true);
  });

  it("readTail reloads when ino and birth time are identical but the base generation differs", async () => {
    const root = await directory();
    const file = nodePath.join(root, JOURNAL_FILE);
    const io = createNodeJournalIo(root);
    const one = await build("one");
    await io.compact(one.snapshot);
    const tracked = io.identity()!;
    expect((await io.readTail()).kind).toBe("unchanged");

    // Rewrite the SAME inode in place (r+, truncate, write): a foreign base with another (same-length)
    // generation, followed by a valid delta, so a reader that trusted stat identity would read a tail.
    const foreign = { ...(await build("one", "two")) };
    const frames: Uint8Array[] = [];
    for await (const frame of snapshotFrames(one.snapshot, async () => undefined, undefined, "f".repeat(tracked.generation!.length))) frames.push(frame);
    frames.push(encodeDeltaFrame(foreign.lastDelta!));
    const bytes = Buffer.concat(frames);
    const handle = await nodeFs.promises.open(file, "r+");
    try {
      await handle.truncate(0);
      await handle.write(bytes, 0, bytes.length, 0);
    } finally {
      await handle.close();
    }

    const stat = await nodeFs.promises.stat(file, { bigint: true });
    expect({ ino: stat.ino, birthtimeNs: stat.birthtimeNs }).toEqual({ ino: tracked.ino, birthtimeNs: tracked.birthtimeNs });
    expect((await io.readTail()).kind).toBe("reload");
  });

  it("another window's compaction makes the tracked tail read reload", async () => {
    const root = await directory();
    const a = createNodeJournalIo(root);
    await a.compact((await build("one")).snapshot);
    const b = createNodeJournalIo(root);
    await b.compact((await build("one", "two")).snapshot);
    expect(b.identity()?.generation).not.toBe(a.identity()?.generation);
    expect((await a.readTail()).kind).toBe("reload");
  });
});
