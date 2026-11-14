import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeFiles } from "./fileManifest.js";

const pumped: unknown[] = [];
vi.mock("./replicaPump.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./replicaPump.js")>();
  return {
    ...real,
    pumpReplica: vi.fn(async (args: { onState?: (s: never) => void }) => {
      pumped.push(args);
      const next = { dirty: 0, sending: false, failed: [], generationCheckedAt: Date.now() };
      args.onState?.(next as never);
      return next;
    }),
  };
});

import { createReplicaHost } from "./replicaHost.js";
import { fileReplicaLock } from "./replicaLock.js";

const ROOT = "repo/dbg";
function memoryFiles(): KnowledgeFiles {
  const data = new Map<string, string>();
  return { read: async (n) => data.get(n), write: async (n, t) => { data.set(n, t); } };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("debug", () => {
  it("pumps with default lock", async () => {
    const files = memoryFiles();
    const host = createReplicaHost();
    const p = host.startReplicaPump({ rootId: ROOT, files, local: {} as never, client: {} as never, projectId: 7, manifest: {} as never });
    let done = false;
    void p.then(() => { done = true; });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    console.log("after microtasks: done =", done, "pumped =", pumped.length);
    await vi.advanceTimersByTimeAsync(0);
    console.log("after advance 0: done =", done, "pumped =", pumped.length);
    await vi.advanceTimersByTimeAsync(35_000);
    console.log("after advance 35s: done =", done, "pumped =", pumped.length);
    await p;
    expect(pumped).toHaveLength(1);
  });

  it("acquires the default lock alone", async () => {
    const files = memoryFiles();
    const lock = fileReplicaLock();
    const got = await lock.acquire(files, ROOT);
    console.log("lock acquired:", !!got);
    expect(got).toBeTruthy();
    await got!.release();
  });
});
