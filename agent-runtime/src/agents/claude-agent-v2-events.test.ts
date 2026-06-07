import { describe, expect, it } from "vitest";
import { mapSdkMessage } from "./claude-agent-v2-events.js";

describe("mapSdkMessage", () => {
  it("maps assistant text blocks to assistant_text events", () => {
    const out = mapSdkMessage({
      type: "assistant",
      message: { content: [{ type: "text", text: "Hello" }, { type: "text", text: "" }] },
    });
    expect(out).toEqual([{ kind: "assistant_text", text: "Hello" }]);
  });

  it("maps tool_use blocks to tool_use events", () => {
    const out = mapSdkMessage({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "toolu_1", name: "Edit", input: { path: "a.ts" } }] },
    });
    expect(out).toEqual([{ kind: "tool_use", toolName: "Edit", toolUseId: "toolu_1", args: { path: "a.ts" } }]);
  });

  it("maps mixed text + tool_use in order", () => {
    const out = mapSdkMessage({
      type: "assistant",
      message: { content: [{ type: "text", text: "writing" }, { type: "tool_use", id: "x", name: "Write", input: {} }] },
    });
    expect(out.map((e) => e.kind)).toEqual(["assistant_text", "tool_use"]);
  });

  it("maps a success result with usage", () => {
    const out = mapSdkMessage({
      type: "result",
      subtype: "success",
      result: "done",
      usage: { input_tokens: 100, output_tokens: 20 },
    });
    expect(out).toEqual([{ kind: "result", ok: true, text: "done", inputTokens: 100, outputTokens: 20 }]);
  });

  it("marks error results not ok (subtype or is_error)", () => {
    expect(mapSdkMessage({ type: "result", subtype: "error", result: "boom" })[0]).toMatchObject({ kind: "result", ok: false });
    expect(mapSdkMessage({ type: "result", subtype: "success", is_error: true })[0]).toMatchObject({ ok: false });
  });

  it("defaults missing usage to zero", () => {
    const out = mapSdkMessage({ type: "result", subtype: "success", result: "x" });
    expect(out[0]).toMatchObject({ inputTokens: 0, outputTokens: 0 });
  });

  it("falls back to 'unknown' tool name and empty id", () => {
    const out = mapSdkMessage({ type: "assistant", message: { content: [{ type: "tool_use", input: {} }] } });
    expect(out[0]).toEqual({ kind: "tool_use", toolName: "unknown", toolUseId: "", args: {} });
  });

  it("emits a system event for system messages", () => {
    expect(mapSdkMessage({ type: "system", subtype: "init" })).toEqual([{ kind: "system", subtype: "init" }]);
  });

  it("returns no events for unknown/malformed messages", () => {
    expect(mapSdkMessage({ type: "task_started" })).toEqual([]);
    expect(mapSdkMessage(null)).toEqual([]);
    expect(mapSdkMessage("nope")).toEqual([]);
    expect(mapSdkMessage({ type: "assistant" })).toEqual([]);
  });
});
