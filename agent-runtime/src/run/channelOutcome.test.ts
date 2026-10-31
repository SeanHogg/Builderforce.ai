/**
 * The channel entry point writes the uniform outcome row (PRD 35 §3.3, §8.2): a run with no execution id is keyed by its own run
 * id, attributed to the model that served it, and reported once through the same reporter the ticket path uses.
 */
import { Type } from "@sinclair/typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Agent } from "../builderforce/agent-loop/agent.js";
import { AssistantMessageEventStream } from "../builderforce/agent-loop/event-stream.js";
import type { AgentTool } from "../builderforce/model/agent-types.js";
import type { AssistantMessage } from "../builderforce/model/types.js";

vi.mock("../agents/embedded-runner/learned-routing/settings.js", () => ({
  learnedRoutingOn: () => true,
  resolveGatewayLink: () => ({ base: "https://gw.test", apiKey: "k" }),
  resolveProjectId: (explicit?: number) => explicit,
}));

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
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const assistant = (content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"]): AssistantMessage => ({ role: "assistant", content, api: "openai-completions", provider: "p", model: "m", usage, stopReason, timestamp: 1 });
const echo: AgentTool = { name: "echo", label: "echo", description: "e", parameters: Type.Object({}), execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }) };

afterEach(() => vi.unstubAllGlobals());

describe("a channel run's outcome row", () => {
  it("is reported once, keyed by the run's own id, with the model that served it", async () => {
    const posts: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
      posts.push(JSON.parse(init.body) as Record<string, unknown>);
      return { ok: true, status: 200 };
    }));
    const script = [assistant([{ type: "toolCall", id: "c1", name: "echo", arguments: {} }], "toolUse"), assistant([{ type: "text", text: "done" }], "stop")];
    let n = 0;
    const agent = new Agent({ model, tools: [echo], systemPrompt: "sys" });
    agent.streamFn = () => {
      const stream = new AssistantMessageEventStream();
      const msg = script[n++]!;
      queueMicrotask(() => {
        stream.push({ type: "done", reason: msg.stopReason === "toolUse" ? "toolUse" : "stop", message: msg });
        stream.end();
      });
      return stream;
    };

    await agent.prompt([{ role: "user", content: "go", timestamp: 0 }]);
    await vi.waitFor(() => expect(posts).toHaveLength(1));

    expect(posts[0]).toMatchObject({ source: "onprem", model: "p/m", terminalStatus: "completed", steps: expect.any(Number) });
    expect(String(posts[0]!.clientRunId)).toMatch(/^onprem:.+/);
  });
});
