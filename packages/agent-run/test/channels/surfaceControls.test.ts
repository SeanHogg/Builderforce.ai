/**
 * What a surface that guards its own context and runs its own commands says to the agent, and what the agent does on a
 * hand-off or an interruption: the surface's result cap, the surface's interruptible commands, a stall not judged while the
 * person is steering, and a context packed for the incoming model's window when a stall fails over onto another model.
 */
import { describe, expect, it } from "vitest";
import type { Capability } from "@builderforce/agent-tools";
import { runAgent, type ModelCompletion, type ModelRequest, type PlatformTools, type RunMessage, type RunPorts, type RunEvent } from "../../src/index.js";
import { TEST_POLICY, TEST_TASK, schemas } from "../support/policyContext.js";

function ports(answers: Array<ModelCompletion | ((request: ModelRequest) => ModelCompletion)>, extra: Partial<RunPorts> = {}, model: Partial<RunPorts["model"]> = {}) {
  const requests: ModelRequest[] = [];
  const events: RunEvent[] = [];
  let n = 0;
  const p: RunPorts = {
    model: {
      complete: async (request) => {
        requests.push(request);
        const answer = answers[n++];
        if (!answer) throw new Error("script exhausted");
        return typeof answer === "function" ? answer(request) : answer;
      },
      ...model,
    },
    capabilities: { capabilities: new Set<Capability>() },
    store: { load: () => undefined, save: () => undefined },
    events: { emit: (e) => void events.push(e) },
    human: { ask: async () => ({ kind: "paused" }) },
    context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
    ...extra,
  };
  return { ports: p, requests, events };
}

const catalog = (names: string[], over: Partial<PlatformTools>): PlatformTools => ({
  closed: true,
  verbatimText: true,
  schemas: () => schemas(names),
  selection: { query: "", limit: 50, required: new Set<string>() },
  execute: async () => ({ data: "ok" }),
  ...over,
});
const call = (name: string, id = "c1"): ModelCompletion => ({ content: "", toolCalls: [{ id, name, arguments: "{}" }] });

describe("a surface's result cap", () => {
  const big = "x".repeat(20_000);
  const toolRow = (requests: ModelRequest[]) => requests[1]!.messages.find((m) => m.role === "tool")!;

  it("is the cap on a result when the surface names one", async () => {
    const run = ports([call("read"), { content: "fin" }], { platform: catalog(["read"], { execute: async () => ({ data: big }), resultCap: () => 30_000 }) });
    await runAgent({ task: TEST_TASK, policy: TEST_POLICY, ports: run.ports });
    expect(toolRow(run.requests).content).toHaveLength(20_000);
  });

  it("leaves the per-tool table in force when the surface names none", async () => {
    const run = ports([call("read"), { content: "fin" }], { platform: catalog(["read"], { execute: async () => ({ data: big }) }) });
    await runAgent({ task: TEST_TASK, policy: TEST_POLICY, ports: run.ports });
    expect(toolRow(run.requests).content.length).toBeLessThan(20_000);
  });
});

describe("a surface's interruptible commands", () => {
  it("a steered message aborts the foreground command the surface named, and the run goes on", async () => {
    let interrupt: (() => void) | undefined;
    let aborted = false;
    const platform = catalog(["exec"], {
      interruptible: (name, args) => name === "exec" && args.background !== true,
      execute: async (_name, _args, env) =>
        new Promise((resolve) => {
          env.signal?.addEventListener("abort", () => {
            aborted = true;
            resolve({ data: "killed", aborted: true });
          });
          queueMicrotask(() => interrupt?.());
        }),
    });
    const run = ports([call("exec"), { content: "fin" }], {
      platform,
      steering: { drain: () => [], hasInterrupt: () => interrupt !== undefined && aborted, onInterrupt: (listener) => { interrupt = listener; return () => undefined; } },
    });

    const outcome = await runAgent({ task: TEST_TASK, policy: TEST_POLICY, ports: run.ports });

    expect(aborted).toBe(true);
    expect(outcome.kind).toBe("finished");
    // the model reads the steering policy's interrupted wording, the row fails (as a killed registry command's does), and the call does not count toward the failure streak
    const row = run.requests[1]!.messages.find((m) => m.role === "tool")!;
    expect(row.content).toContain("Interrupted by the user's new message");
    expect(row.isError).toBe(true);
  });

  it("a command the surface did not name is not aborted", async () => {
    let aborted = false;
    let interrupt: (() => void) | undefined;
    const platform = catalog(["browser"], {
      execute: async (_n, _a, env) => {
        env.signal?.addEventListener("abort", () => { aborted = true; });
        interrupt?.();
        return { data: "done" };
      },
    });
    const run = ports([call("browser"), { content: "fin" }], { platform, steering: { drain: () => [], onInterrupt: (l) => { interrupt = l; return () => undefined; } } });
    await runAgent({ task: TEST_TASK, policy: TEST_POLICY, ports: run.ports });
    expect(aborted).toBe(false);
  });
});

