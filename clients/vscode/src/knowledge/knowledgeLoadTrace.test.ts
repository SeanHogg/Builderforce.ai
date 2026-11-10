import { describe, expect, it } from "vitest";
import { createLoadTrace, traceLine, UNTIMED } from "./knowledgeLoadTrace";
import type { LagSampler } from "./review/reviewHostLag";

/** A clock the test moves by hand. */
function clock(start = 1_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

const fakeLag: LagSampler = () => ({ enable: () => true, disable: () => true, max: 40e6, mean: 2e6, percentile: () => 30e6 });

describe("knowledgeLoadTrace", () => {
  it("times a load's phases, keeps its counts and logs one line", async () => {
    const c = clock();
    const lines: string[] = [];
    const trace = createLoadTrace({ now: c.now, log: (l) => lines.push(l), lagSampler: fakeLag });
    const graph = await trace.run("load", "root-1", async (call) => {
      call.set({ focus: false, via: "local" });
      await call.timer.phase("partitions", async () => { c.advance(12); });
      const pairs = call.timer.phase("nearDuplicates", () => { c.advance(400); return [1, 2]; });
      call.set({ nearDuplicates: pairs.length });
      await call.timer.phase("build", async () => { c.advance(800); });
      return { nodes: [1, 2, 3] };
    }, (g) => ({ nodes: g.nodes.length }));
    expect(graph.nodes).toHaveLength(3);
    const [entry] = trace.snapshot().entries;
    expect(entry).toMatchObject({
      op: "load", rootId: "root-1", startedAt: 1_000, durationMs: 1212, outcome: "ok", via: "local", focus: false, nearDuplicates: 2, nodes: 3,
      phases: [{ phase: "partitions", ms: 12 }, { phase: "nearDuplicates", ms: 400 }, { phase: "build", ms: 800 }],
      hostLag: { maxMs: 40, p99Ms: 30, meanMs: 2 },
    });
    expect(lines).toEqual([traceLine(entry!)]);
    expect(lines[0]).toContain("load root=root-1 1212ms ok partitions=12ms nearDuplicates=400ms build=800ms via=local nodes=3");
  });

  it("says which phase a running load is in, and since when", async () => {
    const c = clock();
    const trace = createLoadTrace({ now: c.now });
    let release: () => void = () => undefined;
    const running = trace.run("load", "r", (call) => call.timer.phase("build", () => new Promise<string>((resolve) => { release = () => resolve("g"); })));
    c.advance(5_000);
    const snap = trace.snapshot();
    expect(snap.now).toBe(6_000);
    expect(snap.entries).toEqual([]);
    expect(snap.inFlight).toEqual([expect.objectContaining({ op: "load", rootId: "r", startedAt: 1_000, phases: [{ phase: "build", startedAt: 1_000 }] })]);
    release();
    await running;
    expect(trace.snapshot().inFlight).toEqual([]);
    expect(trace.snapshot().entries[0]).toMatchObject({ outcome: "ok", durationMs: 5_000, phases: [{ phase: "build", ms: 5_000 }] });
  });

  it("records a failure with its message and rethrows it; a null answer is `null`", async () => {
    const trace = createLoadTrace({ now: clock().now });
    await expect(trace.run("scopes", undefined, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await trace.run("lastSeen", undefined, async () => null);
    expect(trace.snapshot().entries.map((e) => [e.op, e.outcome, e.error])).toEqual([["scopes", "error", "boom"], ["lastSeen", "null", undefined]]);
  });

  it("a phase that throws synchronously is still timed and the error propagates", async () => {
    const trace = createLoadTrace({ now: clock().now });
    await expect(trace.run("load", "r", async (call) => call.timer.phase("index", () => { throw new Error("no index"); }))).rejects.toThrow("no index");
    expect(trace.snapshot().entries[0]!.phases).toEqual([{ phase: "index", ms: 0 }]);
  });

  it("a phase that settles after its call finished (a rejected Promise.all sibling) is not appended to the entry", async () => {
    const c = clock();
    const lines: string[] = [];
    const trace = createLoadTrace({ now: c.now, log: (l) => lines.push(l) });
    let release: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => { release = resolve; });
    await expect(trace.run("load", "r", async (call) => Promise.all([
      call.timer.phase("partitions", () => slow),
      call.timer.phase("index", async () => { c.advance(5); throw new Error("no index"); }),
    ]))).rejects.toThrow("no index");
    const before = trace.snapshot().entries[0]!;
    expect(before.phases).toEqual([{ phase: "index", ms: 5 }]);
    c.advance(100);
    release();
    await slow;
    await Promise.resolve();
    expect(trace.snapshot().entries[0]!.phases).toEqual([{ phase: "index", ms: 5 }]);
    expect(trace.snapshot().inFlight).toEqual([]);
    expect(lines).toHaveLength(1);
  });

  it("keeps only the latest entries", async () => {
    const trace = createLoadTrace({ now: clock().now, capacity: 3 });
    for (let i = 0; i < 5; i += 1) await trace.run("scopes", `r${i}`, async () => [i]);
    expect(trace.snapshot().entries.map((e) => e.rootId)).toEqual(["r2", "r3", "r4"]);
  });

  it("UNTIMED runs the phase and returns its value unchanged", () => {
    expect(UNTIMED.phase("build", () => 42)).toBe(42);
  });
});
