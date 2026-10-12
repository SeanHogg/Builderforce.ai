import { describe, expect, it, vi } from "vitest";
import { MAX_WORKSTREAMS, subagentFanOutToolDef } from "./subagentFanOutTool";
import type { ChildControls, ChildRequest } from "./childRunSpawner";

/**
 * Several children, side by side, in ONE working tree — started in the background, every
 * handle back at once. Chat #126 worked through eight named workstreams one call at a
 * time; this is what lets them run together while the owner carries on. Every child is a
 * clone of its owner — nothing here narrows what it may do.
 */

function fakeControls(over: Partial<ChildControls> = {}): ChildControls & { requests: ChildRequest[] } {
  const requests: ChildRequest[] = [];
  return {
    requests,
    canSpawn: true,
    spawn: vi.fn((req: ChildRequest) => {
      requests.push(req);
      return { ok: true as const, handle: `a${requests.length}`, name: req.label, label: req.label };
    }),
    message: vi.fn(() => ({ ok: true as const })),
    stop: vi.fn(() => []),
    wait: vi.fn(async () => ({ reports: [], running: [] })),
    ...over,
  };
}

const run = async (children: ChildControls, args: Record<string, unknown>) =>
  JSON.parse(await subagentFanOutToolDef({ children }).execute(args, "/repo"));

describe("spawn_agents", () => {
  it("starts every workstream and returns all their handles at once", async () => {
    const children = fakeControls();
    const out = await run(children, { workstreams: [{ label: "A", task: "look at a" }, { label: "B", task: "look at b" }] });
    expect(children.requests.map((r) => r.task)).toEqual(["look at a", "look at b"]);
    expect(out).toMatchObject({ ok: true, running: true });
    expect(out.agents.map((a: { handle: string }) => a.handle)).toEqual(["a1", "a2"]);
  });

  it("refuses more workstreams than it may start", async () => {
    const workstreams = Array.from({ length: MAX_WORKSTREAMS + 1 }, (_, i) => ({ label: `W${i}`, task: `t${i}` }));
    const out = await run(fakeControls(), { workstreams });
    expect(out.error).toContain(`at most ${MAX_WORKSTREAMS}`);
  });

  it("starts each workstream as a clone with its ticket, and says what the owner does next", async () => {
    const children = fakeControls();
    const out = await run(children, { workstreams: [{ label: "B", task: "change b", ticket: "2731" }] });
    expect(children.requests[0]).toEqual({ label: "B", task: "change b", role: "code", ticket: "2731" });
    expect(out.agents[0]).toMatchObject({ ticket: "2731" });
    expect(out.next).toContain("check the combined result");
  });
});
