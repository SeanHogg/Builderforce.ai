import { describe, expect, it } from "vitest";
import { runAgentLoop } from "./loop.js";
import { openAiChatCodec, type OpenAiAssistantRow, type OpenAiToolRow } from "./openaiCodec.js";
import type { LoopPorts, ParsedToolCall } from "./types.js";

type Row = OpenAiAssistantRow | OpenAiToolRow | { role: "user" | "system"; content: string };

const call = (id: string, name: string, args: unknown = {}) => ({ id, name, arguments: JSON.stringify(args) });

/**
 * PRD 35 E10: Stop while a tool is still running. The kernel used to await the dispatch
 * in flight before it looked at the signal, so the UI said "stopped" while the loop sat
 * on a 10-minute command. The dispatch is now raced against the signal: the run settles
 * `cancelled` at once, the late result is dropped, and the model is never asked again.
 */
describe("runAgentLoop — cancel with a dispatch in flight", () => {
  it("returns cancelled while the dispatch is still running, and drops its late result", async () => {
    const ac = new AbortController();
    let asked = 0;
    let release!: (value: { data: unknown }) => void;
    const dispatched: ParsedToolCall[] = [];
    const ports: LoopPorts<Row> = {
      async complete() {
        asked++;
        return { content: "", toolCalls: [call("c1", "run_command", { command: "sleep 600" }), call("c2", "read_file", { path: "a.ts" })] };
      },
      dispatch(c) {
        dispatched.push(c);
        // Never settles on its own until released — the long command.
        return new Promise((resolve) => { release = resolve; });
      },
    };
    const messages: Row[] = [{ role: "user", content: "run the tests" }];
    const pending = runAgentLoop({ messages, codec: openAiChatCodec<Row>(), ports, signal: ac.signal, budget: { stepCap: 5 } });
    await new Promise((r) => setTimeout(r, 10));
    const t0 = Date.now();
    ac.abort();
    const r = await pending;
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(r.cancelled).toBe(true);
    expect(r.finished).toBe(false);
    expect(asked).toBe(1);
    // The turn's second call never started.
    expect(dispatched.map((c) => c.name)).toEqual(["run_command"]);
    // Every tool_call of the pushed assistant turn has its (stopped) row.
    const toolRows = messages.filter((m): m is OpenAiToolRow => m.role === "tool");
    expect(toolRows.map((m) => m.tool_call_id)).toEqual(["c1", "c2"]);
    for (const row of toolRows) expect(JSON.parse(String(row.content))).toMatchObject({ ok: false, aborted: true, error: "stopped" });
    // The late result arrives after the run settled and changes nothing.
    const rows = messages.length;
    release({ data: { ok: true, stdout: "late" } });
    await new Promise((r) => setTimeout(r, 0));
    expect(messages).toHaveLength(rows);
  });

  it("calls settled before the cancel keep their real rows; the rest are stopped", async () => {
    const ac = new AbortController();
    const ports: LoopPorts<Row> = {
      async complete() {
        return { content: "", toolCalls: [call("a1", "write_file", { path: "x" }), call("a2", "run_command", { command: "sleep 600" }), call("a3", "read_file", { path: "y" })] };
      },
      dispatch(c) {
        if (c.id === "a1") return Promise.resolve({ data: { ok: true, wrote: "x" } });
        return new Promise(() => undefined);
      },
    };
    const messages: Row[] = [];
    const pending = runAgentLoop({ messages, codec: openAiChatCodec<Row>(), ports, signal: ac.signal, budget: { stepCap: 5 } });
    await new Promise((r) => setTimeout(r, 10));
    ac.abort();
    await expect(pending).resolves.toMatchObject({ cancelled: true });
    const assistant = messages.find((m): m is OpenAiAssistantRow => m.role === "assistant")!;
    const ids = (assistant.tool_calls ?? []).map((t) => t.id);
    const toolRows = messages.filter((m): m is OpenAiToolRow => m.role === "tool");
    expect(toolRows.map((m) => m.tool_call_id)).toEqual(ids);
    expect(JSON.parse(String(toolRows[0]!.content))).toMatchObject({ ok: true });
    expect(JSON.parse(String(toolRows[1]!.content))).toMatchObject({ aborted: true });
  });

  it("a dispatch that rejects after the cancel does not surface as an unhandled error", async () => {
    const ac = new AbortController();
    let fail!: (e: Error) => void;
    const ports: LoopPorts<Row> = {
      async complete() {
        return { content: "", toolCalls: [call("c1", "run_command", { command: "sleep 600" })] };
      },
      dispatch() {
        return new Promise((_, reject) => { fail = reject; });
      },
    };
    const pending = runAgentLoop({ messages: [], codec: openAiChatCodec<Row>(), ports, signal: ac.signal, budget: { stepCap: 5 } });
    await new Promise((r) => setTimeout(r, 10));
    ac.abort();
    await expect(pending).resolves.toMatchObject({ cancelled: true });
    fail(new Error("killed"));
    await new Promise((r) => setTimeout(r, 0));
  });

  it("without a signal the dispatch is awaited as before", async () => {
    let n = 0;
    const ports: LoopPorts<Row> = {
      async complete() {
        n++;
        return n === 1 ? { content: "", toolCalls: [call("c1", "read_file", { path: "a.ts" })] } : { content: "done", toolCalls: [] };
      },
      async dispatch() {
        await new Promise((r) => setTimeout(r, 20));
        return { data: { ok: true } };
      },
    };
    const r = await runAgentLoop({ messages: [], codec: openAiChatCodec<Row>(), ports, budget: { stepCap: 5 } });
    expect(r).toMatchObject({ finished: true, cancelled: false, output: "done" });
  });
});
