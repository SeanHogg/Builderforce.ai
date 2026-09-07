import { describe, expect, it } from "vitest";
import { runAgentLoop } from "./loop.js";
import { openAiChatCodec, type OpenAiAssistantRow, type OpenAiToolRow } from "./openaiCodec.js";
import type { LoopHooks, LoopPorts, LoopTurnResult, ParsedToolCall } from "./types.js";

type Row = OpenAiAssistantRow | OpenAiToolRow | { role: "user" | "system"; content: string };

function scripted(turns: LoopTurnResult[]): LoopPorts<Row> & { dispatched: ParsedToolCall[]; asked: number } {
  let i = 0;
  const ports = {
    dispatched: [] as ParsedToolCall[],
    asked: 0,
    async complete() {
      ports.asked++;
      const t = turns[i++];
      if (!t) throw new Error("script exhausted");
      return t;
    },
    async dispatch(call: ParsedToolCall) {
      ports.dispatched.push(call);
      if (call.name === "finish") return { data: { ok: true }, control: { kind: "finish" as const, summary: String(call.args.summary ?? "") } };
      if (call.name === "ask_human") return { data: { ok: true }, control: { kind: "ask_human" as const, question: String(call.args.question ?? "?") } };
      return { data: { echoed: call.args } };
    },
  };
  return ports;
}

const call = (id: string, name: string, args: unknown = {}) => ({ id, name, arguments: typeof args === "string" ? args : JSON.stringify(args) });

