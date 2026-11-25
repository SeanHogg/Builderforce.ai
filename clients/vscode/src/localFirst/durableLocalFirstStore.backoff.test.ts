import nodeFs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newLocalRecord } from "@builderforce/local-first";
import { createDurableLocalFirstStore, type DurableLocalFirstStore } from "./durableLocalFirstStore";
import { JOURNAL_FILE } from "./localFirstJournalIo";
import { createCompactionBackoff } from "./localFirstCompactionBackoff";

const directories: string[] = [];

async function directory(): Promise<string> {
  const created = await mkdtemp(nodePath.join(tmpdir(), "bf-durable-backoff-"));
  directories.push(created);
  return created;
}

const ticket = (id: string) => newLocalRecord({ id, entityType: "ticket", payload: { title: id }, deviceId: "device-1" });
const put = (store: DurableLocalFirstStore, id: string) => store.transact(async (tx) => { await tx.put(ticket(id)); });

/** Count renames onto `suffix`; `fail` decides (by call number, from 1) whether one throws instead. */
function watchRenames(suffix: string, fail: (call: number) => Error | undefined): string[] {
  const realRename = nodeFs.promises.rename.bind(nodeFs.promises);
  const calls: string[] = [];
  vi.spyOn(nodeFs.promises, "rename").mockImplementation(async (from, to) => {
    if (!String(to).endsWith(suffix)) return realRename(from, to);
    calls.push(String(from));
    const error = fail(calls.length);
    if (error) throw error;
    return realRename(from, to);
  });
  return calls;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("failed compaction backoff", () => {
  it("does not re-run a failing compaction inside the window, and runs again after it", async () => {
    const root = await directory();
    const errors: unknown[] = [];
    let at = 0;
    const compactionBackoff = createCompactionBackoff({ now: () => at, baseMs: 1000, maxMs: 8000 });
    const store = createDurableLocalFirstStore(root, {
      compaction: { maxFrames: 2 },
      compactionBackoff,
      onBackgroundError: (error) => errors.push(error),
    });
    const renames = watchRenames(JOURNAL_FILE, () => new Error("rename refused"));
    await put(store, "one");
    await put(store, "two"); // trips the policy: attempt 1 fails
    await store.flush();
    expect(renames).toHaveLength(1);
    expect(errors).toHaveLength(1);

    await put(store, "three");
    await put(store, "four");
    await store.flush();
    expect(renames).toHaveLength(1); // inside the window: nothing queued
    expect(errors).toHaveLength(1);

    at = 1000;
    await put(store, "five");
    await store.flush();
    expect(renames).toHaveLength(2); // window passed: tried again (and failed again)
    expect(errors).toHaveLength(2);

    at = 1000 + 1999; // the window doubled to 2000
    await put(store, "six");
    await store.flush();
    expect(renames).toHaveLength(2);
  });

  it("a burst of commits queues exactly one job; no stream starts inside the window; reopening loses nothing", async () => {
    const root = await directory();
    const errors: unknown[] = [];
    const store = createDurableLocalFirstStore(root, {
      compaction: { maxFrames: 2 },
      compactionBackoff: createCompactionBackoff({ now: () => 0, baseMs: 1000, maxMs: 8000 }),
      onBackgroundError: (error) => errors.push(error),
    });
    const renames = watchRenames(JOURNAL_FILE, () => new Error("rename refused"));
    const realOpen = nodeFs.promises.open.bind(nodeFs.promises) as (...args: unknown[]) => Promise<unknown>;
    let streams = 0;
    vi.spyOn(nodeFs.promises, "open").mockImplementation((async (...args: unknown[]) => {
      if (args[1] === "wx" && String(args[0]).includes(JOURNAL_FILE) && String(args[0]).endsWith(".tmp")) streams += 1;
      return realOpen(...args);
    }) as never);

    const ids = ["a", "b", "c", "d", "e", "f"];
    await Promise.all(ids.map((id) => put(store, id)));
    await store.flush();
    expect(streams).toBe(1);
    expect(renames).toHaveLength(1);
    expect(errors).toHaveLength(1);

    await put(store, "g");
    await put(store, "h");
    await store.flush();
    expect(streams).toBe(1); // backed off: the policy is still true, nothing is streamed
    expect(renames).toHaveLength(1);
    expect(errors).toHaveLength(1);

    const reopened = createDurableLocalFirstStore(root);
    expect((await reopened.export()).records.map((record) => record.id).sort()).toEqual([...ids, "g", "h"]);
  });

  it("a success resets the delay", async () => {
    const root = await directory();
    let at = 0;
    const store = createDurableLocalFirstStore(root, {
      compaction: { maxFrames: 2 },
      compactionBackoff: createCompactionBackoff({ now: () => at, baseMs: 1000, maxMs: 8000 }),
      onBackgroundError: () => undefined,
    });
    const renames = watchRenames(JOURNAL_FILE, (call) => (call === 1 ? new Error("rename refused") : undefined));
    await put(store, "one");
    await put(store, "two"); // fails
    await store.flush();
    at = 1000;
    await put(store, "three"); // retried: succeeds, folds the tail
    await store.flush();
    expect(renames).toHaveLength(2);

    await put(store, "four");
    await put(store, "five"); // tail trips the policy again; no backoff pending
    await store.flush();
    expect(renames).toHaveLength(3);
  });
});

describe("snapshot cache write", () => {
  it("retries a transient rename error and the cache lands", async () => {
    const root = await directory();
    const errors: unknown[] = [];
    const store = createDurableLocalFirstStore(root, { onBackgroundError: (error) => errors.push(error) });
    await put(store, "one");
    const renames = watchRenames(nodePath.basename(store.snapshotFile), (call) =>
      call === 1 ? Object.assign(new Error("EBUSY: rename"), { code: "EBUSY" }) : undefined);
    await store.flush();

    expect(errors).toEqual([]);
    expect(renames).toHaveLength(2);
    expect(JSON.parse(nodeFs.readFileSync(store.snapshotFile, "utf8")).records).toHaveLength(1);
    expect(nodeFs.readdirSync(root).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});
