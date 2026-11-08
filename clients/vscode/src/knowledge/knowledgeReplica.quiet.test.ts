import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeFiles, PumpArgs, ReplicaState } from "@builderforce/agent-tools/knowledge";

// The pump is agent-tools' (tested there); here it is a spy, so the host's part - WHEN a quiet root's pump starts - is what is asserted.
const pumped: PumpArgs[] = [];
/** What the next spy pump reports (default: a quiet, healthy root). */
const pumpResult = vi.hoisted(() => {
  let fn: (() => unknown) | undefined;
  return { set: (f: (() => unknown) | undefined) => { fn = f; }, get: () => fn as (() => ReplicaState) | undefined };
});
vi.mock("@builderforce/agent-tools/knowledge", async (importOriginal) => {
  const real = await importOriginal<typeof import("@builderforce/agent-tools/knowledge")>();
  return {
    ...real,
    pumpReplica: vi.fn(async (args: PumpArgs): Promise<ReplicaState> => {
      pumped.push({ ...args, initial: args.initial ? { ...args.initial } : undefined } as PumpArgs);
      const next: ReplicaState = pumpResult.get()?.() ?? { dirty: 0, sending: false, failed: [], generationCheckedAt: Date.now() };
      args.onState?.(next);
      return next;
    }),
  };
});

import { GENERATION_CHECK_INTERVAL_MS } from "@builderforce/agent-tools/knowledge";
import {
  disposeReplicas, kickReplicaPump, replicaDrained, replicaQueueFor, replicatedStoreOf, resumeReplica, setRootReviewing, startReplicaPump, stopReplicaPump, type PumpSource,
} from "./knowledgeReplica";

const ROOT = "repo/quiet";

function memoryFiles(): KnowledgeFiles {
  const data = new Map<string, string>();
  return { read: async (n) => data.get(n), write: async (n, t) => { data.set(n, t); } };
}

const sourceOf = (files: KnowledgeFiles): PumpSource => ({
  rootId: ROOT, files, local: {} as never, client: {} as never, projectId: 7, manifest: {} as never,
});

beforeEach(() => { vi.useFakeTimers(); });
afterEach(async () => { await disposeReplicas(); pumped.length = 0; pumpResult.set(undefined); vi.useRealTimers(); });

