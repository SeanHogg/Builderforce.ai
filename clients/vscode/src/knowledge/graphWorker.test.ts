/**
 * The graph worker's host (`graphWorker.ts`): ONE reused worker, builds serialised, a crash rejects the build in flight and
 * the next build respawns, an abort drops a queued build or terminates the worker under a running one, and bounded parts
 * are reassembled on both sides.
 *
 * Evidence re-verification: busts the verify cache (content-hash key) so the pre-push
 * gate re-runs checks against the repaired install instead of replaying a stale record.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./folderKnowledge", () => ({ beforeKnowledgeShutdown: () => () => undefined, folderKnowledge: () => { throw new Error("no in-thread build here"); } }));

import { buildOffThread, useGraphWorkerSeams, type GraphWorkerHandle } from "./graphWorker";
import type { GraphWorkerMessage, GraphWorkerReply } from "./graphBuildProtocol";

type Listener = (value: any) => void;

/** A worker double: records what it is sent; the test answers. */
class FakeWorker implements GraphWorkerHandle {
  readonly sent: GraphWorkerMessage[] = [];
  terminated = false;
  private readonly listeners = new Map<string, Listener[]>();
  postMessage(message: unknown): void { this.sent.push(message as GraphWorkerMessage); }
  on(event: "message" | "error" | "exit", listener: Listener): unknown {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }
  terminate(): Promise<number> { this.terminated = true; return Promise.resolve(1); }
  emit(event: "message" | "error" | "exit", value: unknown): void { for (const l of this.listeners.get(event) ?? []) l(value); }
  reply(reply: GraphWorkerReply): void { this.emit("message", reply); }
  builds(): Array<Extract<GraphWorkerMessage, { type: "build" }>> { return this.sent.filter((m): m is Extract<GraphWorkerMessage, { type: "build" }> => m.type === "build"); }
}

const graph = (rootId: string) => ({ scope: { rootId, packs: [], digest: "d" }, nodes: [], edges: [], findings: [], stats: { sources: 0, nodes: 0, edges: 0, stale: 0, truncated: false } });
const stored = (rootId: string) => ({ kind: "stored" as const, folderPath: "/ws", rootId });
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

let restore: (() => void) | undefined;
afterEach(() => { restore?.(); restore = undefined; });

function withWorkers(): FakeWorker[] {
  const spawned: FakeWorker[] = [];
  restore = useGraphWorkerSeams({ file: "fake-worker.js", spawn: () => { const w = new FakeWorker(); spawned.push(w); return w; } });
  return spawned;
}

describe("graph worker host", () => {
  it("runs builds in ONE reused worker, one at a time, in order", async () => {
    const spawned = withWorkers();
    const a = buildOffThread(stored("a"));
    const b = buildOffThread(stored("b"));
    await tick();
    expect(spawned).toHaveLength(1);
    // The second build is held until the first answered.
    expect(spawned[0]!.builds().map((m) => m.request)).toEqual([stored("a")]);
    spawned[0]!.reply({ type: "done", id: spawned[0]!.builds()[0]!.id, result: graph("a") as never });
    await expect(a).resolves.toMatchObject({ scope: { rootId: "a" } });
    await tick();
    expect(spawned[0]!.builds().map((m) => m.request.kind === "stored" && m.request.rootId)).toEqual(["a", "b"]);
    spawned[0]!.reply({ type: "done", id: spawned[0]!.builds()[1]!.id, result: null });
    await expect(b).resolves.toBeNull();
    expect(spawned).toHaveLength(1);
  });

  it("reassembles a result sent in bounded parts", async () => {
    const spawned = withWorkers();
    const built = buildOffThread(stored("r"));
    await tick();
    const w = spawned[0]!;
    w.reply({ type: "part", key: "nodes", items: [{ ref: "n1" }] });
    w.reply({ type: "part", key: "nodes", items: [{ ref: "n2" }] });
    w.reply({ type: "part", key: "findings", items: [{ id: "f" }] });
    w.reply({ type: "done", id: w.builds()[0]!.id, result: graph("r") as never });
    const result = await built;
    expect(result?.nodes).toEqual([{ ref: "n1" }, { ref: "n2" }]);
    expect(result?.findings).toEqual([{ id: "f" }]);
  });

  it("a worker error rejects with its code", async () => {
    const spawned = withWorkers();
    const built = buildOffThread(stored("r"));
    await tick();
    spawned[0]!.reply({ type: "error", id: spawned[0]!.builds()[0]!.id, error: "graph_result_over_budget: too big", code: "graph_result_over_budget" });
    await expect(built).rejects.toMatchObject({ code: "graph_result_over_budget" });
  });

  it("a crashed worker rejects the build in flight; the next build spawns a new worker", async () => {
    const spawned = withWorkers();
    const first = buildOffThread(stored("a"));
    const second = buildOffThread(stored("b"));
    await tick();
    spawned[0]!.emit("exit", 1);
    await expect(first).rejects.toThrow("graph_worker_exit:1");
    await tick();
    // The queued build went to a fresh worker.
    expect(spawned).toHaveLength(2);
    const w = spawned[1]!;
    expect(w.builds().map((m) => m.request)).toEqual([stored("b")]);
    w.reply({ type: "done", id: w.builds()[0]!.id, result: graph("b") as never });
    await expect(second).resolves.toMatchObject({ scope: { rootId: "b" } });
  });

  it("an abort drops a queued build, and terminates the worker under a running one", async () => {
    const spawned = withWorkers();
    const running = new AbortController();
    const queued = new AbortController();
    const a = buildOffThread(stored("a"), running.signal);
    const b = buildOffThread(stored("b"), queued.signal);
    const c = buildOffThread(stored("c"));
    await tick();
    queued.abort();
    await expect(b).rejects.toMatchObject({ code: "graph_build_aborted" });
    running.abort();
    await expect(a).rejects.toMatchObject({ code: "graph_build_aborted" });
    expect(spawned[0]!.terminated).toBe(true);
    await tick();
    // The next build (c, not the dropped b) runs on a new worker.
    expect(spawned).toHaveLength(2);
    expect(spawned[1]!.builds().map((m) => m.request)).toEqual([stored("c")]);
    spawned[1]!.reply({ type: "done", id: spawned[1]!.builds()[0]!.id, result: null });
    await expect(c).resolves.toBeNull();
  });

  it("ships an analysis' extracts as bounded parts before the build, and answers the code actions' findings", async () => {
    const spawned = withWorkers();
    const extracted = Array.from({ length: 1200 }, (_, i) => ({ sourceRef: `src:r::f${i}.ts`, sourceHash: `h${i}`, nodes: [], edges: [], keys: [] }));
    const built = buildOffThread({ kind: "extracted", rootId: "r", partitions: { partitions: [] } as never, extracted: extracted as never });
    for (let i = 0; i < 10 && spawned[0]?.builds().length !== 1; i++) await tick();
    const w = spawned[0]!;
    const parts = w.sent.filter((m) => m.type === "part");
    expect(parts.flatMap((m) => (m.type === "part" ? m.items : []))).toHaveLength(1200);
    const build = w.builds()[0]!;
    expect(build.request.kind === "extracted" && build.request.extracted).toEqual([]);
    w.reply({ type: "part", key: "placed", items: [["a.ts", "ui"]] });
    w.reply({ type: "done", id: build.id, result: { findings: [], placed: new Map([["a.ts", "ui"]]) } });
    await expect(built).resolves.toEqual({ findings: [], placed: new Map([["a.ts", "ui"]]) });
  });
});
