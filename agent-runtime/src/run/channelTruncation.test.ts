/**
 * A reply the output limit cut short is never run as if it were whole, the ask for a reply never exceeds what the model can write,
 * and a custom row is measured as what the model is sent.
 */

import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";
import { Agent } from "../builderforce/agent-loop/agent.js";
import { defaultConvertToLlm } from "../builderforce/agent-loop/convert-to-llm.js";
import { AssistantMessageEventStream } from "../builderforce/agent-loop/event-stream.js";
import type { StreamFn } from "../builderforce/agent-loop/stream.js";
import type { AgentMessage, AgentTool } from "../builderforce/model/agent-types.js";
import type { AssistantMessage, Context, SimpleStreamOptions } from "../builderforce/model/types.js";
import { toRunRow } from "./channelMessages.js";
import type { AgentLoopConfig } from "../builderforce/agent-loop/agent-loop-config.js";
import { AgentEventBridge } from "./agentEventBridge.js";
import { ChannelModels, channelModelTransport, replyBound } from "./channelModel.js";

const model = {
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
const assistant = (content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage => ({ role: "assistant", content, api: "openai-completions", provider: "p", model: "m", usage, stopReason, timestamp: 1 });
const user = (content: string): AgentMessage => ({ role: "user", content, timestamp: 0 });
const textOf = (m: unknown): string => {
  const c = (m as { content?: unknown })?.content;
  return typeof c === "string" ? c : Array.isArray(c) ? c.map((b: { text?: string }) => b.text ?? "").join("") : "";
};

/** A stream that answers with these messages in turn, and records what it was asked. */
function scripted(script: AssistantMessage[], seen: Context[] = [], options: SimpleStreamOptions[] = []): StreamFn {
  let n = 0;
  return (_m, context, opts) => {
    seen.push({ ...context, messages: [...context.messages] });
    options.push({ ...opts });
    const stream = new AssistantMessageEventStream();
    const msg = script[n++] ?? assistant([{ type: "text", text: "done" }]);
    queueMicrotask(() => {
      stream.push({ type: "done", reason: msg.stopReason === "toolUse" ? "toolUse" : msg.stopReason === "length" ? "length" : "stop", message: msg });
      stream.end();
    });
    return stream;
  };
}

const tool = (name: string, execute: AgentTool["execute"]): AgentTool => ({ name, label: name, description: name, parameters: Type.Object({}), execute });

describe("a reply cut off by the output limit", () => {
  it("a tool call cut off mid-argument is declined as cut off, and the tool does not run", async () => {
    const execute = vi.fn(async () => ({ content: [{ type: "text" as const, text: "wrote it" }], details: {} }));
    const seen: Context[] = [];
    const cut = assistant([{ type: "toolCall", id: "c1", name: "write_file", arguments: {}, rawArguments: '{"path": "a.ts", "content": "const x' }], "length");
    const agent = new Agent({ model, systemPrompt: "sys", tools: [tool("write_file", execute)] });
    agent.streamFn = scripted([cut, assistant([{ type: "text", text: "I will write it in parts." }])], seen);

    await agent.prompt([user("write a.ts")]);

    expect(execute).not.toHaveBeenCalled();
    const answer = seen[1]!.messages.find((m) => m.role === "toolResult");
    expect(textOf(answer)).toContain("cut off by the output limit");
    expect(textOf(answer)).toContain("NOT executed");
  });

  it("a tool call whose arguments are garbled but whose reply finished is declined as garbled, not run with none", async () => {
    const execute = vi.fn(async () => ({ content: [{ type: "text" as const, text: "wrote it" }], details: {} }));
    const seen: Context[] = [];
    const garbled = assistant([{ type: "toolCall", id: "c1", name: "write_file", arguments: {}, rawArguments: "{path: a.ts}" }], "toolUse");
    const agent = new Agent({ model, systemPrompt: "sys", tools: [tool("write_file", execute)] });
    agent.streamFn = scripted([garbled, assistant([{ type: "text", text: "retrying" }])], seen);

    await agent.prompt([user("write a.ts")]);

    expect(execute).not.toHaveBeenCalled();
    expect(textOf(seen[1]!.messages.find((m) => m.role === "toolResult"))).toContain("not valid JSON");
  });

  it("a complete tool call in an ordinary reply still runs", async () => {
    const execute = vi.fn(async () => ({ content: [{ type: "text" as const, text: "wrote it" }], details: {} }));
    const agent = new Agent({ model, systemPrompt: "sys", tools: [tool("write_file", execute)] });
    agent.streamFn = scripted([assistant([{ type: "toolCall", id: "c1", name: "write_file", arguments: {} }], "toolUse")]);

    await agent.prompt([user("write a.ts")]);

    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("a text reply cut off by the output limit", () => {
  const transport = (reply: AssistantMessage) => {
    const config = { model, convertToLlm: defaultConvertToLlm } as unknown as AgentLoopConfig;
    const bridge = new AgentEventBridge({ activeModel: () => model, onSwap: () => undefined });
    return channelModelTransport({ models: new ChannelModels(model), streamFn: scripted([reply]), config, tools: [], bridge });
  };
  const ask = { messages: [{ role: "user" as const, content: "where is the handler?" }] };

  it("reaches the agent as truncated", async () => {
    const completion = await transport(assistant([{ type: "text", text: "The handler is in" }], "length")).complete(ask);
    expect(completion).toMatchObject({ content: "The handler is in", interrupted: "truncated" });
  });

  it("a reply that finished is not", async () => {
    const completion = await transport(assistant([{ type: "text", text: "In agent-loop.ts." }])).complete(ask);
    expect(completion.interrupted).toBeUndefined();
  });
});

describe("the row of a cut-off call keeps what the model wrote", () => {
  it("the agent's row carries the raw arguments, so the kernel parses them and finds them unusable", () => {
    const cut = assistant([{ type: "toolCall", id: "c1", name: "write_file", arguments: {}, rawArguments: '{"path": "a' }], "length");
    expect(toRunRow(cut).toolCalls).toEqual([{ id: "c1", name: "write_file", arguments: '{"path": "a' }]);
  });

  it("a call that parsed is written as its parsed arguments", () => {
    const whole = assistant([{ type: "toolCall", id: "c1", name: "read_file", arguments: { path: "a.ts" } }], "toolUse");
    expect(toRunRow(whole).toolCalls).toEqual([{ id: "c1", name: "read_file", arguments: '{"path":"a.ts"}' }]);
  });
});

describe("the ask for a reply is bounded by what the model can write", () => {
  it("a 64K window asks 16,000 and a model that can write 8,000 is sent 8,000", async () => {
    const options: SimpleStreamOptions[] = [];
    const agent = new Agent({ model: { ...model, contextWindow: 64_000, maxTokens: 8_000 }, systemPrompt: "sys" });
    agent.streamFn = scripted([assistant([{ type: "text", text: "ok" }])], [], options);

    await agent.prompt([user("hi")]);

    expect(options[0]!.maxTokens).toBe(8_000);
  });

  it("a model that can write more than the window holds back is sent the window's ask", async () => {
    const options: SimpleStreamOptions[] = [];
    const agent = new Agent({ model: { ...model, contextWindow: 16_384, maxTokens: 8_192 }, systemPrompt: "sys" });
    agent.streamFn = scripted([assistant([{ type: "text", text: "ok" }])], [], options);

    await agent.prompt([user("hi")]);

    expect(options[0]!.maxTokens).toBe(4_096);
  });

  it("a big window asks for no cap of its own, as before", async () => {
    const options: SimpleStreamOptions[] = [];
    const agent = new Agent({ model, systemPrompt: "sys" });
    agent.streamFn = scripted([assistant([{ type: "text", text: "ok" }])], [], options);

    await agent.prompt([user("hi")]);

    expect(options[0]!.maxTokens).toBeUndefined();
  });

  it("a model that declares no output cap leaves the ask as it is", () => {
    expect(replyBound(16_000, { ...model, maxTokens: 0 })).toBe(16_000);
    expect(replyBound(16_000, { ...model, maxTokens: 8_000 })).toBe(8_000);
    expect(replyBound(4_096, { ...model, maxTokens: 8_000 })).toBe(4_096);
  });
});

describe("a bash row is measured as what the model is sent", () => {
  const bash: AgentMessage = { role: "bashExecution", command: "npm run build", output: "o".repeat(40_000), exitCode: 0, cancelled: false, truncated: false, timestamp: 3 };

  it("its text is the command then its whole output, the same text convertToLlm sends", () => {
    const row = toRunRow(bash);
    const sent = defaultConvertToLlm([bash])[0]!;

    expect(row.custom).toBe(true);
    expect(row.content).toBe(sent.content);
    expect(row.content.length).toBeGreaterThan(40_000);
  });

  it("a command the person kept out of the model's context costs nothing", () => {
    expect(toRunRow({ ...(bash as object), excludeFromContext: true } as AgentMessage).content).toBe("");
    expect(defaultConvertToLlm([{ ...(bash as object), excludeFromContext: true } as AgentMessage])).toEqual([]);
  });
});
