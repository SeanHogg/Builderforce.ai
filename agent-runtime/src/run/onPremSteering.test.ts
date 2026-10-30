import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CapabilityProvider } from "@builderforce/agent-tools";
import type { ModelRequest, ModelTransport } from "@builderforce/agent-run";

/**
 * Mid-run steering (GAP A3). Retargeted from the deleted Claude Agent SDK runner to the
 * public seam that carries the same behaviour (PRD 35 §5.1): a portal steer pushed into
 * the run's channel becomes the next user turn of the SAME run — not a message into a chat
 * session the run never reads. The scripted model replaces the SDK's scripted `query()`:
 * it answers one model call per turn, and a steer pushed while a turn is in flight is
 * taken before the run finishes.
 */

/** Per-turn scripted model output: the fake answers one model call per turn. */
let turnResults: Array<{ result: string; fail?: boolean }> = [];
/** The requests the model was asked, in order. */
const requests: ModelRequest[] = [];

const scriptedModel: ModelTransport = {
  complete: async (request) => {
    requests.push(JSON.parse(JSON.stringify(request)) as ModelRequest);
    const scripted = turnResults[requests.length - 1] ?? { result: "" };
    if (scripted.fail) throw new Error(scripted.result);
    return { content: scripted.result };
  },
};

/** No tool backing: the run's tools are only the ones every surface has (`finish`). */
const noCapabilities: CapabilityProvider = { capabilities: new Set() };

import { runOnPremAgent } from "../run/onPremAdapter.js";
import { createSteeringChannel } from "../infra/relay-steering.js";

const baseParams = {
  prompt: "build it",
  cwd: "/w",
  anthropicBaseUrl: "https://gw/llm",
  gatewayAuthKey: "k",
  transport: scriptedModel,
  capabilities: noCapabilities,
};

function sinks() {
  return {
    onAssistantText: vi.fn(),
    onToolUse: vi.fn(),
    onResult: vi.fn(),
    onSteerApplied: vi.fn(),
  };
}

beforeEach(() => {
  requests.length = 0;
  turnResults = [];
});

describe("runOnPremAgent steering", () => {
  it("delivers the task prompt as the first user message and ends after one result when nothing is queued", async () => {
    turnResults = [{ result: "done" }];
    const s = sinks();
    const out = await runOnPremAgent({ ...baseParams, appendSystemPrompt: "persona" }, s);

    expect(out).toEqual({ ok: true, text: "done" });
    expect(requests[0].messages.find((m) => m.role === "user")?.content).toBe("build it");
    expect(s.onAssistantText).toHaveBeenCalledTimes(1);
    expect(s.onResult).toHaveBeenCalledTimes(1);
    expect(s.onSteerApplied).not.toHaveBeenCalled();
  });

  it("applies a steer pushed mid-run as the next turn and acknowledges it", async () => {
    turnResults = [{ result: "first pass" }, { result: "steered pass" }];
    const steering = createSteeringChannel();
    const s = sinks();
    // Push while the first turn is in flight (before its result is observed).
    s.onAssistantText.mockImplementationOnce(() => {
      expect(steering.push("also add tests")).toBe(true);
    });

    const out = await runOnPremAgent({ ...baseParams, steering }, s);

    expect(out).toEqual({ ok: true, text: "steered pass" });
    expect(s.onSteerApplied).toHaveBeenCalledWith("also add tests");
    // The steer reached the MODEL, not just the ack: the second model call carries its text.
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1].messages)).toContain("also add tests");
    expect(JSON.stringify(requests[0].messages)).not.toContain("also add tests");
    expect(s.onResult).toHaveBeenCalledTimes(2);
    expect(steering.closed()).toBe(true);
  });

  it("closes the channel on failure so a late steer is refused rather than queued forever", async () => {
    const steering = createSteeringChannel();
    turnResults = [{ fail: true, result: "boom" }];
    const s = sinks();

    const out = await runOnPremAgent({ ...baseParams, steering }, s);

    expect(out.ok).toBe(false);
    expect(steering.push("too late")).toBe(false);
  });
});
