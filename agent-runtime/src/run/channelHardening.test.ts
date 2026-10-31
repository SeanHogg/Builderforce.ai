/**
 * What a channel run must NOT do that the runner's own loop never did: cut history at the cloud's cost cap, cut a result to a
 * fixed table, force an extra turn after a tripped breaker, swallow a failure, lose a steer to a stall, let a governance gate
 * pass when no approver can be reached, or leave a foreground command running when the person steers.
 */

import { Type } from "@sinclair/typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Agent } from "../builderforce/agent-loop/agent.js";
import { AssistantMessageEventStream } from "../builderforce/agent-loop/event-stream.js";
import type { StreamFn } from "../builderforce/agent-loop/stream.js";
import type { AgentMessage, AgentTool } from "../builderforce/model/agent-types.js";
import type { AssistantMessage, Context } from "../builderforce/model/types.js";
import { ApprovalGate, approvalGate } from "../infra/approval-gate.js";

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
const callOf = (name: string, id = "c1"): AssistantMessage => assistant([{ type: "toolCall", id, name, arguments: {} }], "toolUse");
const user = (content: string): AgentMessage => ({ role: "user", content, timestamp: 0 });
const textOf = (m: unknown): string => {
  const c = (m as { content?: unknown })?.content;
  return typeof c === "string" ? c : Array.isArray(c) ? c.map((b: { text?: string }) => b.text ?? "").join("") : "";
};

