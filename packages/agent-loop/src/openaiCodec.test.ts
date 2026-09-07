import { describe, expect, it } from "vitest";
import { readOpenAiToolCalls, toOpenAiToolCall } from "./openaiCodec.js";
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
