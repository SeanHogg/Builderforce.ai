import { afterEach, describe, expect, it, vi } from "vitest";
import { packForModelHandoff, runRowHandoff } from "@builderforce/agent-run";
import type { RunMessage } from "@builderforce/agent-run";
import { priceTierBoundary } from "@builderforce/model-catalog";
import { policyOf } from "../../run/channelAdapter.js";
import type { AgentLoopConfig } from "./agent-loop-config.js";
import type { Model } from "../model/types.js";

// C9 is read through the on-device gate (install-id bucketing), not a null-tenant check.
const { leverOn } = vi.hoisted(() => ({ leverOn: vi.fn((_id: string) => false) }));
vi.mock("../../infra/cost-levers.js", () => ({ onDeviceCostLeverOn: (id: string) => leverOn(id) }));

const model = (id: string, contextWindow: number, provider = "ollama"): Model =>
  ({ id, provider, contextWindow, maxTokens: 1_024 }) as unknown as Model;

function call(i: number): RunMessage {
  return { role: "assistant", content: "", toolCalls: [{ id: `c${i}`, name: "read_file", arguments: "{}" }] };
}

function result(i: number): RunMessage {
  return { role: "tool", toolCallId: `c${i}`, content: "X".repeat(20_000) };
}

/** ~130K input tokens: inside a 1M window, past claude-haiku-5-5's 100K price boundary. */
function big(): RunMessage[] {
  const out: RunMessage[] = [{ role: "user", content: "Add the avatar filter." }];
  for (let i = 0; i < 26; i++) out.push(call(i), result(i));
  return out;
}

/**
 * The channel adapter reads the gate and names the lever in the run's policy; the hand-off packs under the boundary the policy
 * names, through the production seam over the run's own rows.
 */
function handOff(to: Model) {
  const policy = policyOf({ model: to } as unknown as AgentLoopConfig, "go");
  const boundary = policy.levers.includes("c9_price_tier_budget") ? priceTierBoundary(to.id) : undefined;
  return packForModelHandoff<RunMessage>(
    {
      messages: big(),
      systemPrompt: "sys",
      from: "ollama/big",
      to: `${to.provider}/${to.id}`,
      contextWindow: to.contextWindow,
      ...(boundary !== undefined ? { priceTierBoundary: boundary } : {}),
    },
    runRowHandoff(),
  );
}

describe("handoff pack - c9_price_tier_budget through the on-device lever gate", () => {
  afterEach(() => leverOn.mockReset());

  it("asks the on-device gate for c9 and packs under the price boundary when this install is in the rollout", async () => {
    leverOn.mockImplementation(() => true);
    const r = await handOff(model("claude-haiku-5-5", 1_000_000, "anthropic"));
    expect(leverOn).toHaveBeenCalledWith("c9_price_tier_budget");
    expect(r.dropped).toBeGreaterThan(0);
  });

  it("fills the window when the gate says this install is out", async () => {
    leverOn.mockImplementation(() => false);
    const r = await handOff(model("claude-haiku-5-5", 1_000_000, "anthropic"));
    expect(leverOn).toHaveBeenCalledWith("c9_price_tier_budget");
    expect(r.dropped).toBe(0);
  });
});
