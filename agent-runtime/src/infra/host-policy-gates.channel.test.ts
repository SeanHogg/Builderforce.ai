/**
 * End to end for a CHANNEL run: the tenant's `block` gate, fetched through the host's real
 * link and parsed by the real `coercePolicyGates`, withholds the tool from the agent a
 * channel message is served by, and a model that asks for it anyway is refused.
 *
 * The seam itself (`runEmbeddedAgent` feeding `resolveHostPolicyGates()` to the session's
 * `policyGates`) is covered in `agents/embedded-runner/run.policy-gates.test.ts`; this
 * proves the other half, that what the seam is handed is enforced by the channel loop.
 */
import { Type } from "@sinclair/typebox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Agent } from "../builderforce/agent-loop/agent.js";
import { AssistantMessageEventStream } from "../builderforce/agent-loop/event-stream.js";
import type { StreamFn } from "../builderforce/agent-loop/stream.js";
import type { AgentMessage, AgentTool } from "../builderforce/model/agent-types.js";
import type { AssistantMessage, Context } from "../builderforce/model/types.js";
import { approvalGate } from "./approval-gate.js";
import { resetHostPolicyGates, resolveHostPolicyGates } from "./host-policy-gates.js";

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

/** A channel message served by the agent, holding whatever gates the seam resolved. */
async function serveChannelMessage(ran: string[]) {
  const gates = await resolveHostPolicyGates();
  const exec: AgentTool = {
    name: "exec",
    label: "exec",
    description: "runs a shell command",
    parameters: Type.Object({}),
    execute: async () => {
      ran.push("exec");
      return { content: [{ type: "text", text: "ran" }], details: {} };
    },
  };
  const seen: Context[] = [];
  const agent = new Agent({ model, systemPrompt: "sys", tools: [exec], policyGates: gates });
  agent.streamFn = scripted(
    [assistant([{ type: "toolCall", id: "c1", name: "exec", arguments: {} }], "toolUse"), assistant([{ type: "text", text: "fin" }])],
    seen,
  );
  const produced = await agent.prompt([user("run the build")]);
  return { gates, seen, produced };
}

describe("a tenant block gate on a channel run", () => {
  beforeEach(() => resetHostPolicyGates());
  afterEach(() => {
    (approvalGate as unknown as { baseUrl: string | null }).baseUrl = null;
    vi.unstubAllGlobals();
  });

  it("withholds the tool and refuses a call to it, naming the gate", async () => {
    approvalGate.init({ baseUrl: "https://bf.test", agentNodeId: "7", apiKey: "bfk_k" });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ gates: [{ id: "no-shell", tool: "exec", effect: "block", reason: "shell is off for this tenant" }] }),
    })));
    const ran: string[] = [];

    const { gates, seen, produced } = await serveChannelMessage(ran);

    expect(gates.map((g) => g.id)).toEqual(["no-shell"]);
    // withheld: the model was never offered it
    expect((seen[0]!.tools ?? []).map((t) => t.name)).not.toContain("exec");
    // and the call it makes anyway never reaches the tool
    expect(ran).toEqual([]);
    const result = produced.find((m) => m.role === "toolResult") as unknown as { isError?: boolean };
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("no-shell");
  });

  it("control: the same message on a host with no gates runs the tool", async () => {
    // not linked: no call, no gates
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const ran: string[] = [];

    const { gates, seen } = await serveChannelMessage(ran);

    expect(gates).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((seen[0]!.tools ?? []).map((t) => t.name)).toContain("exec");
    expect(ran).toEqual(["exec"]);
  });
});
