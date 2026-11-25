import nodeFs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newLocalRecord } from "@builderforce/local-first";
import { createDurableLocalFirstStore, type DurableLocalFirstStore } from "./durableLocalFirstStore";
import { JOURNAL_FILE } from "./localFirstJournalIo";

const directories: string[] = [];

async function directory(): Promise<string> {
  const created = await mkdtemp(nodePath.join(tmpdir(), "bf-durable-freshness-"));
  directories.push(created);
  return created;
}

const ticket = (id: string) => newLocalRecord({ id, entityType: "ticket", payload: { title: id }, deviceId: "device-1" });
const put = (store: DurableLocalFirstStore, id: string) => store.transact(async (tx) => { await tx.put(ticket(id)); });

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("a read racing this window's catch-up", () => {
  it("returns another window's finished commit, not the state from before it", async () => {
    const root = await directory();
    const a = createDurableLocalFirstStore(root);
    const b = createDurableLocalFirstStore(root);
    await put(a, "one");
    await put(b, "two"); // finished before anything below starts; a has not seen it

    // Hold a's next commit inside its lock-holding catch-up (the journal stat in `readTail`).
    const realStat = nodeFs.promises.stat.bind(nodeFs.promises) as (...args: unknown[]) => Promise<unknown>;
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    let reached!: () => void;
    const atCatchUp = new Promise<void>((resolve) => { reached = resolve; });
    let gated = false;
    vi.spyOn(nodeFs.promises, "stat").mockImplementation((async (...args: unknown[]) => {
      if (!gated && String(args[0]).endsWith(JOURNAL_FILE)) {
        gated = true;
        reached();
        await released;
      }
      return realStat(...args);
    }) as never);

    const commit = put(a, "three");
    await atCatchUp; // a holds the lock and is catching up: `inTransaction`, memory not yet refreshed
    const read = a.export();
    release();
    const ids = (await read).records.map((record) => record.id);
    await commit;

    expect(ids).toEqual(expect.arrayContaining(["one", "two"]));
  });

  it("still returns another window's finished commit when the catch-up it waited on threw", async () => {
    const root = await directory();
    const a = createDurableLocalFirstStore(root);
    const b = createDurableLocalFirstStore(root);
    await put(a, "one");
    await put(b, "two");

    const realStat = nodeFs.promises.stat.bind(nodeFs.promises) as (...args: unknown[]) => Promise<unknown>;
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    let reached!: () => void;
    const atCatchUp = new Promise<void>((resolve) => { reached = resolve; });
    let gated = false;
    vi.spyOn(nodeFs.promises, "stat").mockImplementation((async (...args: unknown[]) => {
      if (!gated && String(args[0]).endsWith(JOURNAL_FILE)) {
        gated = true;
        reached();
        await released;
        throw new Error("injected catch-up failure"); // only the gated catch-up fails
      }
      return realStat(...args);
    }) as never);

    const commit = put(a, "three");
    const commitFailed = expect(commit).rejects.toThrow("injected catch-up failure");
    await atCatchUp;
    const read = a.export();
    release();
    const ids = (await read).records.map((record) => record.id);
    await commitFailed;

    expect(ids).toEqual(expect.arrayContaining(["one", "two"]));
  });
});
