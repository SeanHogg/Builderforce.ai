/**
 * A late steer is never lost (PRD 35 §6.3): a message that lands while the run's LAST
 * model turn is in flight — whether that turn answers in prose or calls `finish` — is taken
 * by one more turn instead of the run finishing past it.
 */

import { describe, expect, it } from "vitest";
import type { Capability } from "@builderforce/agent-tools";
import { runAgent, type ModelCompletion, type ModelRequest, type RunEvent, type RunPorts, type SteeringSource } from "../../src/index.js";
import { TEST_POLICY, TEST_TASK } from "../support/policyContext.js";

/** A run whose user types `typed` during the first model call. */
function setup(script: ModelCompletion[], typed: string) {
  const requests: ModelRequest[] = [];
  const events: RunEvent[] = [];
  let given = false;
  const steering: SteeringSource = {
    drain: () => {
      if (given || requests.length === 0) return [];
      given = true;
      return [typed];
    },
  };
  const ports: RunPorts = {
    model: {
      complete: async (request) => {
        requests.push(JSON.parse(JSON.stringify(request)) as ModelRequest);
        const answer = script[requests.length - 1];
        if (!answer) throw new Error("script exhausted");
        return answer;
      },
    },
    capabilities: { capabilities: new Set<Capability>() },
    store: { load: () => undefined, save: () => undefined },
    events: { emit: (event) => void events.push(event) },
    human: { ask: async () => ({ kind: "paused" }) },
    steering,
    context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
  };
  return { ports, requests, events };
}

const steerEvents = (events: RunEvent[]) => events.filter((e) => e.kind === "steer.applied");

describe("a steer that lands during the last turn", () => {
  it("is taken by one more turn when that turn answers in prose", async () => {
    const { ports, requests, events } = setup([{ content: "first pass" }, { content: "steered pass" }], "also add tests");
    const outcome = await runAgent({ task: TEST_TASK, policy: TEST_POLICY, ports });
    expect(outcome.kind === "finished" && outcome.output).toBe("steered pass");
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1]?.messages)).toContain("also add tests");
    expect(steerEvents(events)).toHaveLength(1);
  });

  it("is taken by one more turn when that turn calls finish", async () => {
    const finish: ModelCompletion = { content: "", toolCalls: [{ id: "f1", name: "finish", arguments: '{"summary":"all done"}' }] };
    const { ports, requests, events } = setup([finish, { content: "steered pass" }], "also add tests");
    const outcome = await runAgent({ task: TEST_TASK, policy: TEST_POLICY, ports });
    expect(outcome.kind === "finished" && outcome.output).toBe("steered pass");
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1]?.messages)).toContain("also add tests");
    expect(steerEvents(events)).toHaveLength(1);
    // Deferring the finish for a message is not a failure: the call is not an error row.
    expect(events).toContainEqual(expect.objectContaining({ kind: "tool.dispatched", tool: "finish", ok: true }));
  });

  it("lets a stop command win over the finish and settles the run cancelled", async () => {
    const finish: ModelCompletion = { content: "", toolCalls: [{ id: "f1", name: "finish", arguments: '{"summary":"all done"}' }] };
    const { ports, requests } = setup([finish, { content: "never" }], "STOP");
    const outcome = await runAgent({ task: TEST_TASK, policy: TEST_POLICY, ports });
    expect(outcome.kind).toBe("failed");
    expect(outcome.kind === "failed" && outcome.reason).toBe("cancelled");
    expect(requests).toHaveLength(1);
  });
});
