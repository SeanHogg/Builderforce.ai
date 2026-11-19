import { describe, expect, it, vi } from "vitest";
import {
  briefWithHandoff,
  HANDOFF_CHARS,
  HANDOFF_HEAD,
  MAX_WORKSTREAMS,
  ownerHandoffBlock,
  parseWorkstreams,
  spawnAgentTool,
  spawnAgentsTool,
} from "./subagent-tools.js";
import { MISSING_ROLE_ERROR } from "./modelRoles.js";
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

  it("refuses a workstream with no role, or an unknown one — no silent `code` default (chat #273)", () => {
    expect(parseWorkstreams([{ label: "A", task: "do a" }])).toBe(`workstream 1: ${MISSING_ROLE_ERROR}`);
    expect(parseWorkstreams([{ label: "A", task: "do a", role: "research" }])).toContain("role is required");
    expect(parseWorkstreams([{ label: "A", task: "do a", role: " Review " }])).toEqual([
      { label: "A", task: "do a", role: "review", asAgent: "" },
    ]);
  });

  it("keeps an owner's context", () => {
    expect(parseWorkstreams([{ label: "A", task: "do a", role: "explore", context: " 1150 backlog " }])).toEqual([
      { label: "A", task: "do a", role: "explore", context: "1150 backlog", asAgent: "" },
    ]);
  });
});

describe("ownerHandoffBlock", () => {
  it("is empty when there is nothing to hand over", () => {
    expect(ownerHandoffBlock({})).toBe("");
    expect(briefWithHandoff("do x", "")).toBe("do x");
  });

  it("puts the owner's own context first, then the calls it already made", () => {
    const block = ownerHandoffBlock({
      context: "Open tickets: backlog 1150 / ready 63 / in_progress 18 / in_review 22.",
      established: ["read_file ROADMAP.md lines 1-400", 'builtin_tasks_list {"limit":5,"offset":0,"status":"backlog"}'],
    });
    const lines = block.split("\n");
    expect(lines[0]).toBe(HANDOFF_HEAD);
    expect(lines[1]).toContain("backlog 1150");
    expect(block.indexOf("backlog 1150")).toBeLessThan(block.indexOf("read_file ROADMAP.md"));
    expect(block).toContain("- builtin_tasks_list");
  });

  it("stays inside its budget and says how many calls it left out", () => {
    const established = Array.from({ length: 200 }, (_, i) => `read_file src/file${i}.ts lines 1-200`);
    const block = ownerHandoffBlock({ context: "ctx", established });
    expect(block.length).toBeLessThanOrEqual(HANDOFF_CHARS + 40);
    expect(block).toMatch(/… and \d+ more$/);
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
      { workstreams: [{ label: "a", task: "do a", ticket: "1", role: "code" }, { label: "b", task: "do b", role: "review", context: "b is half done" }] },
      ctxWith(spawn),
    );
    expect(started.map((r) => [r.label, r.role, r.ticket])).toEqual([["a", "code", "1"], ["b", "review", undefined]]);
    expect(started[0]!.task).toBe("do a");
    expect(started[1]!.task).toBe(`do b\n\n${HANDOFF_HEAD}\nb is half done`);
    expect(started.every((r) => !("readOnly" in r) && !("scope" in r))).toBe(true);
    // Children commit their own slices; the owner verifies the combined branch, so the
    // fan-out reports no merged file list of its own.
    expect(out.data).toMatchObject({ ok: true });
    expect(out.data.changedFiles).toBeUndefined();
    expect(String(out.data.next)).toContain("check the combined result");
  });
});

describe("spawn_agent", () => {
  it("starts a clone with the role it was given: no read-only flag reaches the surface", async () => {
    const spawn = vi.fn(async (_r: SubagentRequest) => ({ ok: true }));
    const ctx = { caps: { capabilities: new Set(["orchestrate"]), orchestration: { spawn } } } as unknown as ToolContext;
    await spawnAgentTool.execute({ label: "x", task: "do x", role: "explore" }, ctx);
    expect(spawn.mock.calls[0]![0]).toEqual({ label: "x", task: "do x", role: "explore" });
  });

  it("refuses a delegation with no role instead of defaulting it to code (chat #273)", async () => {
    const spawn = vi.fn(async (_r: SubagentRequest) => ({ ok: true }));
    const ctx = { caps: { capabilities: new Set(["orchestrate"]), orchestration: { spawn } } } as unknown as ToolContext;
    const out = await spawnAgentTool.execute({ label: "x", task: "Bulk-read open tickets vs roadmap and specs" }, ctx);
    expect(out.data).toEqual({ ok: false, error: MISSING_ROLE_ERROR });
    expect(spawn).not.toHaveBeenCalled();
    expect(spawnAgentTool.schema.function.parameters.required).toContain("role");
  });

  it("hands the owner's context to the child under the hand-off heading", async () => {
    const spawn = vi.fn(async (_r: SubagentRequest) => ({ ok: true }));
    const ctx = { caps: { capabilities: new Set(["orchestrate"]), orchestration: { spawn } } } as unknown as ToolContext;
    await spawnAgentTool.execute({ label: "x", task: "do x", role: "review", context: "backlog 1150" }, ctx);
    expect(spawn.mock.calls[0]![0].task).toBe(`do x\n\n${HANDOFF_HEAD}\nbacklog 1150`);
  });
});
