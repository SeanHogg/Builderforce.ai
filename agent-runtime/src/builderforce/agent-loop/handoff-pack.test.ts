import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentMessage } from "../model/agent-types.js";
import type { AssistantMessage, Model, ToolResultMessage } from "../model/types.js";
import { packContextForModel } from "./handoff-pack.js";

const model = (id: string, contextWindow: number): Model =>
  ({ id, provider: "ollama", contextWindow, maxTokens: 1_024 }) as unknown as Model;

function call(i: number): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id: `c${i}`, name: "read_file", arguments: {} }],
    api: "openai-completions",
    provider: "ollama",
    model: "big",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
    stopReason: "toolUse",
    timestamp: 0,
  } as unknown as AssistantMessage;
}

function result(i: number): ToolResultMessage {
  return { role: "toolResult", toolCallId: `c${i}`, toolName: "read_file", content: [{ type: "text", text: "X".repeat(2_000) }], isError: false, timestamp: 0 };
}

function context(): AgentMessage[] {
  const out: AgentMessage[] = [{ role: "user", content: "Add the avatar filter.", timestamp: 0 }];
  for (let i = 0; i < 10; i++) out.push(call(i), result(i));
  return out;
}

describe("packContextForModel (stall failover hand-off)", () => {
  it("hands a context that already fits over untouched", async () => {
    const messages = context();
    const r = await packContextForModel({ messages, systemPrompt: "sys", from: model("big", 200_000), to: model("mid", 128_000) });
    expect(r.dropped).toBe(0);
    expect(r.messages).toEqual(messages);
  });

  it("packs for a smaller fallback window: directive kept, calls never split from results, one summary row", async () => {
    const messages = context();
    const r = await packContextForModel({ messages, systemPrompt: "sys", from: model("big", 200_000), to: model("small", 4_096), maxTokens: 512 });
    expect(r.dropped).toBeGreaterThan(0);
    expect(r.fits).toBe(true);
    expect(r.messages).toContain(messages[0]);
    const notes = r.messages.filter((m) => m.role === "compactionSummary");
    expect(notes).toHaveLength(1);
    expect((notes[0] as { summary: string }).summary).toContain("Handed off from ollama/big to ollama/small.");
    // Every kept tool result's call is kept before it.
    const calls = new Set<string>();
    for (const m of r.messages) {
      if (m.role === "assistant") for (const c of m.content) if (c.type === "toolCall") calls.add(c.id);
      if (m.role === "toolResult") expect(calls.has(m.toolCallId)).toBe(true);
    }
  });

  describe("long-context price tier (cost lever c9_price_tier_budget)", () => {
    afterEach(() => vi.unstubAllEnvs());
    // ~130K input tokens: inside a 1M window, past claude-haiku-5-5's 100K price boundary.
    const big = (): AgentMessage[] => {
      const out: AgentMessage[] = [{ role: "user", content: "Add the avatar filter.", timestamp: 0 }];
      for (let i = 0; i < 26; i++) {
        out.push(call(i), { ...result(i), content: [{ type: "text", text: "X".repeat(20_000) }] });
      }
      return out;
    };
    const tiered = () => ({ ...model("claude-haiku-5-5", 1_000_000), provider: "anthropic" }) as unknown as Model;

    it("packs under the lowest price boundary instead of filling the window", async () => {
      vi.stubEnv("COST_LEVER_C9_PRICE_TIER_BUDGET", "on");
      const r = await packContextForModel({ messages: big(), systemPrompt: "sys", from: model("big", 1_000_000), to: tiered() });
      expect(r.dropped).toBeGreaterThan(0);
      expect(r.fits).toBe(true);
    });

    it("fills the window as before when the lever is off", async () => {
      vi.stubEnv("COST_LEVER_C9_PRICE_TIER_BUDGET", "off");
      const r = await packContextForModel({ messages: big(), systemPrompt: "sys", from: model("big", 1_000_000), to: tiered() });
      expect(r.dropped).toBe(0);
    });
  });
});