describe("a stall while the person is steering", () => {
  it("is not judged: the steer is taken and no re-prompt is spent", async () => {
    let queued: string[] = [];
    const run = ports([{ content: "Let me search for that now." }, { content: "The answer is in b.ts." }], {
      platform: catalog(["read"], {}),
      steering: { drain: () => { const q = queued; queued = []; return q; }, hasInterrupt: () => queued.length > 0 },
    });
    // the steer arrives while the first turn is in flight
    const first = run.ports.model.complete;
    let calls = 0;
    run.ports.model.complete = async (request, signal) => { const out = await first(request, signal); if (calls++ === 0) queued = ["actually, look at b.ts instead"]; return out; };

    const outcome = await runAgent({ task: TEST_TASK, policy: TEST_POLICY, ports: run.ports });

    expect(outcome).toMatchObject({ kind: "finished", output: "The answer is in b.ts." });
    expect(run.events.some((e) => e.kind === "stall.recovered")).toBe(false);
    expect(run.requests[1]!.messages.some((m) => m.role === "user" && m.content.includes("look at b.ts"))).toBe(true);
  });
});

describe("a hand-off to a model with a smaller window", () => {
  it("packs the context for the incoming model and says who handed off to whom", async () => {
    const narrates: ModelCompletion = { content: "Let me search for that now.", model: "p/m" };
    // the task comes FIRST, then a long history: the stall's note becomes the latest directive, and the task must still survive the cut
    const rows: RunMessage[] = [{ role: "system", content: "sys" }, { role: "user", content: "TASK-MARK the task", task: true }];
    for (let i = 0; i < 24; i += 1) rows.push({ role: i % 2 === 0 ? "assistant" : "user", content: `row ${i} ${"x".repeat(4_000)}` });
    const run = ports(
      [narrates, narrates, narrates, narrates, { content: "The handler is in agent-loop.ts.", model: "p/m2" }],
      { platform: catalog(["read"], {}) },
      { pickFallback: (tried) => (tried.includes("p/m2") ? undefined : "p/m2"), window: (model) => (model === "p/m2" ? 8_000 : 1_000_000) },
    );

    const outcome = await runAgent({ task: { ...TEST_TASK, transcript: rows }, policy: { ...TEST_POLICY, pinnedModel: "p/m", modelHandoff: {} }, ports: run.ports });

    expect(outcome.kind).toBe("finished");
    const last = run.requests.at(-1)!;
    expect(last.messages.some((m) => m.content.includes("TASK-MARK"))).toBe(true);
    expect(last.model).toBe("p/m2");
    expect(last.messages.some((m) => m.content.includes("Handed off from p/m to p/m2."))).toBe(true);
    expect(last.messages.length).toBeLessThan(rows.length);
  });
});

describe("a hand-off with the task LAST", () => {
  it("keeps the task whole and says who handed off to whom (the order a channel run has: history, then the prompt)", async () => {
    const narrates: ModelCompletion = { content: "Let me search for that now.", model: "p/m" };
    const rows: RunMessage[] = [{ role: "system", content: "sys" }];
    for (let i = 0; i < 24; i += 1) rows.push({ role: i % 2 === 0 ? "assistant" : "user", content: `row ${i} ${"x".repeat(4_000)}` });
    rows.push({ role: "user", content: "TASK-MARK the task", task: true });
    const run = ports(
      [narrates, narrates, narrates, narrates, { content: "The handler is in agent-loop.ts.", model: "p/m2" }],
      { platform: catalog(["read"], {}) },
      { pickFallback: (tried) => (tried.includes("p/m2") ? undefined : "p/m2"), window: (model) => (model === "p/m2" ? 8_000 : 1_000_000) },
    );

    const outcome = await runAgent({ task: { ...TEST_TASK, transcript: rows }, policy: { ...TEST_POLICY, pinnedModel: "p/m", modelHandoff: {} }, ports: run.ports });

    expect(outcome.kind).toBe("finished");
    const last = run.requests.at(-1)!;
    expect(last.messages.some((m) => m.content.includes("TASK-MARK the task"))).toBe(true);
    expect(last.model).toBe("p/m2");
    expect(last.messages.some((m) => m.content.includes("Handed off from p/m to p/m2."))).toBe(true);
    expect(last.messages.length).toBeLessThan(rows.length);
  });
});

