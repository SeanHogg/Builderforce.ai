import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mid-run steering (GAP A3). The runner hands `query()` an ASYNC ITERABLE prompt
 * (streaming-input mode, the only mode the SDK accepts extra user turns in) and
 * a portal steer pushed into the channel becomes the next user turn of the SAME
 * run — not a message into a chat session the run never reads.
 */

type Captured = { prompt: AsyncIterable<{ message: { content: unknown } }> };
const captured: Captured[] = [];
/** Per-turn scripted SDK output: the fake consumes one input message per turn. */
let turnResults: Array<{ type: string; result?: string }> = [];

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (params: Captured) => {
    captured.push(params);
    return (async function* () {
      let turn = 0;
      for await (const _input of params.prompt) {
        const scripted = turnResults[turn++] ?? { type: "result", result: "" };
        yield { type: "assistant", message: { content: [{ type: "text", text: `turn ${turn}` }] } };
        yield scripted;
      }
    })();
  },
}));

import { runClaudeAgentSdkV2 } from "./claude-agent-sdk-runner.js";
import { createSteeringChannel } from "../infra/relay-steering.js";

const baseParams = {
  prompt: "build it",
  cwd: "/w",
  anthropicBaseUrl: "https://gw/llm",
  gatewayAuthKey: "k",
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
  captured.length = 0;
  turnResults = [];
});

describe("runClaudeAgentSdkV2 steering", () => {
  it("streams the task prompt as the first user turn and ends after one result when nothing is queued", async () => {
    turnResults = [{ type: "result", result: "done" }];
    const s = sinks();
    const out = await runClaudeAgentSdkV2({ ...baseParams, appendSystemPrompt: "persona" }, s);

    expect(out).toEqual({ ok: true, text: "done" });
    expect(typeof captured[0].prompt[Symbol.asyncIterator]).toBe("function");
    expect(s.onAssistantText).toHaveBeenCalledTimes(1);
    expect(s.onResult).toHaveBeenCalledTimes(1);
    expect(s.onSteerApplied).not.toHaveBeenCalled();
  });

  it("applies a steer pushed mid-run as the next turn and acknowledges it", async () => {
    turnResults = [
      { type: "result", result: "first pass" },
      { type: "result", result: "steered pass" },
    ];
    const steering = createSteeringChannel();
    const s = sinks();
    // Push while the first turn is in flight (before its result is observed).
    s.onAssistantText.mockImplementationOnce(() => {
      expect(steering.push("also add tests")).toBe(true);
    });

    const out = await runClaudeAgentSdkV2({ ...baseParams, steering }, s);

    expect(out).toEqual({ ok: true, text: "steered pass" });
    expect(s.onSteerApplied).toHaveBeenCalledWith("also add tests");
    expect(s.onResult).toHaveBeenCalledTimes(2);
    expect(steering.closed()).toBe(true);
  });

  it("closes the channel on failure so a late steer is refused rather than queued forever", async () => {
    const steering = createSteeringChannel();
    turnResults = [{ type: "result", subtype: "error", result: "boom" } as never];
    const s = sinks();

    const out = await runClaudeAgentSdkV2({ ...baseParams, steering }, s);

    expect(out.ok).toBe(false);
    expect(steering.push("too late")).toBe(false);
  });
});