function scripted(script: AssistantMessage[], seen: Context[] = []): StreamFn {
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

const tool = (name: string, execute: AgentTool["execute"]): AgentTool => ({ name, label: name, description: name, parameters: Type.Object({}), execute });
const ok = async () => ({ content: [{ type: "text" as const, text: "ok" }], details: {} });

describe("history and results are bounded by the model's window, not the cloud's cost cap", () => {
  it("a conversation of ~50K tokens in a 200K window reaches the model whole", async () => {
    const seen: Context[] = [];
    const agent = new Agent({ model, systemPrompt: "sys" });
    agent.replaceMessages(Array.from({ length: 50 }, (_, i) => user(`turn ${i} ${"x".repeat(4_000)}`)));
    agent.streamFn = scripted([assistant([{ type: "text", text: "ok" }])], seen);

    await agent.prompt([user("and now?")]);

    expect(seen).toHaveLength(1);
    expect(seen[0]!.messages).toHaveLength(51);
  });

  it("a 20K-char result is handed to the model whole, not cut to a fixed table row", async () => {
    const seen: Context[] = [];
    const big = "y".repeat(20_000);
    const agent = new Agent({ model, systemPrompt: "sys", tools: [tool("read", async () => ({ content: [{ type: "text", text: big }], details: {} }))] });
    agent.streamFn = scripted([callOf("read"), assistant([{ type: "text", text: "fin" }])], seen);

    await agent.prompt([user("go")]);

    const result = seen[1]!.messages.find((m) => m.role === "toolResult");
    expect(textOf(result)).toHaveLength(20_000);
  });
});

describe("a tripped breaker", () => {
  it("ends the run on its last result: no forced extra turn, and nothing told twice", async () => {
    const seen: Context[] = [];
    const agent = new Agent({ model, systemPrompt: "sys", tools: [tool("flaky", async () => { throw new Error("nope"); })] });
    agent.streamFn = scripted(Array.from({ length: 12 }, (_, i) => callOf("flaky", `c${i}`)), seen);
    const ended: string[] = [];
    agent.subscribe((e) => { if (e.type === "message_end") ended.push(e.message.role); });

    const produced = await agent.prompt([user("go")]);

    expect(seen).toHaveLength(5);
    expect(produced.some((m) => m.role === "user" && textOf(m).includes("Now write your reply"))).toBe(false);
    expect(produced.at(-1)!.role).toBe("toolResult");
    expect(ended.filter((r) => r === "assistant")).toHaveLength(5);
  });
});

describe("a failure with no model turn behind it", () => {
  it("reaches the runner as the errored assistant message it reads, when the provider stream throws", async () => {
    const agent = new Agent({ model, systemPrompt: "sys" });
    agent.streamFn = () => { throw new Error("socket hang up"); };

    const produced = await agent.prompt([user("go")]);

    const last = produced.at(-1) as AssistantMessage;
    expect(last.role).toBe("assistant");
    expect(last.stopReason).toBe("error");
    expect(last.errorMessage).toContain("socket hang up");
  });

  it("and when the context transform throws", async () => {
    const agent = new Agent({ model, systemPrompt: "sys", transformContext: () => { throw new Error("bad history"); } });
    agent.streamFn = scripted([]);

    const produced = await agent.prompt([user("go")]);

    expect((produced.at(-1) as AssistantMessage).stopReason).toBe("error");
    expect((produced.at(-1) as AssistantMessage).errorMessage).toContain("bad history");
  });
});

describe("a steer during a narrating turn", () => {
  it("is taken, not lost to the stall: no re-prompt is spent and the model reads it next", async () => {
    const seen: Context[] = [];
    const agent = new Agent({ model, systemPrompt: "sys", tools: [tool("read", ok)] });
    const narrate = assistant([{ type: "text", text: "Let me search for that now." }]);
    let n = 0;
    agent.streamFn = (_m, context) => {
      seen.push({ ...context, messages: [...context.messages] });
      const stream = new AssistantMessageEventStream();
      const msg = n++ === 0 ? narrate : assistant([{ type: "text", text: "Looking at b.ts." }]);
      // the person types while the first turn is being written
      if (n === 1) agent.steer(user("look at b.ts instead"));
      queueMicrotask(() => { stream.push({ type: "done", reason: "stop", message: msg }); stream.end(); });
      return stream;
    };

    const produced = await agent.prompt([user("go")]);

    expect(seen).toHaveLength(2);
    expect(seen[1]!.messages.some((m) => textOf(m).includes("look at b.ts instead"))).toBe(true);
    expect(produced.some((m) => m.role === "user" && textOf(m).includes("made zero tool calls"))).toBe(false);
  });
});

describe("a governance gate with no approver to reach", () => {
  const gates = [{ id: "ask-first", effect: "require-approval" as const, tool: "danger", reason: "needs a person" }];
  afterEach(() => {
    // the process-wide gate goes back to unconfigured
    (approvalGate as unknown as { baseUrl: string | null }).baseUrl = null;
    vi.unstubAllGlobals();
  });

  async function runDanger(): Promise<{ ran: number; result: { isError: boolean } }> {
    let ran = 0;
    const agent = new Agent({ model, systemPrompt: "sys", policyGates: gates, tools: [tool("danger", async () => { ran += 1; return { content: [{ type: "text", text: "did it" }], details: {} }; })] });
    agent.streamFn = scripted([callOf("danger"), assistant([{ type: "text", text: "fin" }])]);
    const produced = await agent.prompt([user("go")]);
    return { ran, result: produced.find((m) => m.role === "toolResult") as unknown as { isError: boolean } };
  }

  it("refuses the call when the gate is not configured", async () => {
    const out = await runDanger();
    expect(out.ran).toBe(0);
    expect(out.result.isError).toBe(true);
  });

  it("refuses the call when the approval request fails", async () => {
    approvalGate.init({ baseUrl: "https://bf.test", agentNodeId: "n1", apiKey: "k" });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));
    const out = await runDanger();
    expect(out.ran).toBe(0);
    expect(out.result.isError).toBe(true);
  });

  it("the gate itself: fails closed on request, keeps its standalone default otherwise", async () => {
    const gate = new ApprovalGate();
    expect((await gate.request({ actionType: "a", description: "d", failClosed: true })).decision).toBe("rejected");
    expect((await gate.request({ actionType: "a", description: "d" })).decision).toBe("approved");
    gate.init({ baseUrl: "https://bf.test", agentNodeId: "n1", apiKey: "k" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect((await gate.request({ actionType: "a", description: "d", failClosed: true })).decision).toBe("rejected");
    expect((await gate.request({ actionType: "a", description: "d" })).decision).toBe("approved");
  });
});

describe("a steer while a foreground command runs", () => {
  it("aborts the command through its signal, and the model reads the steer next", async () => {
    const seen: Context[] = [];
    let abortedAt: number | undefined;
    const agent = new Agent({
      model,
      systemPrompt: "sys",
      tools: [
        tool("exec", (_id, _params, signal) =>
          new Promise((resolve) => {
            setTimeout(() => agent.steer(user("stop that, do this")), 5);
            signal?.addEventListener("abort", () => {
              abortedAt = Date.now();
              resolve({ content: [{ type: "text", text: "killed" }], details: {} });
            });
          }),
        ),
      ],
    });
    agent.streamFn = scripted([callOf("exec"), assistant([{ type: "text", text: "fin" }])], seen);

    await agent.prompt([user("go")]);

    expect(abortedAt).toBeDefined();
    expect(seen[1]!.messages.some((m) => textOf(m).includes("stop that, do this"))).toBe(true);
  });
});
