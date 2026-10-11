import { describe, expect, it, vi } from "vitest";
import { MAX_WORKSTREAMS, subagentFanOutToolDef } from "./subagentFanOutTool";
import type { ChildControls, ChildRequest } from "./childRunSpawner";

/**
 * Several children, side by side, in ONE working tree — started in the background, every
 * handle back at once. Chat #126 worked through eight named workstreams one call at a
 * time; this is what lets them run together while the owner carries on — and the scopes
 * are what keep two of them from writing one file.
 */

function fakeControls(over: Partial<ChildControls> = {}): ChildControls & { requests: ChildRequest[] } {
  const requests: ChildRequest[] = [];
  return {
    requests,
    canWrite: true,
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

  it("refuses a change whose workstreams claim the same path, before starting any", async () => {
    const children = fakeControls();
    const out = await run(children, {
      read_only: false,
      workstreams: [
        { label: "W1", task: "a", paths: ["api/src/runtime"] },
        { label: "W8", task: "b", paths: ["api/src/runtime/preview.ts"] },
      ],
    });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("both claim 'api/src/runtime'");
    expect(children.spawn).not.toHaveBeenCalled();
  });

  it("refuses a change with an unscoped workstream", async () => {
    const out = await run(fakeControls(), { read_only: false, workstreams: [{ label: "W2", task: "a" }] });
    expect(out.error).toContain("has no paths");
  });

  it("refuses more workstreams than it may start", async () => {
    const workstreams = Array.from({ length: MAX_WORKSTREAMS + 1 }, (_, i) => ({ label: `W${i}`, task: `t${i}` }));
    const out = await run(fakeControls(), { workstreams });
    expect(out.error).toContain(`at most ${MAX_WORKSTREAMS}`);
  });

  it("gives each writable workstream its own paths and ticket, and says what the owner does next", async () => {
    const children = fakeControls();
    const out = await run(children, {
      read_only: false,
      workstreams: [{ label: "B", task: "change b", paths: ["api"], ticket: "2731" }],
    });
    expect(children.requests[0]).toMatchObject({ writable: true, scope: ["api"], ticket: "2731", role: "code" });
    expect(out.agents[0]).toMatchObject({ ticket: "2731" });
    expect(out.next).toContain("verify the combined change");
  });

  it("runs read-only, and says so, when the host cannot ask a human", async () => {
    const children = fakeControls({ canWrite: false });
    const out = await run(children, { read_only: false, workstreams: [{ label: "A", task: "a", paths: ["src"] }] });
    expect(out.writeDeclined).toContain("cannot raise an approval prompt");
    expect(children.requests[0]!.writable).toBe(false);
    expect(children.requests[0]!.scope).toBeUndefined();
  });
});
