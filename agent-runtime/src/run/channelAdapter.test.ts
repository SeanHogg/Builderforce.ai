/**
 * The channel conformance case (PRD 35 §3.3, WS5): the scripted task through the channel entry point (`Agent` →
 * `runChannelAgent`) asks the model the SAME things, and reaches the SAME answer, as the agent driven directly with the same
 * tools as its closed catalog; and the native shapes the session persists come back exactly as they went in.
 */

import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { runAgent } from "@builderforce/agent-run";
import type { ModelCompletion, ModelRequest, RunPolicy } from "@builderforce/agent-run";
import { Agent } from "../builderforce/agent-loop/agent.js";
import { AssistantMessageEventStream } from "../builderforce/agent-loop/event-stream.js";
import type { StreamFn } from "../builderforce/agent-loop/stream.js";
import type { AgentMessage, AgentTool } from "../builderforce/model/agent-types.js";
import type { AssistantMessage, Context, Message } from "../builderforce/model/types.js";
import { AgentEventBridge } from "./agentEventBridge.js";
import { channelTools } from "./channelTools.js";

const model = {
  id: "m",
  name: "m",
  api: "openai-completions" as const,
  provider: "p",
  baseUrl: "",
  reasoning: false,
  input: ["text"] as ("text" | "image")[],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1000,
};
const usage = { input: 7, output: 11, cacheRead: 2, cacheWrite: 0, totalTokens: 20, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

function assistant(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"]): AssistantMessage {
  return { role: "assistant", content, api: "openai-completions", provider: "p", model: "m", usage, stopReason, timestamp: 1 };
}

const echo: AgentTool = {
  name: "echo",
  label: "echo",
  description: "echoes",
  parameters: Type.Object({ text: Type.String() }),
  execute: async (_id, params) => ({ content: [{ type: "text", text: `echoed:${(params as { text: string }).text}` }], details: {} }),
};

const textOf = (c: unknown): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((b: { text?: string }) => b.text ?? "").join("") : "");

describe("the channel entry point — conformance", () => {
  it("asks the model the same things, and reaches the same answer, as the agent driven directly", async () => {
    // through the channel: the Agent over a scripted provider stream
    const seen: Context[] = [];
    const script = [assistant([{ type: "toolCall", id: "c1", name: "echo", arguments: { text: "hi" } }], "toolUse"), assistant([{ type: "text", text: "all done" }], "stop")];
    let n = 0;
    const streamFn: StreamFn = (_m, context) => {
      seen.push({ ...context, messages: [...context.messages] });
      const stream = new AssistantMessageEventStream();
      const msg = script[n++]!;
      queueMicrotask(() => {
        stream.push({ type: "done", reason: msg.stopReason === "toolUse" ? "toolUse" : "stop", message: msg });
        stream.end();
      });
      return stream;
    };
    const agent = new Agent({ model, tools: [echo], systemPrompt: "sys" });
    agent.streamFn = streamFn;
    const produced = await agent.prompt([{ role: "user", content: "go", timestamp: 0 }]);

    // directly: the same tools as the closed catalog, a scripted transport
    const requests: ModelRequest[] = [];
    const answers: ModelCompletion[] = [
      { content: "", toolCalls: [{ id: "c1", name: "echo", arguments: '{"text":"hi"}' }], model: "p/m" },
      { content: "all done", model: "p/m" },
    ];
    let k = 0;
    const policy: RunPolicy = {
      entryPoint: "on-prem",
      toolScope: "chat-work",
      role: "code",
      levers: [],
      budgets: {},
      pinnedModel: "p/m",
      inference: "hybrid",
      verify: "none",
      approvalGates: [],
      delegation: { requested: false, readsBeforeNudge: 6 },
    };
    const bridge = new AgentEventBridge({ activeModel: () => model, onSwap: () => undefined });
    const direct = await runAgent({
      task: {
        prompt: "go",
        dispatch: { source: "chat" },
        transcript: [
          { role: "system", content: "sys" },
          { role: "user", content: "go", task: true },
        ],
      },
      policy,
      ports: {
        model: { complete: async (request) => { requests.push(JSON.parse(JSON.stringify(request)) as ModelRequest); return answers[k++]!; } },
        capabilities: { capabilities: new Set() },
        store: { load: () => undefined, save: () => undefined },
        events: { emit: () => undefined },
        human: { ask: async () => ({ kind: "paused" }) },
        context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
        platform: channelTools({ tools: [echo], bridge, query: "go", window: () => 100_000 }),
      },
    });

    expect(direct).toMatchObject({ kind: "finished", output: "all done" });
    expect(seen).toHaveLength(requests.length);
    // each request carries the same conversation: the same roles, the same text, the same tool result
    const shape = (messages: ReadonlyArray<{ role: string; content?: unknown }>) => messages.filter((m) => m.role !== "system").map((m) => `${m.role}:${textOf(m.content)}`);
    expect(shape(seen[1]!.messages as Message[])).toEqual(shape(requests[1]!.messages.map((m) => ({ ...m, role: m.role === "tool" ? "toolResult" : m.role }))));
    expect(seen[0]!.systemPrompt).toBe("sys");
    expect((produced.at(-1) as AssistantMessage).content).toEqual([{ type: "text", text: "all done" }]);
  });

  it("history the session recorded reaches convertToLlm exactly as it was: signed blocks, usage, summaries, custom rows", async () => {
    const thinking = assistant([{ type: "thinking", thinking: "hmm", thinkingSignature: "sig-1" }, { type: "text", text: "earlier answer", textSignature: "sig-2" }], "stop");
    const summary: AgentMessage = { role: "compactionSummary", summary: "what happened before", tokensBefore: 1234, timestamp: 5 };
    const custom: AgentMessage = { role: "custom", customType: "note", content: "an extension's note", display: true, timestamp: 6 };
    let converted: AgentMessage[] = [];
    const agent = new Agent({
      model,
      systemPrompt: "sys",
      convertToLlm: (messages) => {
        converted = messages;
        return messages.filter((m): m is Message => m.role === "user" || m.role === "assistant" || m.role === "toolResult");
      },
    });
    agent.streamFn = () => {
      const stream = new AssistantMessageEventStream();
      queueMicrotask(() => {
        stream.push({ type: "done", reason: "stop", message: assistant([{ type: "text", text: "ok" }], "stop") });
        stream.end();
      });
      return stream;
    };
    agent.replaceMessages([summary, { role: "user", content: "earlier question", timestamp: 2 }, thinking, custom]);

    await agent.prompt([{ role: "user", content: "next", timestamp: 9 }]);

    expect(converted.find((m) => m.role === "compactionSummary")).toBe(summary);
    expect(converted.find((m) => m.role === "custom")).toBe(custom);
    const earlier = converted.find((m) => m.role === "assistant") as AssistantMessage;
    expect(earlier.content).toEqual(thinking.content);
    expect(earlier.usage).toEqual(usage);
    expect(earlier.timestamp).toBe(1);
  });
});
