import { afterEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeFiles, PumpArgs, ReplicaState } from "@builderforce/agent-tools/knowledge";

// The pump itself is agent-tools' (tested there): here it is a spy, so the host's part - clear the failures, then kick the pump now - is what is asserted.
const pumped: PumpArgs[] = [];
vi.mock("@builderforce/agent-tools/knowledge", async (importOriginal) => {
  const real = await importOriginal<typeof import("@builderforce/agent-tools/knowledge")>();
  return {
    ...real,
    pumpReplica: vi.fn(async (args: PumpArgs): Promise<ReplicaState> => {
      pumped.push({ ...args, initial: args.initial ? { ...args.initial, failed: [...args.initial.failed] } : undefined } as PumpArgs);
      // The first pump fails an upload; any later one succeeds.
      const next: ReplicaState = pumped.length === 1
        ? { dirty: 3, sending: false, failed: [{ reason: "server error", status: 500 }], paused: "unreachable" }
        : { dirty: 0, sending: false, failed: [] };
      args.onState?.(next);
      return next;
    }),
  };
});

import { disposeReplicas, replicaDrained, replicaStatusOf, retryReplica, startReplicaPump, type PumpSource } from "./knowledgeReplica";

const ROOT = "repo/docs";

function memoryFiles(): KnowledgeFiles {
  const data = new Map<string, string>();
  return { read: async (n) => data.get(n), write: async (n, t) => { data.set(n, t); } };
}

const sourceOf = (files: KnowledgeFiles): PumpSource => ({
  rootId: ROOT, files, local: {} as never, client: {} as never, projectId: 7, manifest: {} as never,
});

afterEach(async () => { await disposeReplicas(); pumped.length = 0; });

describe("Retry upload (the replica host)", () => {
  it("clears the recorded failures and the pause, then runs the pump now with the empty set", async () => {
    const files = memoryFiles();
    const source = sourceOf(files);
    await startReplicaPump(source);
    expect((await replicaStatusOf(ROOT, files)).failed).toHaveLength(1);
    expect((await replicaStatusOf(ROOT, files)).paused).toBe("unreachable");

    expect(retryReplica(source)).toBeUndefined(); // returns at once: it never holds a request open for the upload
    await replicaDrained(ROOT);

    expect(pumped).toHaveLength(2);
    expect(pumped[1]!.initial?.failed).toEqual([]);
    expect(pumped[1]!.initial?.paused).toBeUndefined();
    expect((await replicaStatusOf(ROOT, files)).failed).toEqual([]);
  });

  it("kicks at once, not on the live-edit schedule, and leaves a pump that is already running alone", async () => {
    const files = memoryFiles();
    const source = sourceOf(files);
    const first = startReplicaPump(source);
    retryReplica(source); // a pump is running: no second one starts
    await first;
    expect(pumped).toHaveLength(1);
  });
});
