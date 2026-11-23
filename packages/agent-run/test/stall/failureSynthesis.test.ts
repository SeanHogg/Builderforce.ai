/**
 * The forced closing turn of a run the consecutive-failure breaker stopped. The kernel owns it (`runAgent` hands the breaker's
 * streak to `stall.synthesis`; the prompt is data in `policy/stall`, selected by `StallStyle.failureSynthesis`); a surface only
 * records the turn (`ModelRequest.forcedFinish`). Ported from the Brain's `runStore/failureClose.ts`, whose own copy of the turn is gone.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_TOOL_FAILURE_STREAK } from "@builderforce/agent-loop";
import type { Capability } from "@builderforce/agent-tools";
import { runAgent, type DeliveryLedger, type ModelCompletion, type ModelRequest, type PlatformTools, type RunPorts } from "../../src/index.js";
import { FORCED_SYNTHESIS_PROMPT, failureStreakSynthesisPrompt } from "../../src/policy/stall/index.js";
import { TEST_POLICY, TEST_TASK, schemas } from "../support/policyContext.js";

const failingCall = (i: number): ModelCompletion => ({ content: "", toolCalls: [{ id: `c${i}`, name: "read_file", arguments: JSON.stringify({ path: `f${i}.ts` }) }] });

async function runFailing(delivery: DeliveryLedger | undefined, script: ModelCompletion[]) {
  const requests: ModelRequest[] = [];
  let n = 0;
  const platform: PlatformTools = {
    closed: true,
    verbatimText: true,
    schemas: () => schemas(["read_file"]),
    selection: { query: "", limit: 50, required: new Set<string>() },
    execute: async () => ({ data: { ok: false, error: "EACCES: permission denied" }, isError: true }),
  };
  const ports: RunPorts = {
    model: {
      complete: async (request) => {
        requests.push(request);
        const answer = script[n++];
        if (!answer) throw new Error("script exhausted");
        return answer;
      },
    },
    capabilities: { capabilities: new Set<Capability>() },
    store: { load: () => undefined, save: () => undefined },
    events: { emit: () => undefined },
    human: { ask: async () => ({ kind: "paused" }) },
    context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
    platform,
    ...(delivery ? { delivery } : {}),
  };
  const outcome = await runAgent({ task: TEST_TASK, policy: TEST_POLICY, ports });
  return { outcome, requests };
}

const lastUserRow = (request: ModelRequest): string => String(request.messages[request.messages.length - 1]?.content ?? "");
const streak = Array.from({ length: DEFAULT_TOOL_FAILURE_STREAK }, (_, i) => failingCall(i));

describe("the failure breaker's forced closing turn", () => {
  it("names the failure streak, offers no tools, is marked as the forced turn, and its reply is the run's answer", async () => {
    const delivery: DeliveryLedger = { rungs: () => [], stall: { failureSynthesis: true } };
    const { outcome, requests } = await runFailing(delivery, [...streak, { content: "I could not read the files: EACCES." }]);
    // Five failing tool turns, then the closing synthesis with tools withdrawn.
    expect(requests).toHaveLength(DEFAULT_TOOL_FAILURE_STREAK + 1);
    const closing = requests[DEFAULT_TOOL_FAILURE_STREAK]!;
    expect(closing.tools ?? []).toEqual([]);
    expect(lastUserRow(closing)).toContain(`last ${DEFAULT_TOOL_FAILURE_STREAK} tool calls all failed`);
    expect(lastUserRow(closing)).toBe(failureStreakSynthesisPrompt(DEFAULT_TOOL_FAILURE_STREAK));
    expect(closing.forcedFinish).toEqual({ failureStreak: DEFAULT_TOOL_FAILURE_STREAK });
    expect(requests.slice(0, DEFAULT_TOOL_FAILURE_STREAK).every((r) => r.forcedFinish === undefined)).toBe(true);
    expect(outcome.kind).toBe("finished");
    expect(outcome.kind === "finished" ? outcome.output : "").toContain("EACCES");
  });

  it("a surface that declares nothing keeps the generic closing prompt (the team reply)", async () => {
    const { requests } = await runFailing(undefined, [...streak, { content: "Done." }]);
    expect(lastUserRow(requests[DEFAULT_TOOL_FAILURE_STREAK]!)).toBe(FORCED_SYNTHESIS_PROMPT);
  });

  it("a surface whose closing turn is only for a failure streak asks no extra call for any other ending", async () => {
    const delivery: DeliveryLedger = { rungs: () => [], stall: { failureSynthesis: true } };
    const { requests, outcome } = await runFailing(delivery, [{ content: "" }]);
    expect(requests).toHaveLength(1);
    expect(outcome.kind).not.toBe("failed");
  });

  it("when the closing turn also comes back empty the run fails as exhausted, carrying the streak (the surface words its own error)", async () => {
    const delivery: DeliveryLedger = { rungs: () => [], stall: { failureSynthesis: true } };
    const { outcome } = await runFailing(delivery, [...streak, { content: "" }]);
    expect(outcome.kind).toBe("failed");
    expect(outcome.kind === "failed" ? outcome.exhausted : false).toBe(true);
    expect(outcome.kind === "failed" ? outcome.failureStreak : 0).toBe(DEFAULT_TOOL_FAILURE_STREAK);
  });
});
