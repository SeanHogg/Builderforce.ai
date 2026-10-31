import { afterEach, describe, expect, it, vi } from "vitest";
import { packForModelHandoff, runRowHandoff } from "@builderforce/agent-run";
import type { RunMessage } from "@builderforce/agent-run";
import { priceTierBoundary } from "@builderforce/model-catalog";
import { policyOf } from "../../run/channelAdapter.js";
import type { AgentLoopConfig } from "./agent-loop-config.js";
import type { Model } from "../model/types.js";

const model = (id: string, contextWindow: number): Model =>
  ({ id, provider: "ollama", contextWindow, maxTokens: 1_024 }) as unknown as Model;

const ref = (m: Model): string => `${m.provider}/${m.id}`;

/** The production hand-off seam over the run's own rows: the same packer and accessor the agent's compaction uses. */
function pack(input: { messages: RunMessage[]; systemPrompt: string; from: Model; to: Model; maxTokens?: number; priceTierBoundary?: number }) {
  return packForModelHandoff<RunMessage>(
    {
      messages: input.messages,
      systemPrompt: input.systemPrompt,
      from: ref(input.from),
      to: ref(input.to),
      contextWindow: input.to.contextWindow,
      ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
      ...(input.priceTierBoundary !== undefined ? { priceTierBoundary: input.priceTierBoundary } : {}),
    },
    runRowHandoff(),
  );
}

function call(i: number): RunMessage {
  return { role: "assistant", content: "", toolCalls: [{ id: `c${i}`, name: "read_file", arguments: "{}" }] };
}

function result(i: number): RunMessage {
  return { role: "tool", toolCallId: `c${i}`, content: "X".repeat(2_000) };
}

function context(): RunMessage[] {
  const out: RunMessage[] = [{ role: "user", content: "Add the avatar filter." }];
  for (let i = 0; i < 10; i++) out.push(call(i), result(i));
  return out;
}

describe("packForModelHandoff (stall failover hand-off)", () => {
  it("hands a context that already fits over untouched", async () => {
    const messages = context();
    const r = await pack({ messages, systemPrompt: "sys", from: model("big", 200_000), to: model("mid", 128_000) });
    expect(r.dropped).toBe(0);
    expect(r.messages).toEqual(messages);
  });

  it("packs for a smaller fallback window: directive kept, calls never split from results, one summary row", async () => {
    const messages = context();
    const r = await pack({ messages, systemPrompt: "sys", from: model("big", 200_000), to: model("small", 4_096), maxTokens: 512 });
    expect(r.dropped).toBeGreaterThan(0);
    expect(r.fits).toBe(true);
    expect(r.messages).toContain(messages[0]);
    // The note is the one row the packer wrote: every other row is one of the run's own, by identity.
    const notes = r.messages.filter((m) => !messages.includes(m));
    expect(notes).toHaveLength(1);
    expect(notes[0]!.content).toContain("Handed off from ollama/big to ollama/small.");
    // Every kept tool result's call is kept before it.
    const calls = new Set<string>();
    for (const m of r.messages) {
      if (m.role === "assistant") for (const c of m.toolCalls ?? []) calls.add(c.id);
      if (m.role === "tool") expect(calls.has(m.toolCallId ?? "")).toBe(true);
    }
  });

  describe("long-context price tier (cost lever c9_price_tier_budget)", () => {
    afterEach(() => vi.unstubAllEnvs());
    // ~130K input tokens: inside a 1M window, past claude-haiku-5-5's 100K price boundary.
    const big = (): RunMessage[] => {
      const out: RunMessage[] = [{ role: "user", content: "Add the avatar filter." }];
      for (let i = 0; i < 26; i++) {
        out.push(call(i), { ...result(i), content: "X".repeat(20_000) });
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
      const r = await pack({ messages: big(), systemPrompt: "sys", from: model("big", 1_000_000), to, priceTierBoundary: boundaryFor(to) });
      expect(r.dropped).toBeGreaterThan(0);
      expect(r.fits).toBe(true);
    });

    it("fills the window as before when the lever is off", async () => {
      vi.stubEnv("COST_LEVER_C9_PRICE_TIER_BUDGET", "off");
      const to = tiered();
      const r = await pack({ messages: big(), systemPrompt: "sys", from: model("big", 1_000_000), to, priceTierBoundary: boundaryFor(to) });
      expect(r.dropped).toBe(0);
    });
  });
});
