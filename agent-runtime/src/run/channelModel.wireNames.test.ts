import { Type } from "@sinclair/typebox";
import { expect, it, vi } from "vitest";
import { toToolDefinitions } from "../agents/tool-definition-adapter.js";
import { Agent } from "../builderforce/agent-loop/agent.js";
import { createAgentSession } from "../builderforce/agent-loop/agent-session.js";
import { AssistantMessageEventStream } from "../builderforce/agent-loop/event-stream.js";
import { SessionManager } from "../builderforce/agent-loop/session-manager.js";
import type { AgentTool } from "../builderforce/model/agent-types.js";
import type { AssistantMessage, Context, Model } from "../builderforce/model/types.js";

const model: Model = {
  id: "fixture", name: "fixture", api: "openai-completions", provider: "fixture", baseUrl: "",
  reasoning: false, input: ["text"], contextWindow: 100_000, maxTokens: 1000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const wireName = "workspace__memory_read";
const parameters = Type.Object({ path: Type.Optional(Type.String()), ref: Type.Optional(Type.String()) });
const wireParameters = Type.Object({ ref: Type.String() });
const usage = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistant(content: AssistantMessage["content"], stopReason: "stop" | "toolUse") {
  const message: AssistantMessage = {
    role: "assistant", api: model.api, provider: model.provider, model: model.id, usage, timestamp: 1,
    content, stopReason,
  };
  const stream = new AssistantMessageEventStream();
  stream.push({ type: "done", reason: stopReason, message });
  stream.end();
  return stream;
}

it.each([
  [wireName, { ref: "chunk-ref" }],
  ["memory_get", { path: "memory/notes.md" }],
] as const)("advertises the workspace schema and resolves %s to its stable headless tool", async (name, args) => {
  const execute = vi.fn<AgentTool["execute"]>(async () => ({
    content: [{ type: "text", text: "retrieved" }], details: {},
  }));
  const tool: AgentTool = {
    name: "memory_get", wireName, label: "Memory Get",
    description: "Read workspace memory", parameters, wireParameters, execute,
  };
  const definitions = toToolDefinitions([tool]);
  expect(definitions[0]).toMatchObject({ name: "memory_get", wireName, wireParameters });

  const seen: Context[] = [];
  const agent = new Agent({ model, tools: definitions, systemPrompt: "Use memory_get for memory." });
  agent.streamFn = (_model, context) => {
    seen.push(context);
    return seen.length === 1
      ? assistant([{ type: "toolCall", id: "read-1", name, arguments: args }], "toolUse")
      : assistant([{ type: "text", text: "All done." }], "stop");
  };
  const produced = await agent.prompt([{ role: "user", content: "Read my earlier note.", timestamp: 0 }]);
  expect(seen[0]?.tools?.[0]).toMatchObject({ name: wireName, parameters: wireParameters });
  expect(seen[0]?.systemPrompt).toBe("Use workspace__memory_read for memory.");
  expect(seen[1]?.messages).toEqual(expect.arrayContaining([
    expect.objectContaining({ role: "assistant", content: [expect.objectContaining({ name: wireName })] }),
    expect.objectContaining({ role: "toolResult", toolName: wireName }),
  ]));
  expect(execute).toHaveBeenCalledTimes(1);
  expect(execute.mock.calls[0]?.[1]).toEqual(args);
  expect(produced).toEqual(expect.arrayContaining([
    expect.objectContaining({ role: "assistant", content: [expect.objectContaining({ name: "memory_get" })] }),
    expect.objectContaining({ role: "toolResult", toolName: "memory_get" }),
  ]));
});

it("withholds the canonical advertisement and denies a canonical call under the original policy ID", async () => {
  const execute = vi.fn<AgentTool["execute"]>(async () => ({ content: [], details: {} }));
  const { session } = await createAgentSession({
    model,
    systemPrompt: "Read workspace memory.",
    tools: [{ name: "memory_get", wireName, label: "Memory Get", description: "Read memory", parameters, execute }],
    sessionManager: SessionManager.inMemory(),
    policyGates: [{ id: "no-memory", tool: "memory_get", effect: "block", reason: "Workspace memory is disabled." }],
  });
  const seen: Context[] = [];
  session.agent.streamFn = (_model, context) => {
    seen.push(context);
    return seen.length === 1
      ? assistant([{ type: "toolCall", id: "denied", name: wireName, arguments: { ref: "chunk-ref" } }], "toolUse")
      : assistant([{ type: "text", text: "All done." }], "stop");
  };
  await session.prompt("Read");
  expect(seen[0]?.tools?.map(({ name }) => name) ?? []).not.toContain(wireName);
  expect(execute).not.toHaveBeenCalled();
  expect(session.messages).toEqual(expect.arrayContaining([
    expect.objectContaining({
      role: "toolResult", toolName: "memory_get", isError: true,
      content: [expect.objectContaining({ text: expect.stringContaining("no-memory") })],
    }),
  ]));
});
