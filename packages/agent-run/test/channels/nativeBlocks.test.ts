/**
 * What a surface with its OWN transcript shape (the on-prem channels) needs from the contract: native blocks and
 * message-level fields that ride the rows and come back unchanged, a closed tool catalog whose results keep their blocks,
 * a host-chosen failover model, messages taken only once the run would stop, an answer found before any model call, and a
 * stalled run that records why it produced nothing. All additive: a run that uses none of it is unchanged.
 */
import { describe, expect, it } from "vitest";
import type { Capability } from "@builderforce/agent-tools";
import {
  runAgent,
  type ModelCompletion,
  type ModelRequest,
  type PlatformTools,
  type RunMessage,
  type RunPorts,
} from "../../src/index.js";
import { TEST_POLICY, TEST_TASK, schemas } from "../support/policyContext.js";

interface Harness {
  ports: RunPorts;
  rows: RunMessage[];
  requests: ModelRequest[];
}

function harness(answers: Array<ModelCompletion | ((request: ModelRequest) => ModelCompletion)>, extra: Partial<RunPorts> = {}, model: Partial<RunPorts["model"]> = {}): Harness {
  const rows: RunMessage[] = [];
  const requests: ModelRequest[] = [];
  let n = 0;
  const ports: RunPorts = {
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
    store: { load: () => undefined, save: () => undefined, appended: (row) => void rows.push(row) },
    events: { emit: () => undefined },
    human: { ask: async () => ({ kind: "paused" }) },
    context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
    ...extra,
  };
  return { ports, rows, requests };
}

const closedCatalog = (execute: PlatformTools["execute"]): PlatformTools => ({
  closed: true,
  verbatimText: true,
  schemas: () => schemas(["echo"]),
  selection: { query: "", limit: 50, required: new Set<string>() },
  execute,
});

describe("native blocks ride the rows", () => {
  it("an answer's parts and meta land on the assistant row of a tool turn and of the final turn", async () => {
    const thinking = { type: "thinking" as const, thinking: "hmm", signature: "sig-1" };
    const call = { type: "toolCall" as const, id: "c1", name: "echo", arguments: { text: "x" }, signature: "sig-2" };
    const { ports, rows } = harness(
      [
        { content: "", toolCalls: [{ id: "c1", name: "echo", arguments: '{"text":"x"}' }], parts: [thinking, call], meta: { provider: "p", stopReason: "toolUse" } },
        { content: "all done", parts: [{ type: "text", text: "all done", signature: "sig-3" }], meta: { provider: "p", stopReason: "stop" } },
      ],
      { platform: closedCatalog(async () => ({ data: "echoed:x" })) },
    );

    const outcome = await runAgent({ task: TEST_TASK, policy: TEST_POLICY, ports });

    expect(outcome.kind).toBe("finished");
    const assistants = rows.filter((r) => r.role === "assistant");
    expect(assistants).toHaveLength(2);
    expect(assistants[0]).toMatchObject({ parts: [thinking, call], meta: { provider: "p", stopReason: "toolUse" } });
    expect(assistants[1]).toMatchObject({ content: "all done", parts: [{ type: "text", text: "all done", signature: "sig-3" }], meta: { stopReason: "stop" } });
  });

  it("a closed catalog's result keeps its blocks and fields, and the model reads its text, not a quoted copy", async () => {
    const blocks = [{ type: "text" as const, text: "shot" }, { type: "image" as const, url: "data:image/png;base64,QUJD" }];
    const { ports, rows, requests } = harness(
      [{ content: "", toolCalls: [{ id: "c1", name: "echo", arguments: "{}" }] }, { content: "fin" }],
      { platform: closedCatalog(async () => ({ data: "shot", parts: blocks, meta: { details: { path: "/x.png" } } })) },
    );

    await runAgent({ task: TEST_TASK, policy: TEST_POLICY, ports });

    const tool = rows.find((r) => r.role === "tool");
    expect(tool).toEqual({ role: "tool", toolCallId: "c1", content: "shot", parts: blocks, meta: { details: { path: "/x.png" } } });
    expect(requests[1]!.messages.find((m) => m.role === "tool")?.content).toBe("shot");
  });

  it("the call's id reaches the surface's tool, and a failed call is marked on its row", async () => {
    const ids: Array<string | undefined> = [];
    const { ports, rows } = harness(
      [{ content: "", toolCalls: [{ id: "c9", name: "echo", arguments: "{}" }] }, { content: "fin" }],
      { platform: closedCatalog(async (_name, _args, env) => { ids.push(env.callId); return { data: "boom", isError: true }; }) },
    );

    await runAgent({ task: TEST_TASK, policy: TEST_POLICY, ports });

    expect(ids).toEqual(["c9"]);
    expect(rows.find((r) => r.role === "tool")).toMatchObject({ toolCallId: "c9", isError: true });
  });

  it("a governance refusal names the gate that stopped the call", async () => {
    const { ports, rows } = harness(
      [{ content: "", toolCalls: [{ id: "c1", name: "write_file", arguments: '{"path":"secrets/key.txt"}' }] }, { content: "blocked" }],
      { platform: { ...closedCatalog(async () => ({ data: "wrote" })), schemas: () => schemas(["write_file"]) } },
    );
    const policy = { ...TEST_POLICY, approvalGates: [{ id: "no-secrets", effect: "block" as const, tool: "write_file", paths: ["secrets/**"], reason: "do not write secrets" }] };

    await runAgent({ task: TEST_TASK, policy, ports });

    const tool = rows.find((r) => r.role === "tool")!;
    expect(tool.isError).toBe(true);
    expect(tool.content).toContain("no-secrets");
  });
});

