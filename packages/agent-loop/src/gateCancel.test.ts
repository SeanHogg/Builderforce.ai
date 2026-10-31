import { describe, expect, it } from "vitest";
import { runAgentLoop } from "./loop.js";
import { openAiChatCodec, type OpenAiAssistantRow, type OpenAiToolRow } from "./openaiCodec.js";
import type { LoopPorts, ParsedToolCall } from "./types.js";

type Row = OpenAiAssistantRow | OpenAiToolRow | { role: "user" | "system"; content: string };

const call = (id: string, name: string) => ({ id, name, arguments: "{}" });

/**
 * A governance gate that waits on an approver sits inside `beforeDispatch`. If the run is stopped while it waits, the call that
 * the hook then lets through must not start: the tool never runs, and every call of the turn still gets its stopped row.
 */
describe("runAgentLoop — stopped while beforeDispatch was deciding", () => {
  it("dispatches nothing once the signal has fired, and answers every call", async () => {
    const ac = new AbortController();
    const dispatched: ParsedToolCall[] = [];
    const ports: LoopPorts<Row> = {
      async complete() {
        return { content: "", toolCalls: [call("c1", "exec"), call("c2", "write_file")] };
      },
      async dispatch(c) {
        dispatched.push(c);
        return { data: { ok: true } };
      },
    };
    const messages: Row[] = [{ role: "user", content: "go" }];
    const r = await runAgentLoop({
      messages,
      codec: openAiChatCodec<Row>(),
      ports,
      signal: ac.signal,
      budget: { stepCap: 5 },
      hooks: {
        beforeDispatch: async () => {
          // the approver never answers in time; the run is stopped while the hook waits, then the hook lets the call through
          ac.abort();
          return undefined;
        },
      },
    });

    expect(r.cancelled).toBe(true);
    expect(dispatched).toEqual([]);
    const rows = messages.filter((m): m is OpenAiToolRow => m.role === "tool");
    expect(rows.map((m) => m.tool_call_id)).toEqual(["c1", "c2"]);
    for (const row of rows) expect(JSON.parse(String(row.content))).toMatchObject({ ok: false, aborted: true });
  });

  it("without a stop the same hook lets the call dispatch as before", async () => {
    const dispatched: string[] = [];
    let turn = 0;
    const ports: LoopPorts<Row> = {
      async complete() {
        return turn++ === 0 ? { content: "", toolCalls: [call("c1", "exec")] } : { content: "done", toolCalls: [] };
      },
      async dispatch(c) {
        dispatched.push(c.name);
        return { data: { ok: true } };
      },
    };
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "go" }],
      codec: openAiChatCodec<Row>(),
      ports,
      budget: { stepCap: 5 },
      hooks: { beforeDispatch: async () => undefined },
    });

    expect(r.finished).toBe(true);
    expect(dispatched).toEqual(["exec"]);
  });
});
