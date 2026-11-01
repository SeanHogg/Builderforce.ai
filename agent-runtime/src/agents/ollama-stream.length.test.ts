import { describe, expect, it } from "vitest";
import { buildAssistantMessage } from "./ollama-stream.js";

const modelInfo = { api: "ollama", provider: "ollama", id: "qwen3:32b" };
const response = (over: { content?: string; done_reason?: string; tool_calls?: unknown[] }) => ({
  model: "qwen3:32b",
  created_at: "2026-01-01T00:00:00Z",
  message: { role: "assistant" as const, content: over.content ?? "", ...(over.tool_calls ? { tool_calls: over.tool_calls as never } : {}) },
  done: true,
  ...(over.done_reason ? { done_reason: over.done_reason } : {}),
});

describe("an Ollama reply that hit its output limit", () => {
  it("is a length stop (done_reason: length), so the run reads it as cut off", () => {
    expect(buildAssistantMessage(response({ content: "The handler is in", done_reason: "length" }), modelInfo as never).stopReason).toBe("length");
  });

  it("a reply that finished on its own is a stop, and one with tool calls a toolUse", () => {
    expect(buildAssistantMessage(response({ content: "done", done_reason: "stop" }), modelInfo as never).stopReason).toBe("stop");
    expect(buildAssistantMessage(response({ tool_calls: [{ function: { name: "bash", arguments: {} } }], done_reason: "stop" }), modelInfo as never).stopReason).toBe("toolUse");
  });
});
