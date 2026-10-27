import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentMessage } from "../model/agent-types.js";
import type { AssistantMessage, Model, ToolResultMessage } from "../model/types.js";
import { packContextForModel } from "./handoff-pack.js";

// C9 is read through the on-device gate (install-id bucketing), not a null-tenant check.
const { leverOn } = vi.hoisted(() => ({ leverOn: vi.fn((_id: string) => false) }));
vi.mock("../../infra/cost-levers.js", () => ({ onDeviceCostLeverOn: (id: string) => leverOn(id) }));

const model = (id: string, contextWindow: number, provider = "ollama"): Model =>
  ({ id, provider, contextWindow, maxTokens: 1_024 }) as unknown as Model;

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
  return { role: "toolResult", toolCallId: `c${i}`, toolName: "read_file", content: [{ type: "text", text: "X".repeat(20_000) }], isError: false, timestamp: 0 };
}

/** ~130K input tokens: inside a 1M window, past claude-haiku-5-5's 100K price boundary. */
function big(): AgentMessage[] {
  const out: AgentMessage[] = [{ role: "user", content: "Add the avatar filter.", timestamp: 0 }];
  for (let i = 0; i < 26; i++) out.push(call(i), result(i));
  return out;
}

describe("handoff pack — c9_price_tier_budget through the on-device lever gate", () => {
  afterEach(() => leverOn.mockReset());

  it("asks the on-device gate for c9 and packs under the price boundary when this install is in the rollout", async () => {
    leverOn.mockImplementation(() => true);
    const r = await packContextForModel({
      messages: big(),
      systemPrompt: "sys",
      from: model("big", 1_000_000),
      to: model("claude-haiku-5-5", 1_000_000, "anthropic"),
    });
    expect(leverOn).toHaveBeenCalledWith("c9_price_tier_budget");
    expect(r.dropped).toBeGreaterThan(0);
  });

  it("fills the window when the gate says this install is out", async () => {
    leverOn.mockImplementation(() => false);
    const r = await packContextForModel({
      messages: big(),
      systemPrompt: "sys",
      from: model("big", 1_000_000),
      to: model("claude-haiku-5-5", 1_000_000, "anthropic"),
    });
    expect(leverOn).toHaveBeenCalledWith("c9_price_tier_budget");
    expect(r.dropped).toBe(0);
  });
});
