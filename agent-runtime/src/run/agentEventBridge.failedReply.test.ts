/**
 * `failedReply`: the notice a run ends on when it wrote nothing (or a gate refused its calls). It is the run's REPLY, marked
 * `runFailed`, and it is told only when nothing else already ended the run.
 */
import { describe, expect, it } from "vitest";
import type { AssistantMessage, Model } from "../builderforce/model/types.js";
import { AgentEventBridge } from "./agentEventBridge.js";

const model = { id: "m", name: "m", api: "openai-completions", provider: "p", baseUrl: "", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000, maxTokens: 100 } as unknown as Model;
const bridge = () => new AgentEventBridge({ activeModel: () => model, onSwap: () => undefined });
const last = (b: AgentEventBridge) => b.messages().at(-1) as AssistantMessage | undefined;

describe("AgentEventBridge.failedReply", () => {
  it("tells the notice as a reply that is marked as a failed run, with no error text a classifier could read", () => {
    const b = bridge();
    b.failedReply("The run ended without a reply: its tool calls failed.");

    expect(last(b)).toMatchObject({ role: "assistant", stopReason: "stop", runFailed: true, content: [{ type: "text", text: "The run ended without a reply: its tool calls failed." }] });
    expect(last(b)?.errorMessage).toBeUndefined();
  });

  it("adds nothing after a failure that already ended the run on an errored turn", () => {
    const b = bridge();
    b.fail("socket hang up", "error");
    b.failedReply("late notice");

    expect(b.messages()).toHaveLength(1);
    expect(last(b)?.stopReason).toBe("error");
  });

  it("adds nothing after the agent ended the run by its own policy", () => {
    const b = bridge();
    b.emit({ kind: "stall.recovered", action: "fail", detail: "nothing left to try" } as never);
    b.failedReply("late notice");

    expect(b.messages()).toHaveLength(0);
  });
});
