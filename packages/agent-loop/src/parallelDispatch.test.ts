import { describe, expect, it } from "vitest";
import { runAgentLoop } from "./loop.js";
import { openAiChatCodec, type OpenAiAssistantRow, type OpenAiToolRow } from "./openaiCodec.js";
import type { LoopDispatchResult, LoopHooks, LoopPorts, LoopTurnResult, ParsedToolCall } from "./types.js";

type Row = OpenAiAssistantRow | OpenAiToolRow | { role: "user" | "system"; content: string };

const call = (id: string, name: string, args: unknown = {}) => ({ id, name, arguments: JSON.stringify(args) });
const READS = new Set(["read_file", "search_code"]);

/** A port whose reads resolve only when released, so a test can observe overlap. */
function gatedPorts(turns: LoopTurnResult[], opts: { readOnly?: boolean } = {}) {
  let i = 0;
  let inFlight = 0;
  const log: string[] = [];
  const ports: LoopPorts<Row> & { maxInFlight: number; log: string[] } = {
    maxInFlight: 0,
    log,
    async complete() {
      const t = turns[i++];
      if (!t) throw new Error("script exhausted");
      return t;
    },
    async dispatch(c: ParsedToolCall): Promise<LoopDispatchResult> {
      inFlight++;
      ports.maxInFlight = Math.max(ports.maxInFlight, inFlight);
      log.push(`start:${c.id}`);
      // Later calls finish FIRST, so result order cannot come from completion order.
      await new Promise((r) => setTimeout(r, c.id === "a" ? 15 : 1));
      inFlight--;
      log.push(`end:${c.id}`);
      return { data: { id: c.id } };
    },
    ...(opts.readOnly ? { isReadOnly: (c: ParsedToolCall) => READS.has(c.name) } : {}),
  };
  return ports;
}

describe("runAgentLoop — concurrent read-only dispatch (D8)", () => {
  it("dispatches consecutive read-only calls together and keeps result rows in call order", async () => {
    const messages: Row[] = [];
    const ports = gatedPorts([
      { content: "", toolCalls: [call("a", "read_file", { path: "x" }), call("b", "search_code", { query: "y" })] },
      { content: "done", toolCalls: [] },
    ], { readOnly: true });
    await runAgentLoop({ messages, codec: openAiChatCodec<Row>(), ports, budget: { stepCap: 5 } });
    expect(ports.maxInFlight).toBe(2);
    expect(messages.filter((m) => m.role === "tool").map((m) => (m as OpenAiToolRow).tool_call_id)).toEqual(["a", "b"]);
  });

  it("stays sequential when the port is absent", async () => {
    const ports = gatedPorts([
      { content: "", toolCalls: [call("a", "read_file"), call("b", "read_file")] },
      { content: "done", toolCalls: [] },
    ]);
    await runAgentLoop({ messages: [], codec: openAiChatCodec<Row>(), ports, budget: { stepCap: 5 } });
    expect(ports.maxInFlight).toBe(1);
    expect(ports.log).toEqual(["start:a", "end:a", "start:b", "end:b"]);
  });

  it("never overlaps a write with the reads around it", async () => {
    const ports = gatedPorts([
      { content: "", toolCalls: [call("a", "read_file"), call("b", "read_file"), call("w", "write_file"), call("c", "read_file")] },
      { content: "done", toolCalls: [] },
    ], { readOnly: true });
    await runAgentLoop({ messages: [], codec: openAiChatCodec<Row>(), ports, budget: { stepCap: 5 } });
    const wStart = ports.log.indexOf("start:w");
    expect(ports.log.indexOf("end:a")).toBeLessThan(wStart);
    expect(ports.log.indexOf("end:b")).toBeLessThan(wStart);
    expect(ports.log.indexOf("end:w")).toBeLessThan(ports.log.indexOf("start:c"));
  });

  it("runs beforeDispatch for every batched call before any of them dispatches, in order", async () => {
    const order: string[] = [];
    const ports = gatedPorts([
      { content: "", toolCalls: [call("a", "read_file"), call("b", "read_file")] },
      { content: "done", toolCalls: [] },
    ], { readOnly: true });
    const inner = ports.dispatch.bind(ports);
    ports.dispatch = async (c, ctx) => { order.push(`dispatch:${c.id}`); return inner(c, ctx); };
    const hooks: LoopHooks<Row> = {
      beforeDispatch: (c) => { order.push(`before:${c.id}`); },
      afterDispatch: (c) => { order.push(`after:${c.id}`); },
    };
    await runAgentLoop({ messages: [], codec: openAiChatCodec<Row>(), ports, hooks, budget: { stepCap: 5 } });
    expect(order).toEqual(["before:a", "before:b", "dispatch:a", "dispatch:b", "after:a", "after:b"]);
  });

  it("closes the batch at a call whose beforeDispatch parked the run", async () => {
    const ports = gatedPorts([
      { content: "", toolCalls: [call("a", "read_file"), call("b", "read_file"), call("c", "read_file")] },
    ], { readOnly: true });
    const hooks: LoopHooks<Row> = {
      beforeDispatch: (c) => (c.id === "a" ? { result: { data: { ok: false }, control: { kind: "ask_human", question: "ok?" } } } : undefined),
    };
    const r = await runAgentLoop({ messages: [], codec: openAiChatCodec<Row>(), ports, hooks, budget: { stepCap: 5 } });
    expect(r.awaitingInput?.question).toBe("ok?");
    // The parked call never dispatched; the reads after it ran as their own batch.
    expect(ports.log.filter((l) => l.startsWith("start:"))).toEqual(["start:b", "start:c"]);
  });

  it("skipRemaining still replaces every later row of the turn", async () => {
    const messages: Row[] = [];
    const ports = gatedPorts([
      { content: "", toolCalls: [call("a", "read_file"), call("b", "read_file"), call("c", "read_file")] },
      { content: "done", toolCalls: [] },
    ], { readOnly: true });
    const hooks: LoopHooks<Row> = {
      afterDispatch: (c) => (c.id === "a" ? { skipRemaining: { data: { skipped: true } } } : undefined),
    };
    await runAgentLoop({ messages, codec: openAiChatCodec<Row>(), ports, hooks, budget: { stepCap: 5 } });
    const rows = messages.filter((m) => m.role === "tool") as OpenAiToolRow[];
    expect(rows.map((m) => m.tool_call_id)).toEqual(["a", "b", "c"]);
    expect(JSON.parse(rows[1]!.content)).toEqual({ skipped: true });
    expect(JSON.parse(rows[2]!.content)).toEqual({ skipped: true });
  });
});
