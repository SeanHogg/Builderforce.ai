import { describe, expect, it } from "vitest";
import { openAiChatCodec, readOpenAiToolCalls, toOpenAiToolCall } from "./openaiCodec.js";
import { parseToolArgs } from "./parseToolCall.js";

describe("readOpenAiToolCalls", () => {
  it("reads string and object arguments and synthesises missing ids", () => {
    const calls = readOpenAiToolCalls({
      tool_calls: [
        { id: "x", function: { name: "read", arguments: '{"p":1}' } },
        { function: { name: "write", arguments: { p: 2 } } },
        { id: "", function: { name: "" } },
        null,
      ],
    });
    expect(calls).toEqual([
      { id: "x", name: "read", arguments: '{"p":1}' },
      { id: "call_1", name: "write", arguments: '{"p":2}' },
    ]);
  });

  it("returns [] for a message without tool calls", () => {
    expect(readOpenAiToolCalls({ content: "hi" })).toEqual([]);
    expect(readOpenAiToolCalls(null)).toEqual([]);
  });
});

describe("toOpenAiToolCall", () => {
  it("defaults empty arguments to {} so providers that validate JSON accept the row", () => {
    expect(toOpenAiToolCall({ id: "a", name: "n", arguments: "" })).toEqual({ id: "a", type: "function", function: { name: "n", arguments: "{}" } });
  });
});

describe("parseToolArgs", () => {
  it("parses objects, rejects arrays/primitives as malformed, treats empty as {}", () => {
    expect(parseToolArgs('{"a":1}')).toEqual({ args: { a: 1 }, malformed: false });
    expect(parseToolArgs("[1]")).toEqual({ args: {}, malformed: true });
    expect(parseToolArgs("42")).toEqual({ args: {}, malformed: true });
    expect(parseToolArgs("{oops")).toEqual({ args: {}, malformed: true });
    expect(parseToolArgs("")).toEqual({ args: {}, malformed: false });
    expect(parseToolArgs(undefined)).toEqual({ args: {}, malformed: false });
  });
});

describe("openAiChatCodec tool rows", () => {
  const call = { id: "c1", name: "tasks.list", args: {}, raw: { id: "c1", name: "tasks.list", arguments: "{}" }, malformed: false };

  it("defaults to plain JSON (today's behaviour)", () => {
    const row = openAiChatCodec().tool(call, { data: { a: 1 } }) as { content: string };
    expect(row.content).toBe('{"a":1}');
  });

  it("keeps the long-standing serializer argument", () => {
    const row = openAiChatCodec((r) => `len=${JSON.stringify(r.data).length}`).tool(call, { data: [1] }) as { content: string };
    expect(row.content).toBe("len=3");
  });

  it("applies a toolResultPolicy with the tool name when opted in", () => {
    const seen: string[] = [];
    const codec = openAiChatCodec({ toolResultPolicy: (name, data) => { seen.push(name); return `[${name}] ${JSON.stringify(data)}`; } });
    const row = codec.tool(call, { data: undefined }) as { role: string; tool_call_id: string; content: string };
    expect(row).toEqual({ role: "tool", tool_call_id: "c1", content: "[tasks.list] null" });
    expect(seen).toEqual(["tasks.list"]);
  });

  it("an explicit serialize wins over the policy", () => {
    const row = openAiChatCodec({ serialize: () => "s", toolResultPolicy: () => "p" }).tool(call, { data: 1 }) as { content: string };
    expect(row.content).toBe("s");
  });
});