describe("a host-chosen failover", () => {
  const narrates = (model: string): ModelCompletion => ({ content: "Let me search for that now.", model });

  it("asks the transport for the successor once the re-prompt budget is spent, handing it what was tried", async () => {
    const tried: string[][] = [];
    const answers: ModelCompletion[] = [narrates("p/m"), narrates("p/m"), narrates("p/m"), narrates("p/m"), { content: "The handler is in agent-loop.ts.", model: "p/m2" }];
    const { ports, requests } = harness(
      answers,
      { platform: closedCatalog(async () => ({ data: "ok" })) },
      { pickFallback: (t) => { tried.push([...t]); return t.includes("p/m2") ? undefined : "p/m2"; } },
    );

    const outcome = await runAgent({ task: TEST_TASK, policy: { ...TEST_POLICY, pinnedModel: "p/m" }, ports });

    expect(outcome.kind).toBe("finished");
    expect(tried[0]).toContain("p/m");
    expect(requests.at(-1)!.model).toBe("p/m2");
  });
});

describe("what ends a run", () => {
  it("queued follow-ups are taken once the run would stop, and the run continues on them", async () => {
    let queued: Array<string | { text: string }> = ["and also this"];
    const { ports, requests, rows } = harness([{ content: "first" }, { content: "second" }], {
      steering: { drain: () => [], followUp: () => { const q = queued; queued = []; return q; } },
    });

    const outcome = await runAgent({ task: TEST_TASK, policy: TEST_POLICY, ports });

    expect(outcome).toMatchObject({ kind: "finished", output: "second" });
    expect(requests).toHaveLength(2);
    expect(requests[1]!.messages.some((m) => m.role === "user" && m.content === "and also this")).toBe(true);
    expect(rows.map((r) => r.role)).toEqual(["assistant", "user", "assistant"]);
  });

  it("an answer found before any model call settles the run, and no model is asked", async () => {
    const { ports, rows, requests } = harness([], {
      context: { pack: () => ({ focus: [], facts: [], recall: [], answer: "git status: clean" }) },
    });

    const outcome = await runAgent({ task: TEST_TASK, policy: TEST_POLICY, ports });

    expect(outcome).toMatchObject({ kind: "finished", output: "git status: clean" });
    expect(requests).toHaveLength(0);
    expect(rows).toEqual([{ role: "assistant", content: "git status: clean" }]);
  });

  it("a stall with nothing left to try, on a surface that records it, leaves the notice in the transcript", async () => {
    const narrate: ModelCompletion = { content: "Let me search for that now." };
    const { ports, rows } = harness([narrate, narrate, narrate, narrate], { platform: closedCatalog(async () => ({ data: "ok" })) });

    const outcome = await runAgent({ task: TEST_TASK, policy: { ...TEST_POLICY, stallExhausted: "note" }, ports });

    expect(outcome.kind).toBe("failed");
    expect(rows.at(-1)).toMatchObject({ role: "user" });
    expect(rows.at(-1)!.content).toContain("nothing was actually run");
  });
});
