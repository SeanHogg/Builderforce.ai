import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import type { AgentEvent, AgentTool } from "../model/agent-types.js";
import type { AssistantMessage, ToolCall } from "../model/types.js";
import { Agent } from "./agent-loop.js";
import { AssistantMessageEventStream } from "./event-stream.js";
import type { StreamFn } from "./stream.js";

const model = {
  id: "m",
  name: "m",
  api: "openai-completions" as const,
  provider: "p",
  baseUrl: "",
  reasoning: false,
  input: ["text"] as ("text" | "image")[],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1000,
  maxTokens: 1000,
};

function assistant(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"],
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "p",
    model: "m",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: 0,
  };
}

/** Scripted streamFn: returns a pre-built assistant message per call. */
function scriptedStreamFn(script: AssistantMessage[]): StreamFn {
  let call = 0;
  return () => {
    const stream = new AssistantMessageEventStream();
    const msg = script[call++] ?? assistant([{ type: "text", text: "done" }], "stop");
    queueMicrotask(() => {
      stream.push({
        type: "done",
        reason: msg.stopReason === "toolUse" ? "toolUse" : "stop",
        message: msg,
      });
      stream.end();
    });
    return stream;
  };
}

describe("native Agent loop", () => {
  it("streams a turn, executes a tool call, feeds the result back, and finishes", async () => {
    const calls: string[] = [];
    const echoTool: AgentTool = {
      name: "echo",
      label: "echo",
      description: "echoes",
      parameters: Type.Object({ text: Type.String() }),
      execute: async (_id, params) => {
        const { text } = params as { text: string };
        calls.push(text);
        return { content: [{ type: "text", text: `echoed:${text}` }], details: {} };
      },
    };

    const toolCall: ToolCall = {
      type: "toolCall",
      id: "tc1",
      name: "echo",
      arguments: { text: "hi" },
    };
    const streamFn = scriptedStreamFn([
      assistant([toolCall], "toolUse"), // turn 1: call the tool
      assistant([{ type: "text", text: "all done" }], "stop"), // turn 2: finish
    ]);

    const agent = new Agent({ model, tools: [echoTool], systemPrompt: "sys" });
    agent.streamFn = streamFn;

    const events: AgentEvent[] = [];
    agent.subscribe((e) => events.push(e));

    const produced = await agent.prompt([{ role: "user", content: "go", timestamp: 0 }]);

    // the tool ran with the model-provided args
    expect(calls).toEqual(["hi"]);
    // a tool result message was produced and fed back
    const toolResults = produced.filter((m) => m.role === "toolResult");
    expect(toolResults).toHaveLength(1);
    expect((toolResults[0] as { content: { text: string }[] }).content[0].text).toBe("echoed:hi");
    // loop terminated on the second (text) assistant turn
    const finalAssistant = produced
      .filter((m) => m.role === "assistant")
      .at(-1) as AssistantMessage;
    expect((finalAssistant.content[0] as { text: string }).text).toBe("all done");
    // lifecycle events emitted
    expect(events.some((e) => e.type === "agent_start")).toBe(true);
    expect(events.some((e) => e.type === "tool_execution_end")).toBe(true);
    expect(events.some((e) => e.type === "agent_end")).toBe(true);
    expect(agent.isStreaming).toBe(false);
  });

  it("stops immediately when the first turn has no tool calls", async () => {
    const streamFn = scriptedStreamFn([assistant([{ type: "text", text: "hello" }], "stop")]);
    const agent = new Agent({ model });
    agent.streamFn = streamFn;
    const produced = await agent.prompt([{ role: "user", content: "hi", timestamp: 0 }]);
    expect(produced.filter((m) => m.role === "assistant")).toHaveLength(1);
    expect(produced.filter((m) => m.role === "toolResult")).toHaveLength(0);
  });
});
