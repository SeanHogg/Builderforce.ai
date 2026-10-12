import { describe, expect, it, vi } from "vitest";
import { parseWorkstreams, spawnAgentTool, spawnAgentsTool, MAX_WORKSTREAMS } from "./subagent-tools.js";
import type { SubagentRequest } from "./capabilities.js";
import type { ToolContext } from "./tool.js";

/** The fan-out's shared half: what a workstream is. */
describe("parseWorkstreams", () => {
  it("parses label, task, ticket and role", () => {
    expect(parseWorkstreams([{ label: "A", task: "do a", ticket: "7", role: "code" }])).toEqual([
      { label: "A", task: "do a", ticket: "7", role: "code", asAgent: "" },
    ]);
  });

  it("refuses an empty list, a missing task and more than the cap", () => {
    expect(parseWorkstreams([])).toContain("workstreams is required");
    expect(parseWorkstreams([{ label: "A" }])).toContain("has no task");
    expect(parseWorkstreams(Array.from({ length: MAX_WORKSTREAMS + 1 }, () => ({ task: "t" })))).toContain(`at most ${MAX_WORKSTREAMS}`);
  });
});

describe("spawn_agents on a surface that backs orchestrate.fanout", () => {
  const ctxWith = (spawn: (r: SubagentRequest) => Promise<{ ok: boolean; output?: string; changedFiles?: string[] }>): ToolContext =>
    ({ caps: { capabilities: new Set(["orchestrate", "orchestrate.fanout"]), orchestration: { spawn } } }) as unknown as ToolContext;

  it("starts every child at once as a clone of the owner — no read-only flag, no scope", async () => {
    const started: SubagentRequest[] = [];
    let release!: () => void;
    const both = new Promise<void>((r) => { release = r; });
    const spawn = vi.fn(async (r: SubagentRequest) => {
      started.push(r);
      if (started.length === 2) release();
      await both;
      return { ok: true, output: `did ${r.label}`, changedFiles: [`${r.label}.ts`] };
    });
    const out = await spawnAgentsTool.execute(
      { workstreams: [{ label: "a", task: "do a", ticket: "1" }, { label: "b", task: "do b" }] },
      ctxWith(spawn),
    );
    expect(started.map((r) => [r.label, r.role, r.ticket])).toEqual([["a", "code", "1"], ["b", "code", undefined]]);
    expect(started.every((r) => !("readOnly" in r) && !("scope" in r))).toBe(true);
    // Children commit their own slices; the owner verifies the combined branch, so the
    // fan-out reports no merged file list of its own.
    expect(out.data).toMatchObject({ ok: true });
    expect(out.data.changedFiles).toBeUndefined();
    expect(String(out.data.next)).toContain("check the combined result");
  });
});

describe("spawn_agent", () => {
  it("starts a clone: no read-only flag reaches the surface, and the role defaults to code", async () => {
    const spawn = vi.fn(async (_r: SubagentRequest) => ({ ok: true }));
    const ctx = { caps: { capabilities: new Set(["orchestrate"]), orchestration: { spawn } } } as unknown as ToolContext;
    await spawnAgentTool.execute({ label: "x", task: "do x" }, ctx);
    expect(spawn.mock.calls[0]![0]).toEqual({ label: "x", task: "do x", role: "code" });
  });
});
