/**
 * What the person said survives a run.ts re-attempt: the rows of the session are rebuilt without the agent's memory of who wrote
 * what, so the mark rides the session's own message. A stall nudge (the agent's words) never carries it.
 */

import { describe, expect, it } from "vitest";
import { Agent } from "../builderforce/agent-loop/agent.js";
import { AssistantMessageEventStream } from "../builderforce/agent-loop/event-stream.js";
import type { StreamFn } from "../builderforce/agent-loop/stream.js";
import type { AgentMessage } from "../builderforce/model/agent-types.js";
import type { AssistantMessage, Context } from "../builderforce/model/types.js";

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
const small = { ...model, id: "m2", name: "m2", contextWindow: 16_384 };
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const say = (text: string): AssistantMessage => ({ role: "assistant", content: [{ type: "text", text }], api: "openai-completions", provider: "p", model: "m", usage, stopReason: "stop", timestamp: 1 });
const user = (content: string): AgentMessage => ({ role: "user", content, timestamp: 0 });
const textOf = (m: unknown): string => {
  const c = (m as { content?: unknown })?.content;
  return typeof c === "string" ? c : Array.isArray(c) ? c.map((b: { text?: string }) => b.text ?? "").join("") : "";
};
const NARRATES = "Let me search for that now.";

function streaming(answer: (n: number, modelId: string) => AssistantMessage, seen: Context[] = [], before?: (n: number) => void): StreamFn {
  let n = 0;
  return (m, context) => {
    seen.push({ ...context, messages: [...context.messages] });
    before?.(n);
    const stream = new AssistantMessageEventStream();
    const msg = answer(n++, m.id);
    queueMicrotask(() => { stream.push({ type: "done", reason: "stop", message: msg }); stream.end(); });
    return stream;
  };
}

describe("the person's words are marked on the session's own messages", () => {
  it("a steer carries the mark, the agent's stall nudge does not, and the mark survives a rebuild of the rows", async () => {
    const agent = new Agent({ model, systemPrompt: "sys" });
    agent.streamFn = streaming((n) => (n < 2 ? say(NARRATES) : say("Done with b.ts.")), [], (n) => { if (n === 1) agent.steer(user("STEER use b.ts instead")); });

    const produced = await agent.prompt([user("find the handler")]);

    const steer = produced.find((m) => m.role === "user" && textOf(m).includes("STEER"));
    const nudge = produced.find((m) => m.role === "user" && textOf(m).includes("zero tool calls"));
    expect(steer).toMatchObject({ person: true });
    expect(nudge).toBeDefined();
    expect((nudge as { person?: true }).person).toBeUndefined();
  });

  it("a steer survives an overflow re-attempt followed by a failover; the nudge in the same place does not", async () => {
    // attempt one: the person steers in while the model narrates, and the stall nudges it
    const first = new Agent({ model, systemPrompt: "sys" });
    first.streamFn = streaming((n) => (n < 2 ? say(NARRATES) : say("Done with b.ts.")), [], (n) => { if (n === 1) first.steer(user("STEER use b.ts instead")); });
    const session = await first.prompt([user("find the handler")]);

    // attempt two: run.ts rebuilds the run from the session (long history either side of it), and the model then fails over to a small window
    const filler = (tag: string): AgentMessage[] => Array.from({ length: 30 }, (_, i) => user(`${tag} ${i} ${"x".repeat(3_000)}`));
    const seen: Context[] = [];
    const second = new Agent({ model, systemPrompt: "sys", pickFallbackModel: (tried) => (tried.includes("p/m2") ? undefined : small) });
    second.replaceMessages([...filler("early"), ...session, ...filler("late")]);
    second.streamFn = streaming((_n, id) => (id === "m2" ? say("The handler is in agent-loop.ts.") : say(NARRATES)), seen);

    await second.prompt([user("find the handler again")]);

    const incoming = seen.at(-1)!.messages.map(textOf);
    expect(incoming.some((t) => t.includes("Handed off from p/m to p/m2."))).toBe(true);
    expect(incoming).toContain("STEER use b.ts instead");
    expect(incoming.some((t) => t.includes("early 0 "))).toBe(false);
  });
});