describe("a quiet linked root", () => {
  it("gets a pump started every GENERATION_CHECK_INTERVAL_MS, which forgets its last check so the pump really asks the server", async () => {
    const files = memoryFiles();
    await replicaQueueFor(ROOT, files).adopt(7); // a linked root: its queue is bound to the project
    await startReplicaPump(sourceOf(files));
    expect(pumped).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(GENERATION_CHECK_INTERVAL_MS - 1000);
    expect(pumped).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    await replicaDrained(ROOT);

    expect(pumped).toHaveLength(2);
    expect(pumped[1]!.initial?.generationCheckedAt).toBeUndefined();

    await vi.advanceTimersByTimeAsync(GENERATION_CHECK_INTERVAL_MS);
    await replicaDrained(ROOT);
    expect(pumped).toHaveLength(3);
  });

  it("is NOT pumped while a review of the root runs, and is again once it ends", async () => {
    const files = memoryFiles();
    await replicaQueueFor(ROOT, files).adopt(7); // a linked root: its queue is bound to the project
    await startReplicaPump(sourceOf(files));
    setRootReviewing(ROOT, files, true);

    await vi.advanceTimersByTimeAsync(GENERATION_CHECK_INTERVAL_MS * 2);
    expect(pumped).toHaveLength(1);

    setRootReviewing(ROOT, files, false);
    await vi.advanceTimersByTimeAsync(GENERATION_CHECK_INTERVAL_MS);
    await replicaDrained(ROOT);
    expect(pumped).toHaveLength(2);
  });

  it("stops being pumped once its pump is stopped (unlinked) or the host is disposed", async () => {
    const files = memoryFiles();
    await replicaQueueFor(ROOT, files).adopt(7); // a linked root: its queue is bound to the project
    await startReplicaPump(sourceOf(files));
    await stopReplicaPump(ROOT);
    await vi.advanceTimersByTimeAsync(GENERATION_CHECK_INTERVAL_MS * 3);
    expect(pumped).toHaveLength(1);

    await startReplicaPump(sourceOf(files)); // re-linked
    await disposeReplicas();
    await vi.advanceTimersByTimeAsync(GENERATION_CHECK_INTERVAL_MS * 3);
    expect(pumped).toHaveLength(2);
  });

  it("is pumped when the workspace opens with a queue bound to the project, acked or not (no ack = a reconcile is owed); an unbound one is not", async () => {
    const files = memoryFiles();
    const queue = replicaQueueFor(ROOT, files);
    await resumeReplica(sourceOf(files));
    await replicaDrained(ROOT);
    expect(pumped).toHaveLength(0); // never synced to this project: the first-sync flow owns it

    await queue.adopt(7);
    await resumeReplica(sourceOf(files)); // adopted, no ack
    await replicaDrained(ROOT);
    expect(pumped).toHaveLength(1);

    await queue.settle(await queue.snapshot(), { generation: 3, digest: "d" });
    await resumeReplica(sourceOf(files));
    await replicaDrained(ROOT);
    expect(pumped).toHaveLength(2);
  });

  it("does NOT restart a root with recorded failures or an auth pause on the interval, but does one that is merely unreachable", async () => {
    const files = memoryFiles();
    let next: ReplicaState = { dirty: 0, sending: false, failed: [{ reason: "bad", status: 422 }] };
    pumpResult.set(() => next);
    await startReplicaPump(sourceOf(files));
    await replicaQueueFor(ROOT, files).adopt(7);
    await vi.advanceTimersByTimeAsync(GENERATION_CHECK_INTERVAL_MS * 2);
    expect(pumped).toHaveLength(1); // failed: waits for Retry upload

    await disposeReplicas();
    pumped.length = 0;
    next = { dirty: 0, sending: false, failed: [], paused: "auth", pausedStatus: 401 };
    await startReplicaPump(sourceOf(files));
    await replicaQueueFor(ROOT, files).adopt(7);
    await vi.advanceTimersByTimeAsync(GENERATION_CHECK_INTERVAL_MS * 2);
    expect(pumped).toHaveLength(1); // auth-paused: the status keeps saying sign in

    await disposeReplicas();
    pumped.length = 0;
    next = { dirty: 0, sending: false, failed: [], paused: "unreachable" };
    await startReplicaPump(sourceOf(files));
    await replicaQueueFor(ROOT, files).adopt(7);
    await vi.advanceTimersByTimeAsync(GENERATION_CHECK_INTERVAL_MS);
    await replicaDrained(ROOT);
    expect(pumped).toHaveLength(2); // offline: tries again by itself
  });

  it("starts only the CURRENT source, and stops its timer once the root no longer resolves", async () => {
    const files = memoryFiles();
    const current: { source: PumpSource | undefined } = { source: sourceOf(files) };
    replicatedStoreOf(ROOT, files, {} as never, current.source, false, () => current.source);
    await replicaQueueFor(ROOT, files).adopt(7);
    await startReplicaPump(current.source!);
    expect(pumped).toHaveLength(1);

    current.source = { ...sourceOf(files), client: { marker: "new" } as never };
    await vi.advanceTimersByTimeAsync(GENERATION_CHECK_INTERVAL_MS);
    await replicaDrained(ROOT);
    expect(pumped).toHaveLength(2);
    expect((pumped[1]!.client as unknown as { marker?: string }).marker).toBe("new");

    current.source = undefined; // the folder left the workspace
    await vi.advanceTimersByTimeAsync(GENERATION_CHECK_INTERVAL_MS * 3);
    expect(pumped).toHaveLength(2);
  });

  it("a timer pump does not delay a live edit's pump (only real sends move lastStartAt)", async () => {
    const files = memoryFiles();
    const kicked: number[] = [];
    await startReplicaPump(sourceOf(files));
    await replicaQueueFor(ROOT, files).adopt(7);
    await vi.advanceTimersByTimeAsync(GENERATION_CHECK_INTERVAL_MS);
    await replicaDrained(ROOT);
    expect(pumped).toHaveLength(2);
    kickReplicaPump(ROOT, files, () => { kicked.push(Date.now()); return sourceOf(files); });
    await vi.advanceTimersByTimeAsync(2000); // the 1.5 s debounce, not the 60 s minimum interval after the timer's pump
    expect(kicked).toHaveLength(1);
  });
});
