import { describe, expect, it } from "vitest";
import { createChildRuns, MAX_CHILD_DEPTH, MAX_LIVE_CHILDREN, type ChildReport } from "./childRuns";

/**
 * Who spawned whom, and where a child's report goes. The rule that matters: a report is
 * delivered EXACTLY once — to a waiting `wait_agents`, or (returned) to the owner's inbox.
 */

const child = (over: Partial<Parameters<ReturnType<typeof createChildRuns>["register"]>[0]> = {}) => ({
  rootChatId: 10,
  ownerKey: 10,
  ownerName: "BuilderForce",
  label: "slice",
  agent: { ref: "agent_ada", name: "Ada" },
  depth: 1,
  readOnly: true,
  ...over,
});

const report = (handle: string, state: ChildReport["state"] = "done"): ChildReport => ({ handle, name: "Ada", label: "slice", state, output: "ok" });

describe("childRuns", () => {
  it("hands out a run key and a per-chat handle", () => {
    const runs = createChildRuns();
    const a = runs.register(child());
    const b = runs.register(child());
    const other = runs.register(child({ rootChatId: 11, ownerKey: 11 }));
    if ("error" in a || "error" in b || "error" in other) throw new Error("refused");
    expect([a.lineage.handle, b.lineage.handle, other.lineage.handle]).toEqual(["a1", "a2", "a1"]);
    expect(a.key).toBeLessThan(0);
    expect(a.key).not.toBe(b.key);
  });

  it("refuses past the live cap and past the depth cap", () => {
    const runs = createChildRuns();
    for (let i = 0; i < MAX_LIVE_CHILDREN; i++) runs.register(child());
    expect(runs.register(child())).toHaveProperty("error");
    expect(createChildRuns().register(child({ depth: MAX_CHILD_DEPTH + 1 }))).toHaveProperty("error");
  });

  it("returns a report for the inbox when nobody waits for it", () => {
    const runs = createChildRuns();
    const a = runs.register(child());
    if ("error" in a) throw new Error();
    expect(runs.settle(a.key, report("a1"))).toEqual(report("a1"));
    expect(runs.viewsIn(10)).toEqual([]);
  });

  it("delivers to a waiting owner INSTEAD of the inbox", async () => {
    const runs = createChildRuns();
    const a = runs.register(child());
    if ("error" in a) throw new Error();
    const waiting = runs.wait(10, ["a1"], 10_000);
    expect(runs.settle(a.key, report("a1"))).toBeNull();
    await expect(waiting).resolves.toEqual({ reports: [report("a1")], running: [] });
  });

  it("answers a wait for a child that already finished with what it reported", async () => {
    const runs = createChildRuns();
    const a = runs.register(child());
    if ("error" in a) throw new Error();
    runs.settle(a.key, report("a1"));
    await expect(runs.wait(10, ["a1"], 10_000)).resolves.toEqual({ reports: [report("a1")], running: [] });
  });

  it("gives up at the timeout and names who is still running", async () => {
    const runs = createChildRuns();
    runs.register(child());
    await expect(runs.wait(10, [], 5)).resolves.toEqual({ reports: [], running: ["a1"] });
  });

  it("gives way the moment the person speaks to the owner — its children keep running", async () => {
    const runs = createChildRuns();
    runs.register(child());
    const waiting = runs.wait(10, [], 60_000);
    expect(runs.interrupt(11)).toBe(false);
    expect(runs.interrupt(10)).toBe(true);
    const out = await waiting;
    expect(out.running).toEqual(["a1"]);
    expect(out.interrupted).toBe(true);
    expect(runs.liveOf(10)).toHaveLength(1);
  });

  it("lets an owner address only its own children", () => {
    const runs = createChildRuns();
    const a = runs.register(child());
    if ("error" in a) throw new Error();
    expect(runs.find(10, "a1")?.key).toBe(a.key);
    expect(runs.find(a.key, "a1")).toBeNull();
  });

  it("remembers that a child was stopped on purpose", () => {
    const runs = createChildRuns();
    const a = runs.register(child());
    if ("error" in a) throw new Error();
    runs.requestStop(a.key);
    expect(runs.stopRequested(a.key)).toBe(true);
  });
});
