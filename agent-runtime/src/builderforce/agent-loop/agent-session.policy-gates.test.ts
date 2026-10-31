/**
 * The embedded runner builds its session with `createAgentSession({ policyGates })`
 * (`attempt.ts`); the session hands them to the `Agent`, which hands them to the run. This pins
 * the hop that carries a tenant's gates from the session option to the loop: a `block` gate
 * withholds the tool and refuses a call to it, and a directive gate reaches the model's prompt.
 */
import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import type { AgentTool } from "../model/agent-types.js";
import type { AssistantMessage, Context } from "../model/types.js";
import { createAgentSession } from "./agent-session.js";
import { AssistantMessageEventStream } from "./event-stream.js";
import { SessionManager } from "./session-manager.js";
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
  contextWindow: 200_000,
  maxTokens: 4_096,
};
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const assistant = (content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage => ({
  role: "assistant",
  content,
  api: "openai-completions",
  provider: "p",
  model: "m",
  usage,
  stopReason,
  timestamp: 1,
});

function scripted(script: AssistantMessage[], seen: Context[]): StreamFn {
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

async function run(policyGates: Parameters<typeof createAgentSession>[0]["policyGates"]) {
  const ran: string[] = [];
  const exec: AgentTool = {
    name: "exec",
    label: "exec",
    description: "runs a command",
    parameters: Type.Object({}),
    execute: async () => {
      ran.push("exec");
      return { content: [{ type: "text", text: "ran" }], details: {} };
    },
  };
  const seen: Context[] = [];
  const { session } = await createAgentSession({
    model,
    systemPrompt: "sys",
    tools: [exec],
    sessionManager: SessionManager.inMemory(),
    ...(policyGates ? { policyGates } : {}),
  });
  session.agent.streamFn = scripted([assistant([{ type: "toolCall", id: "c1", name: "exec", arguments: {} }], "toolUse"), assistant([{ type: "text", text: "fin" }])], seen);
  await session.prompt("run it");
  return { ran, seen, messages: session.messages };
}

describe("createAgentSession policyGates", () => {
  it("a block gate withholds the tool and refuses a call to it", async () => {
    const { ran, seen, messages } = await run([{ id: "no-shell", tool: "exec", effect: "block", reason: "shell is off" }]);

    expect((seen[0]!.tools ?? []).map((t) => t.name)).not.toContain("exec");
    expect(ran).toEqual([]);
    const refusal = messages.find((m) => m.role === "toolResult") as unknown as { isError?: boolean; content: { text: string }[] };
    expect(refusal.isError).toBe(true);
    expect(refusal.content[0]!.text).toContain("no-shell");
  });

  it("an inject-directive gate reaches the model's prompt", async () => {
    const { seen } = await run([{ id: "careful", effect: "inject-directive", directive: "Never touch production." }]);

    expect(seen[0]!.systemPrompt).toContain("Never touch production.");
  });

  it("with no gates the tool runs", async () => {
    const { ran, seen } = await run(undefined);

    expect((seen[0]!.tools ?? []).map((t) => t.name)).toContain("exec");
    expect(ran).toEqual(["exec"]);
  });
});
