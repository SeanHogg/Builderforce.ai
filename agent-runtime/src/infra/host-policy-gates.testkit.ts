/**
 * Test kit for the governance-gate tests that drive a CHANNEL run: a scripted model, a tool that records whether it ran, and the
 * Agent (the channel entry point) held to a set of gates.
 */
import { Type } from "@sinclair/typebox";
import type { PolicyGate } from "@builderforce/agent-tools";
import { Agent } from "../builderforce/agent-loop/agent.js";
import { AssistantMessageEventStream } from "../builderforce/agent-loop/event-stream.js";
import type { StreamFn } from "../builderforce/agent-loop/stream.js";
import type { AgentMessage, AgentTool } from "../builderforce/model/agent-types.js";
import type { AssistantMessage, Context } from "../builderforce/model/types.js";

export const model = {
  id: "m",
  name: "m",
  api: "openai-completions" as const,
  provider: "p",
  baseUrl: "",
  reasoning: false,
  input: ["text"] as ("text" | "image")[],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 4_096,
};
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

export const assistant = (content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage => ({
  role: "assistant",
  content,
  api: "openai-completions",
  provider: "p",
  model: "m",
  usage,
  stopReason,
  timestamp: 1,
});
export const user = (content: string): AgentMessage => ({ role: "user", content, timestamp: 0 });
export const textOf = (m: unknown): string => {
  const c = (m as { content?: unknown })?.content;
  return typeof c === "string" ? c : Array.isArray(c) ? c.map((b: { text?: string }) => b.text ?? "").join("") : "";
};

export function scripted(script: AssistantMessage[], seen: Context[]): StreamFn {
  let n = 0;
  return (_m, context) => {
    seen.push({ ...context, messages: [...context.messages] });
    const stream = new AssistantMessageEventStream();
    const msg = script[n++] ?? assistant([{ type: "text", text: "done" }]);
    queueMicrotask(() => {
      stream.push({ type: "done", reason: msg.stopReason === "toolUse" ? "toolUse" : "stop", message: msg });
      stream.end();
    });
    return stream;
  };
}

/** An `exec` tool that records that it ran. */
export function execTool(ran: string[]): AgentTool {
  return {
    name: "exec",
    label: "exec",
    description: "runs a shell command",
    parameters: Type.Object({}),
    execute: async () => {
      ran.push("exec");
      return { content: [{ type: "text", text: "ran" }], details: {} };
    },
  };
}

/** The agent a channel message is served by: the model asks for `exec`, then replies. Hand it whatever gates the host resolved. */
export function channelAgent(gates: readonly PolicyGate[], ran: string[]) {
  const seen: Context[] = [];
  const agent = new Agent({ model, systemPrompt: "sys", tools: [execTool(ran)], policyGates: gates });
  agent.streamFn = scripted(
    [assistant([{ type: "toolCall", id: "c1", name: "exec", arguments: {} }], "toolUse"), assistant([{ type: "text", text: "fin" }])],
    seen,
  );
  return { agent, seen };
}
