import { describe, expect, it, vi } from "vitest";
import type { KnowledgeFiles } from "./fileManifest.js";
import type { PumpArgs, ReplicaState } from "./replicaPump.js";

// The pump is a spy that runs until its signal aborts: what is asserted is that the HOST stops it when the lock is lost.
const signals: AbortSignal[] = [];
vi.mock("./replicaPump.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./replicaPump.js")>();
  return {
    ...real,
    pumpReplica: vi.fn(async (args: PumpArgs): Promise<ReplicaState> => {
      signals.push(args.signal);
      await new Promise<void>((resolve) => args.signal.addEventListener("abort", () => resolve(), { once: true }));
      return { dirty: 1, sending: false, failed: [] };
    }),
  };
});

import { createReplicaHost, type PumpSource } from "./replicaHost.js";
import type { ReplicaLockPort } from "./replicaLock.js";

const ROOT = "repo/docs";

function memoryFiles(): KnowledgeFiles {
  const data = new Map<string, string>();
  return { read: async (n) => data.get(n), write: async (n, t) => { data.set(n, t); } };
}

describe("the replica host and a lost lock", () => {
  it("regression: a lock lost to another host (after a stall) stops the pump at once and is reported", async () => {
    const lost = new AbortController();
    const release = vi.fn(async () => undefined);
    const lock: ReplicaLockPort = { acquire: async () => ({ release, lost: lost.signal }) };
    const report = vi.fn();
    const host = createReplicaHost({ lock, report });
    const files = memoryFiles();
    const source: PumpSource = { rootId: ROOT, files, local: {} as never, client: {} as never, projectId: 7, manifest: {} as never };

    const running = host.startReplicaPump(source);
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    expect(signals[0]!.aborted).toBe(false);

    lost.abort(); // the lock's refresh found another owner's stamp
    await running;
    expect(signals[0]!.aborted).toBe(true);
    expect(report).toHaveBeenCalledWith("replica lock", expect.any(Error));
    expect(release).toHaveBeenCalledTimes(1);
    expect(await host.drainedWithin(ROOT, 10)).toBe("pending"); // nothing of ours drained
    await host.disposeReplicas();
  });
});
