import { describe, expect, it, vi } from "vitest";
import { parseWorkstreams, spawnAgentsTool, workstreamScopeError, MAX_WORKSTREAMS } from "./subagent-tools.js";
import type { SubagentRequest } from "./capabilities.js";
import type { ToolContext } from "./tool.js";

/** The fan-out's shared half: what a workstream is, and when side by side is unsafe. */
describe("parseWorkstreams", () => {
  it("parses label, task, paths, ticket and role", () => {
    expect(parseWorkstreams([{ label: "A", task: "do a", paths: ["src/a", ""], ticket: "7", role: "code" }])).toEqual([
      { label: "A", task: "do a", paths: ["src/a"], ticket: "7", role: "code", asAgent: "" },
    ]);
  });

  it("refuses an empty list, a missing task and more than the cap", () => {
    expect(parseWorkstreams([])).toContain("workstreams is required");
    expect(parseWorkstreams([{ label: "A" }])).toContain("has no task");
    expect(parseWorkstreams(Array.from({ length: MAX_WORKSTREAMS + 1 }, () => ({ task: "t" })))).toContain(`at most ${MAX_WORKSTREAMS}`);
  });
});

describe("workstreamScopeError", () => {
  const ws = (label: string, paths: string[]) => ({ label, task: "t", paths, asAgent: "" });
  it("requires every writable workstream to own paths, and no two to share one", () => {
    expect(workstreamScopeError([ws("A", ["a"]), ws("B", ["b"])])).toBeNull();
    expect(workstreamScopeError([ws("A", ["a"]), ws("B", [])])).toContain("has no paths");
    expect(workstreamScopeError([ws("A", ["src"]), ws("B", ["src/b.ts"])])).toContain("both claim");
  });
});

describe("spawn_agents on a surface that backs orchestrate.fanout", () => {
  const ctxWith = (spawn: (r: SubagentRequest) => Promise<{ ok: boolean; output?: string; changedFiles?: string[] }>): ToolContext =>
    ({ caps: { capabilities: new Set(["orchestrate", "orchestrate.fanout"]), orchestration: { spawn } } }) as unknown as ToolContext;

  it("starts every child at once, each scoped to its paths, and leaves the merge to the owner", async () => {
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
      { read_only: false, workstreams: [{ label: "a", task: "do a", paths: ["a"], ticket: "1" }, { label: "b", task: "do b", paths: ["b"] }] },
      ctxWith(spawn),
    );
    expect(started.map((r) => [r.label, r.scope, r.role, r.ticket])).toEqual([["a", ["a"], "code", "1"], ["b", ["b"], "code", undefined]]);
    // Children commit their own slices; the owner verifies the combined branch, so the
    // fan-out reports no merged file list of its own.
    expect(out.data).toMatchObject({ ok: true });
    expect(out.data.changedFiles).toBeUndefined();
    expect(String(out.data.next)).toContain("no shell and no git");
  });

  it("refuses overlapping writable workstreams before any child starts", async () => {
    const spawn = vi.fn();
    const out = await spawnAgentsTool.execute(
      { read_only: false, workstreams: [{ label: "a", task: "t", paths: ["src"] }, { label: "b", task: "t", paths: ["src/x.ts"] }] },
      ctxWith(spawn),
    );
    expect(out.data.ok).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });
});
