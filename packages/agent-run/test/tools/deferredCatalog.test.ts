/**
 * Test — the ONE catalog strategy (cost lever C1's role core set + `tool_search`) and the structured task state (C3),
 * ported from `api/.../costLoop/costLoopSession.test.ts` (the cases that exercised the cloud's per-tick `tools()`,
 * `dispatch()` and `turnMessages()` plumbing, now the agent's: `toolsHook`, `memoryHook`, `withVolatileTail`).
 * Inputs and expected values are the source's; only the call shape is the agent's.
 */
import { describe, expect, it } from "vitest";
import { VOLATILE_TAIL_TAG } from "@seanhogg/builderforce-memory/handoff";
import type { ToolSchema } from "@builderforce/agent-tools";
import type { RunEvent, RunPorts } from "../../src/contract.js";
import { compactionOptions } from "../../src/policy/compaction/index.js";
import { memoryHook } from "../../src/policy/memory/index.js";
import { ROLE_CORE_TOOLS } from "../../src/policy/tools/catalog.js";
import { toolsHook } from "../../src/policy/tools/index.js";
import { UPDATE_TASK_STATE_TOOL, applyTaskStateUpdate, renderTaskState } from "../../src/policy/tools/taskState.js";
import { runAgent } from "../../src/runAgent.js";
import { withVolatileTail } from "../../src/turnContext.js";
import { TEST_POLICY, policyCtx } from "../support/policyContext.js";

const tool = (name: string, description = name.replace(/_/g, " ")): ToolSchema => ({
  type: "function", function: { name, description, parameters: { type: "object", properties: {} } },
});
const CORE = ["list_files", "search_code", "read_file", "write_file", "edit_file", "delete_file", "run_checks", "ask_human", "finish", "web_fetch"];
const PLATFORM = ["builtin_tasks_create", "builtin_tasks_list", "builtin_key_results_update", "builtin_incidents_open", "builtin_kanban_signoff"];
const CATALOG = [...CORE, ...PLATFORM].map((n) => tool(n));
const PROMPT = "Use `builtin_tasks_create` to file follow-ups.\nDo the task.";

const names = (tools: readonly ToolSchema[] | void) => (tools ?? []).map((t) => t.function.name);
function ctxFor(over: { levers?: string[]; loaded?: string[] } = {}) {
  const ctx = policyCtx({
    policy: { role: "code", levers: (over.levers ?? ["c3_task_state"]) as never },
    task: { prompt: PROMPT, dispatch: { source: "chat" } },
  });
  ctx.state.loadedTools = over.loaded;
  return { ...ctx, tools: CATALOG };
}

describe("the one catalog — role core set + tool_search", () => {
  it("C1: advertises the role core set + prompt-named tools + meta tools, never the whole catalog", async () => {
    const ctx = ctxFor();
    const advertised = names(await toolsHook.select(ctx, ctx.tools));
    expect(advertised).toContain("read_file");
    expect(advertised).toContain("builtin_tasks_create"); // named in the prompt
    expect(advertised).not.toContain("builtin_incidents_open");
    expect(advertised.slice(-2)).toEqual(["tool_search", "update_task_state"]);
    expect(advertised.length).toBeLessThan(CATALOG.length + 2);
    expect(ROLE_CORE_TOOLS.code.length + 2).toBeLessThanOrEqual(20);
  });

  it("C1: tool_search loads matches for the rest of the run, and they persist in the state a later tick resumes from", async () => {
    const ctx = ctxFor();
    const r = toolsHook.beforeDispatch?.(ctx, { id: "s", name: "tool_search", args: { query: "open an incident" } });
    expect((r?.data as { matches: Array<{ name: string }> }).matches.map((m) => m.name)).toContain("builtin_incidents_open");
    expect(names(await toolsHook.select(ctx, ctx.tools))).toContain("builtin_incidents_open");
    const next = ctxFor({ loaded: ctx.state.loadedTools });
    expect(names(await toolsHook.select(next, next.tools))).toContain("builtin_incidents_open");
  });

  it("C1: a deferred tool the model calls anyway is loaded", async () => {
    const ctx = ctxFor();
    // Dispatch stays with the guard: the tools hook answers nothing for a deferred tool.
    expect(toolsHook.beforeDispatch?.(ctx, { id: "k", name: "builtin_key_results_update", args: {} })).toBeUndefined();
    const called = { ...ctx, messages: [{ role: "assistant" as const, content: "", toolCalls: [{ id: "k", name: "builtin_key_results_update", arguments: "{}" }] }] };
    expect(names(await toolsHook.select(called, called.tools))).toContain("builtin_key_results_update");
  });

  it("C1: records the advertised set and its schema cost when it changes", async () => {
    const events: RunEvent[] = [];
    let turn = 0;
    const ports: RunPorts = {
      model: { complete: async () => (turn++ === 0 ? { content: "", toolCalls: [{ id: "q", name: "tool_search", arguments: '{"query":"zzzz nothing"}' }] } : { content: "done" }) },
      capabilities: { capabilities: new Set() },
      store: { load: () => undefined, save: () => undefined },
      events: { emit: (e: RunEvent) => { events.push(e); } },
      human: { ask: async () => ({ kind: "paused" }) },
      context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
    };
    await runAgent({ task: { prompt: PROMPT, dispatch: { source: "chat" } }, policy: { ...TEST_POLICY, levers: ["c3_task_state"] }, ports });
    const toolEvents = events.filter((e): e is Extract<RunEvent, { kind: "context.tools" }> => e.kind === "context.tools");
    expect(toolEvents).toHaveLength(1);
    expect(toolEvents[0]!.toolsTokens).toBeGreaterThan(0);
  });
});

describe("C3 — the structured task state", () => {
  it("is stored, rendered in the trailing block, and persisted", async () => {
    const ctx = ctxFor();
    const stored = toolsHook.beforeDispatch?.(ctx, { id: "u", name: UPDATE_TASK_STATE_TOOL, args: { goal: "Ship the filter", nextStep: "edit avatar.ts" } });
    expect(stored?.data).toMatchObject({ ok: true });
    const brief = await memoryHook.brief(ctx);
    const out = withVolatileTail([{ role: "user", content: "U" }], { focus: [], facts: [], recall: [] }, brief, ["AFFECT"]);
    const tail = out[out.length - 1]!;
    expect(tail.role).toBe("user");
    expect(String(tail.content)).toMatch(new RegExp(`^${VOLATILE_TAIL_TAG}`));
    expect(String(tail.content)).toContain("AFFECT");
    expect(String(tail.content)).toContain("Goal: Ship the filter");
    expect(ctx.state.taskState).toEqual({ goal: "Ship the filter", nextStep: "edit avatar.ts" });
    const withMask = ctxFor({ levers: ["c3_task_state", "c2_observation_masking"] });
    expect(compactionOptions({ ...withMask, ports: { model: {} } as unknown as RunPorts })).toMatchObject({ maskObservationsAfterTurns: 6, pinTaskBrief: true });
  });

  it("refuses a task state over ~600 tokens", () => {
    const r = applyTaskStateUpdate(undefined, { decisions: Array.from({ length: 200 }, (_, i) => `decision number ${i} about the design`) });
    expect(r.ok).toBe(false);
    expect(renderTaskState(undefined)).toBe("");
  });
});