describe("runAgentLoop", () => {
  it("finishes on a turn with no tool calls and reports its content as output", async () => {
    const messages: Row[] = [{ role: "user", content: "hi" }];
    const ports = scripted([{ content: "done", toolCalls: [] }]);
    const r = await runAgentLoop({ messages, codec: openAiChatCodec<Row>(), ports, budget: { stepCap: 10 } });
    expect(r).toMatchObject({ ok: true, finished: true, cancelled: false, exhausted: false, output: "done", step: 0 });
    expect(messages).toHaveLength(1);
  });

  it("pushes the assistant row, dispatches every call in order and pushes a tool row per call", async () => {
    const messages: Row[] = [];
    const ports = scripted([
      { content: "", toolCalls: [call("a", "read", { path: "x" }), call("b", "read", { path: "y" })] },
      { content: "final", toolCalls: [] },
    ]);
    const r = await runAgentLoop({ messages, codec: openAiChatCodec<Row>(), ports, budget: { stepCap: 10 } });
    expect(ports.dispatched.map((c) => c.id)).toEqual(["a", "b"]);
    expect(messages.map((m) => m.role)).toEqual(["assistant", "tool", "tool"]);
    expect((messages[0] as OpenAiAssistantRow).tool_calls[1]?.function.arguments).toBe('{"path":"y"}');
    expect((messages[2] as OpenAiToolRow).tool_call_id).toBe("b");
    expect(r.output).toBe("final");
    expect(r.step).toBe(1);
  });

  it("parses malformed arguments to {} and flags the call", async () => {
    const ports = scripted([{ content: "", toolCalls: [call("a", "read", "{not json")] }, { content: "ok", toolCalls: [] }]);
    await runAgentLoop({ messages: [], codec: openAiChatCodec<Row>(), ports, budget: { stepCap: 5 } });
    expect(ports.dispatched[0]).toMatchObject({ args: {}, malformed: true });
  });

  it("honours a finish control: finished=true, summary becomes the output", async () => {
    const ports = scripted([{ content: "", toolCalls: [call("f", "finish", { summary: "shipped" })] }]);
    const r = await runAgentLoop({ messages: [], codec: openAiChatCodec<Row>(), ports, budget: { stepCap: 5 } });
    expect(r).toMatchObject({ finished: true, ok: true, output: "shipped" });
    expect(ports.asked).toBe(1);
  });

  it("lets onFinish block a finish: the model sees {ok:false,error} and the loop continues", async () => {
    const messages: Row[] = [];
    const ports = scripted([
      { content: "", toolCalls: [call("f", "finish", { summary: "too early" })] },
      { content: "", toolCalls: [call("g", "finish", { summary: "now" })] },
    ]);
    let blocks = 0;
    const hooks: LoopHooks<Row> = { onFinish: () => (blocks++ === 0 ? "write a file first" : null) };
    const r = await runAgentLoop({ messages, codec: openAiChatCodec<Row>(), ports, hooks, budget: { stepCap: 5 } });
    expect(JSON.parse((messages[1] as OpenAiToolRow).content)).toEqual({ ok: false, error: "write a file first" });
    expect(r).toMatchObject({ finished: true, output: "now", step: 1 });
  });

  it("surfaces ask_human as awaitingInput after finishing the turn's remaining calls", async () => {
    const ports = scripted([{ content: "", toolCalls: [call("q", "ask_human", { question: "which db?" }), call("r", "read", {})] }]);
    const r = await runAgentLoop({ messages: [], codec: openAiChatCodec<Row>(), ports, budget: { stepCap: 5 } });
    expect(r.awaitingInput).toEqual({ approvalId: undefined, question: "which db?", callId: "q" });
    expect(r.finished).toBe(false);
    expect(ports.dispatched.map((c) => c.id)).toEqual(["q", "r"]);
    expect(ports.asked).toBe(1);
  });

  it("yields on maxSteps without finishing and resumes from startStep", async () => {
    const ports = scripted([
      { content: "", toolCalls: [call("a", "read")] },
      { content: "", toolCalls: [call("b", "read")] },
      { content: "end", toolCalls: [] },
    ]);
    const messages: Row[] = [];
    const codec = openAiChatCodec<Row>();
    const first = await runAgentLoop({ messages, codec, ports, budget: { stepCap: 30, maxSteps: 1 } });
    expect(first).toMatchObject({ finished: false, exhausted: false, step: 1 });
    const second = await runAgentLoop({ messages, codec, ports, budget: { stepCap: 30, maxSteps: 1, startStep: first.step } });
    expect(second).toMatchObject({ finished: false, step: 2 });
    const third = await runAgentLoop({ messages, codec, ports, budget: { stepCap: 30, maxSteps: 1, startStep: second.step }, initialOutput: "carry" });
    expect(third).toMatchObject({ finished: true, output: "end", step: 2 });
    expect(messages.map((m) => m.role)).toEqual(["assistant", "tool", "assistant", "tool"]);
  });

  it("reports exhausted when the absolute cap is hit", async () => {
    const ports = scripted([
      { content: "", toolCalls: [call("a", "read")] },
      { content: "", toolCalls: [call("b", "read")] },
    ]);
    const r = await runAgentLoop({ messages: [], codec: openAiChatCodec<Row>(), ports, budget: { stepCap: 2 } });
    expect(r).toMatchObject({ finished: false, exhausted: true, step: 2 });
  });

  it("stops before asking the model when cancelled via hook or signal", async () => {
    const ports = scripted([{ content: "never", toolCalls: [] }]);
    const byHook = await runAgentLoop({ messages: [], codec: openAiChatCodec<Row>(), ports, hooks: { isCancelled: () => true }, budget: { stepCap: 5 } });
    expect(byHook).toMatchObject({ cancelled: true, finished: false });
    const ac = new AbortController();
    ac.abort();
    const bySignal = await runAgentLoop({ messages: [], codec: openAiChatCodec<Row>(), ports, signal: ac.signal, budget: { stepCap: 5 } });
    expect(bySignal.cancelled).toBe(true);
    expect(ports.asked).toBe(0);
  });

  it("treats a throw from complete() as cancelled when the signal aborted, otherwise rethrows", async () => {
    const ac = new AbortController();
    const ports: LoopPorts<Row> = {
      async complete() {
        ac.abort();
        throw new Error("aborted");
      },
      async dispatch() {
        return { data: null };
      },
    };
    const r = await runAgentLoop({ messages: [], codec: openAiChatCodec<Row>(), ports, signal: ac.signal, budget: { stepCap: 5 } });
    expect(r.cancelled).toBe(true);
    const boom: LoopPorts<Row> = { ...ports, complete: async () => { throw new Error("gateway"); } };
    await expect(runAgentLoop({ messages: [], codec: openAiChatCodec<Row>(), ports: boom, budget: { stepCap: 5 } })).rejects.toThrow("gateway");
  });

  it("a {failed} turn ends the run ok:false with the reason", async () => {
    const ports = scripted([{ failed: "gateway 502" }]);
    const r = await runAgentLoop({ messages: [], codec: openAiChatCodec<Row>(), ports, budget: { stepCap: 5 } });
    expect(r).toMatchObject({ ok: false, finished: true, output: "gateway 502" });
  });

  it("a {skip} turn spends the step and loops again", async () => {
    const ports = scripted([{ skip: true }, { content: "ok", toolCalls: [] }]);
    const r = await runAgentLoop({ messages: [], codec: openAiChatCodec<Row>(), ports, budget: { stepCap: 5 } });
    expect(r).toMatchObject({ finished: true, output: "ok", step: 1 });
  });

  it("beforeTurn stop ends the run without a model call", async () => {
    const ports = scripted([{ content: "never", toolCalls: [] }]);
    const r = await runAgentLoop({
      messages: [], codec: openAiChatCodec<Row>(), ports, budget: { stepCap: 5 },
      hooks: { beforeTurn: () => ({ action: "stop", ok: false, output: "containment" }) },
    });
    expect(r).toMatchObject({ ok: false, finished: true, output: "containment" });
    expect(ports.asked).toBe(0);
  });

  it("onNoToolCalls can continue (stall recovery) or stop with its own output", async () => {
    const messages: Row[] = [];
    const ports = scripted([{ content: "", toolCalls: [] }, { content: "", toolCalls: [] }]);
    let nudges = 0;
    const r = await runAgentLoop({
      messages, codec: openAiChatCodec<Row>(), ports, budget: { stepCap: 5 },
      hooks: {
        onNoToolCalls: (ctx) => {
          if (nudges++ === 0) { ctx.messages.push({ role: "system", content: "keep going" }); return { action: "continue" }; }
          return { action: "stop", ok: true, output: "synthesised" };
        },
      },
    });
    expect(r).toMatchObject({ ok: true, finished: true, output: "synthesised", step: 1 });
    expect(messages).toEqual([{ role: "system", content: "keep going" }]);
  });

  it("beforeToolCalls stop ends the run WITHOUT pushing the assistant row (terminal ask_user)", async () => {
    const messages: Row[] = [];
    const ports = scripted([{ content: "", toolCalls: [call("u", "ask_user", { question: "?" })] }]);
    const r = await runAgentLoop({
      messages, codec: openAiChatCodec<Row>(), ports, budget: { stepCap: 5 },
      hooks: { beforeToolCalls: (_c, _t, calls) => (calls[0]?.name === "ask_user" ? { action: "stop", ok: true, output: "?" } : undefined) },
    });
    expect(r).toMatchObject({ ok: true, finished: true, output: "?" });
    expect(messages).toEqual([]);
    expect(ports.dispatched).toEqual([]);
  });

  it("beforeDispatch can short-circuit with a result or rewrite the call", async () => {
    const messages: Row[] = [];
    const ports = scripted([{ content: "", toolCalls: [call("a", "read", { path: "x" }), call("b", "route", { to: "search" })] }, { content: "ok", toolCalls: [] }]);
    await runAgentLoop({
      messages, codec: openAiChatCodec<Row>(), ports, budget: { stepCap: 5 },
      hooks: {
        beforeDispatch: (c) => {
          if (c.name === "read") return { result: { data: { cached: true } } };
          if (c.name === "route") return { rewrite: { ...c, name: "search", args: { q: "x" } } };
          return undefined;
        },
      },
    });
    expect(ports.dispatched.map((c) => c.name)).toEqual(["search"]);
    expect(JSON.parse((messages[1] as OpenAiToolRow).content)).toEqual({ cached: true });
    expect((messages[2] as OpenAiToolRow).tool_call_id).toBe("b");
  });

  it("afterDispatch skipRemaining pushes the skip payload for every remaining call", async () => {
    const messages: Row[] = [];
    const ports = scripted([{ content: "", toolCalls: [call("a", "read"), call("b", "read"), call("c", "read")] }, { content: "ok", toolCalls: [] }]);
    await runAgentLoop({
      messages, codec: openAiChatCodec<Row>(), ports, budget: { stepCap: 5 },
      hooks: { afterDispatch: () => ({ skipRemaining: { data: "steered" } }) },
    });
    expect(ports.dispatched.map((c) => c.id)).toEqual(["a"]);
    expect(messages.slice(1).map((m) => (m as OpenAiToolRow).tool_call_id)).toEqual(["a", "b", "c"]);
    expect((messages[3] as OpenAiToolRow).content).toBe('"steered"');
  });

  it("afterToolCalls can re-open a finished run (queued steering after finish)", async () => {
    const ports = scripted([{ content: "", toolCalls: [call("f", "finish", { summary: "s" })] }, { content: "after steer", toolCalls: [] }]);
    let reopened = false;
    const r = await runAgentLoop({
      messages: [], codec: openAiChatCodec<Row>(), ports, budget: { stepCap: 5 },
      hooks: { afterToolCalls: (_c, finished) => (finished && !reopened ? ((reopened = true), { finished: false }) : undefined) },
    });
    expect(r).toMatchObject({ finished: true, output: "after steer", step: 1 });
  });

  it("uses the codec's serializer for tool rows", async () => {
    const messages: Row[] = [];
    const ports = scripted([{ content: "", toolCalls: [call("a", "read")] }, { content: "ok", toolCalls: [] }]);
    await runAgentLoop({ messages, codec: openAiChatCodec<Row>((r) => `len=${JSON.stringify(r.data).length}`), ports, budget: { stepCap: 5 } });
    expect((messages[1] as OpenAiToolRow).content).toMatch(/^len=\d+$/);
  });
});
