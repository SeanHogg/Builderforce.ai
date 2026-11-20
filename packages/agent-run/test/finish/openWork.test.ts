/**
 * The open-work hold (`FinishPorts.openWork`): a run that owns linked tickets still open may not end — not through the
 * `finish` tool (consulted only once every other gate passed) and not in prose (the kernel sends the turn back).
 */
import { describe, expect, it, vi } from "vitest";
import type { Capability } from "@builderforce/agent-tools";
import { runAgent, type ModelCompletion, type ModelRequest, type PlatformTools, type RunEvent, type RunPorts } from "../../src/index.js";
import { createFinishHook, lastFinishReason, LINKED_WORK_OPEN } from "../../src/policy/finish/index.js";
import { policyCtx, schemas, TEST_POLICY, TEST_TASK } from "../support/policyContext.js";

const HOLD = "Epic #6902 is still in_progress: continue executing.";

describe("createFinishHook — openWork on the finish tool", () => {
  it("consults openWork only after every other gate passed, and names the verdict", async () => {
    const openWork = vi.fn(async () => HOLD);
    const hook = createFinishHook({ openWork });
    const ctx = policyCtx();
    ctx.state.writtenPaths = ["src/a.ts"];
    ctx.content = "ok";
    expect(await hook.gate(ctx)).toBe(HOLD);
    expect(openWork).toHaveBeenCalledTimes(1);
    expect(lastFinishReason(ctx.state)).toBe(LINKED_WORK_OPEN);
  });

  it("never reaches openWork while an earlier gate blocks", async () => {
    const openWork = vi.fn(async () => HOLD);
    const hook = createFinishHook({ openWork });
    const ctx = policyCtx();
    ctx.state.writtenPaths = ["docs/x.md"];
    ctx.content = "done";
    const block = await hook.gate(ctx);
    expect(block).toBeTruthy();
    expect(block).not.toBe(HOLD);
    expect(openWork).not.toHaveBeenCalled();
    expect(lastFinishReason(ctx.state)).toBe("no_deliverable");
  });

  it("finishes when openWork owes nothing, and is a no-op with no port", async () => {
    const ctx = policyCtx();
    ctx.state.writtenPaths = ["src/a.ts"];
    ctx.content = "ok";
    expect(await createFinishHook({ openWork: async () => null }).gate(ctx)).toBeNull();
    expect(await createFinishHook().openWork!(ctx)).toBeNull();
  });
});

describe("the kernel's finish-tool hold", () => {
  it("an open-work hold on `finish` does not spend the one-shot honesty gate (finishBlockedOnce)", async () => {
    const call = (id: string, name: string, args: Record<string, unknown>): ModelCompletion => ({ content: "", toolCalls: [{ id, name, arguments: JSON.stringify(args) }] });
    const script: ModelCompletion[] = [
      call("e1", "write_file", { path: "src/a.ts", content: "export const a = 1;" }),
      call("f1", "finish", { summary: "Implemented src/a.ts." }),
      call("f2", "finish", { summary: "Implemented src/a.ts." }),
      { content: "Implemented src/a.ts." },
    ];
    let n = 0;
    const events: RunEvent[] = [];
    const ports: RunPorts = {
      model: { complete: async () => script[n++] ?? { content: "done" } },
      capabilities: { capabilities: new Set<Capability>() },
      store: { load: () => undefined, save: () => undefined },
      events: { emit: (e) => { events.push(e); } },
      human: { ask: async () => ({ kind: "paused" }) },
      context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
      platform: {
        closed: true,
        verbatimText: true,
        schemas: () => schemas(["write_file"]),
        selection: { query: "", limit: 50, required: new Set<string>() },
        execute: async () => ({ data: { ok: true } }),
      },
    };
    const holds = [HOLD, null];
    const openWork = vi.fn(async () => holds.shift() ?? null);
    const outcome = await runAgent({ task: TEST_TASK, policy: TEST_POLICY, ports, modules: { finish: createFinishHook({ openWork }) } });
    expect(openWork).toHaveBeenCalled();
    expect(outcome.state.writtenPaths).toContain("src/a.ts");
    expect(outcome.state.finish.finishBlockedOnce).toBe(false);
  });
});

describe("the kernel's prose hold", () => {
  it("sends a prose answer back while openWork holds, and settles once it returns null", async () => {
    const script: ModelCompletion[] = [
      { content: "I haven't started the seeds migration or the FinanceLens change." },
      { content: "Every PRD item is implemented and its ticket is done." },
    ];
    const requests: ModelRequest[] = [];
    let n = 0;
    const events: RunEvent[] = [];
    const platform: PlatformTools = {
      closed: true,
      verbatimText: true,
      schemas: () => schemas(["edit_file"]),
      selection: { query: "", limit: 50, required: new Set<string>() },
      execute: async () => ({ data: { ok: true } }),
    };
    const ports: RunPorts = {
      model: {
        complete: async (request) => {
          requests.push(request);
          const answer = script[n++];
          if (!answer) throw new Error("script exhausted");
          return answer;
        },
      },
      capabilities: { capabilities: new Set<Capability>() },
      store: { load: () => undefined, save: () => undefined },
      events: { emit: (e) => { events.push(e); } },
      human: { ask: async () => ({ kind: "paused" }) },
      context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
      platform,
    };
    const holds = [HOLD, null];
    const openWork = vi.fn(async () => holds.shift() ?? null);
    const outcome = await runAgent({ task: TEST_TASK, policy: TEST_POLICY, ports, modules: { finish: createFinishHook({ openWork }) } });
    expect(outcome.kind).toBe("finished");
    expect(outcome.kind === "finished" ? outcome.output : "").toContain("Every PRD item is implemented");
    expect(requests).toHaveLength(2);
    expect(openWork).toHaveBeenCalledTimes(2);
    // The second turn read the hold, after what the model said.
    expect(JSON.stringify(requests[1]!.messages)).toContain(HOLD);
    expect(events.some((e) => e.kind === "finish.blocked" && e.reason === LINKED_WORK_OPEN && e.block === HOLD)).toBe(true);
  });
});
