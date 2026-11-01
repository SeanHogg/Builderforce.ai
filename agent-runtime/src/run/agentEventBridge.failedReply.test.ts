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

  it("a run the agent ended by its own policy already says why: its last reply is MARKED failed, with no second account and its text unchanged", () => {
    const b = bridge();
    b.appended({ role: "assistant", content: "Stopped: nothing was actually run." });
    b.emit({ kind: "stall.recovered", action: "fail", detail: "nothing left to try" } as never);
    b.failedReply("late notice");
    b.fail("the same failure again", "error");

    // the lifecycle ends in error, agreeing with the run's outcome; never the late text, never a second message
    expect(b.messages()).toHaveLength(1);
    expect(last(b)).toMatchObject({ role: "assistant", stopReason: "stop", runFailed: true, content: [{ type: "text", text: "Stopped: nothing was actually run." }] });
    expect(last(b)?.errorMessage).toBeUndefined();
  });

  it("with no reply to mark, a policy-settled failure tells one empty reply marked failed (and only one)", () => {
    const b = bridge();
    b.emit({ kind: "stall.recovered", action: "pause", note: "model made no progress" } as never);
    b.fail("model made no progress", "error");
    b.fail("again", "error");

    expect(b.messages()).toHaveLength(1);
    expect(last(b)).toMatchObject({ content: [], runFailed: true });
  });
});