describe("the turn AFTER a hand-off onto a small window", () => {
  const SMALL = 16_384;
  const TASK = `TASK-MARK ${"t".repeat(3_000)}`;
  const estimate = (request: ModelRequest): number => request.messages.reduce((n, m) => n + Math.ceil(m.content.length / 4) + 4, 0);
  const narrates: ModelCompletion = { content: "Let me search for that now.", model: "p/m" };

  /** Four narrations fail the run over onto p/m2, which acts once (so a second turn follows the hand-off) and then answers. */
  async function failOver(startWindow: number) {
    const rows: RunMessage[] = [{ role: "system", content: "sys" }, { role: "user", content: TASK, task: true }];
    for (let i = 0; i < 24; i += 1) rows.push({ role: i % 2 === 0 ? "assistant" : "user", content: `row ${i} ${"x".repeat(4_000)}` });
    const run = ports(
      [narrates, narrates, narrates, narrates, { content: "", toolCalls: [{ id: "c9", name: "read", arguments: "{}" }], model: "p/m2" }, { content: "The handler is in agent-loop.ts.", model: "p/m2" }],
      { platform: catalog(["read"], {}) },
      { pickFallback: (tried) => (tried.includes("p/m2") ? undefined : "p/m2"), window: (model) => (model === "p/m2" ? SMALL : startWindow), summarize: async () => ({ content: "SUMMARY of the middle" }) },
    );
    const outcome = await runAgent({ task: { ...TEST_TASK, transcript: rows }, policy: { ...TEST_POLICY, pinnedModel: "p/m", modelHandoff: {} }, ports: run.ports });
    return { outcome, requests: run.requests };
  }

  function expectHistoryKept(requests: ModelRequest[]): void {
    const small = requests.filter((r) => r.model === "p/m2");
    // the hand-off turn and the turn after it (the ordinary compaction, from === to)
    expect(small).toHaveLength(2);
    for (const request of small) {
      // the full task text, not an elision of it
      expect(request.messages.some((m) => m.content === TASK)).toBe(true);
      // history survives the cut: more than the task and the latest row
      expect(request.messages.filter((m) => m.content.startsWith("row ")).length).toBeGreaterThanOrEqual(3);
      // the input plus the reply it asks for fits the window
      expect(estimate(request) + (request.maxTokens ?? 0)).toBeLessThanOrEqual(SMALL);
    }
  }

  it("keeps the history and the whole task when the context fit before the failover", async () => {
    const { outcome, requests } = await failOver(200_000);
    expect(outcome.kind).toBe("finished");
    expectHistoryKept(requests);
  });

  it("keeps the history and the whole task when the context did NOT fit before the failover", async () => {
    const { outcome, requests } = await failOver(24_000);
    expect(outcome.kind).toBe("finished");
    expectHistoryKept(requests);
  });
});

describe("a hand-off is opt-in", () => {
  it("a run whose policy names no hand-off is compacted as it always was: no hand-off note, no state written", async () => {
    const narrates: ModelCompletion = { content: "Let me search for that now.", model: "p/m" };
    const rows: RunMessage[] = [{ role: "system", content: "sys" }, { role: "user", content: "the task", task: true }];
    for (let i = 0; i < 24; i += 1) rows.push({ role: i % 2 === 0 ? "assistant" : "user", content: `row ${i} ${"x".repeat(4_000)}` });
    const saved: unknown[] = [];
    const run = ports(
      [narrates, narrates, narrates, narrates, { content: "The handler is in agent-loop.ts.", model: "p/m2" }],
      { platform: catalog(["read"], {}), store: { load: () => undefined, save: (s) => void saved.push(s) } },
      { pickFallback: (tried) => (tried.includes("p/m2") ? undefined : "p/m2"), window: (model) => (model === "p/m2" ? 8_000 : 1_000_000) },
    );

    await runAgent({ task: { ...TEST_TASK, transcript: rows }, policy: { ...TEST_POLICY, pinnedModel: "p/m" }, ports: run.ports });

    expect(run.requests.at(-1)!.messages.some((m) => m.content.includes("Handed off from"))).toBe(false);
    expect(saved.some((s) => (s as { preparedFor?: string }).preparedFor !== undefined)).toBe(false);
  });
});
