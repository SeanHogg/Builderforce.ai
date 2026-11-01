import { afterEach, describe, expect, it, vi } from "vitest";
import { packForModelHandoff, runRowHandoff } from "@builderforce/agent-run";
import { priceTierBoundary } from "@builderforce/model-catalog";
import type { AgentMessage } from "../model/agent-types.js";
import type { AssistantMessage, Model, ToolResultMessage } from "../model/types.js";
import { policyOf } from "../../run/channelAdapter.js";
import { toRunRow } from "../../run/channelMessages.js";
import type { AgentLoopConfig } from "./agent-loop-config.js";

const model = (id: string, contextWindow: number): Model =>
  ({ id, provider: "ollama", contextWindow, maxTokens: 1_024 }) as unknown as Model;

/**
 * The production hand-off seam over the run's own rows, exactly as a channel run holds them (`toRunRow`: text in `content` AND in
 * `parts`, calls in `toolCalls` AND in `parts`): the same packer and accessor the agent's compaction uses.
 */
async function packContextForModel(input: { messages: AgentMessage[]; systemPrompt: string; from: Model; to: Model; maxTokens?: number; priceTierBoundary?: number }) {
  const rows = input.messages.map(toRunRow);
  const r = await packForModelHandoff(
    {
      messages: rows,
      systemPrompt: input.systemPrompt,
      from: `${input.from.provider}/${input.from.id}`,
      to: `${input.to.provider}/${input.to.id}`,
      contextWindow: input.to.contextWindow,
      ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
      ...(input.priceTierBoundary !== undefined ? { priceTierBoundary: input.priceTierBoundary } : {}),
    },
    runRowHandoff(),
  );
  return { ...r, rows };
}

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

describe("packForModelHandoff over channel rows (stall failover hand-off)", () => {
  it("hands a context that already fits over untouched", async () => {
    const messages = context();
    const r = await packContextForModel({ messages, systemPrompt: "sys", from: model("big", 200_000), to: model("mid", 128_000) });
    expect(r.dropped).toBe(0);
    expect(r.messages).toEqual(r.rows);
  });

  it("packs for a smaller fallback window: directive kept, calls never split from results, one summary row", async () => {
    const messages = context();
    const r = await packContextForModel({ messages, systemPrompt: "sys", from: model("big", 200_000), to: model("small", 4_096), maxTokens: 512 });
    expect(r.dropped).toBeGreaterThan(0);
    expect(r.fits).toBe(true);
    expect(r.messages).toContain(r.rows[0]);
    // The note is the one row the packer wrote: every other row is one of the run's own, by identity.
    const notes = r.messages.filter((m) => !r.rows.includes(m));
    expect(notes).toHaveLength(1);
    expect(notes[0]!.content).toContain("Handed off from ollama/big to ollama/small.");
    // Every kept tool result's call is kept before it.
    const calls = new Set<string>();
    for (const m of r.messages) {
      if (m.role === "assistant") for (const c of m.toolCalls ?? []) calls.add(c.id);
      if (m.role === "tool") expect(calls.has(m.toolCallId ?? "")).toBe(true);
    }
  });

  it("counts a row's text once, though a channel row carries it in `content` and in its parts", async () => {
    // 10 results of 2,000 chars (500 tokens) is ~5K tokens counted once, ~10K counted twice; a 9K window less the 4,096 default reserve
    // holds the first and not the second reading.
    const messages = context();
    const r = await packContextForModel({ messages, systemPrompt: "sys", from: model("big", 200_000), to: model("fits-once", 9_000), maxTokens: 512 });
    expect(r.dropped).toBe(0);
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
    /** The run's policy decides the lever (the channel adapter reads the on-device gate); the hand-off packs under the boundary it names. */
    const boundaryFor = (to: Model): number | undefined =>
      policyOf({ model: to } as unknown as AgentLoopConfig, "go").levers.includes("c9_price_tier_budget") ? priceTierBoundary(to.id) : undefined;

    it("packs under the lowest price boundary instead of filling the window", async () => {
      vi.stubEnv("COST_LEVER_C9_PRICE_TIER_BUDGET", "on");
      const to = tiered();
      const r = await packContextForModel({ messages: big(), systemPrompt: "sys", from: model("big", 1_000_000), to, priceTierBoundary: boundaryFor(to) });
      expect(r.dropped).toBeGreaterThan(0);
      expect(r.fits).toBe(true);
    });

    it("fills the window as before when the lever is off", async () => {
      vi.stubEnv("COST_LEVER_C9_PRICE_TIER_BUDGET", "off");
      const to = tiered();
      const r = await packContextForModel({ messages: big(), systemPrompt: "sys", from: model("big", 1_000_000), to, priceTierBoundary: boundaryFor(to) });
      expect(r.dropped).toBe(0);
    });
  });
});
