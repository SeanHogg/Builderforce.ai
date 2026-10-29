/**
 * Conformance: a guard note pending across a step boundary reaches the model the same
 * way on a continuous run and on a `maxSteps: 1` resume (PRD 35 §3.3).
 *
 * Turn 1 repeats one failing call three times, which trips A3's `repeated_failure` and
 * leaves a steer for the NEXT turn. On a stepped run that next turn is a fresh tick: its
 * brief is written before any guard hook has run on the resumed state, so the note must
 * be read from the saved `state.guards`, not from a live session only.
 */
import { describe, expect, it } from "vitest";
import type { Capability } from "@builderforce/agent-tools";
import { runAgent, type ModelCompletion, type ModelRequest, type RunOutcome, type RunPolicy, type RunPorts, type RunState } from "../../src/index.js";
import { TEST_POLICY, TEST_TASK } from "../support/policyContext.js";

const POLICY: RunPolicy = { ...TEST_POLICY, levers: ["a3_progress_detector"] };

const failing = (id: string) => ({ id, name: "nonexistent_tool", arguments: '{"target":"x"}' });

const SCRIPT: ModelCompletion[] = [
  { content: "", toolCalls: [failing("c1"), failing("c2"), failing("c3")], model: "fake-model" },
  { content: "Done.", model: "fake-model" },
];

function ports(store: { saved?: RunState }, requests: ModelRequest[], calls: { n: number }): RunPorts {
  return {
    model: {
      complete: async (request) => {
        requests.push(JSON.parse(JSON.stringify(request)) as ModelRequest);
        const answer = SCRIPT[calls.n];
        calls.n += 1;
        if (!answer) throw new Error("script exhausted");
        return answer;
      },
    },
    capabilities: { capabilities: new Set<Capability>() },
    store: {
      load: () => store.saved,
      save: (state: RunState) => {
        store.saved = JSON.parse(JSON.stringify(state)) as RunState;
      },
    },
    events: { emit: () => undefined },
    human: { ask: async () => ({ kind: "paused" }) },
    steering: { drain: () => [] },
    context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
  };
}

async function requestsOf(maxSteps?: number): Promise<{ requests: ModelRequest[]; outcome: RunOutcome }> {
  const store: { saved?: RunState } = {};
  const requests: ModelRequest[] = [];
  const calls = { n: 0 };
  const step = maxSteps !== undefined ? { maxSteps } : {};
  let outcome = await runAgent({ task: TEST_TASK, policy: POLICY, ports: ports(store, requests, calls), ...step });
  for (let tick = 0; outcome.kind === "yielded"; tick += 1) {
    if (tick > 100) throw new Error("run never finished after 100 ticks");
    outcome = await runAgent({ task: TEST_TASK, policy: POLICY, ports: ports(store, requests, calls), resume: store.saved, ...step });
  }
  return { requests, outcome };
}

describe("conformance — a pending guard note survives a resume", () => {
  it("the turn after an A3 trip carries the steer on both paths, and the requests match", async () => {
    const continuous = await requestsOf();
    const stepped = await requestsOf(1);

    expect(continuous.outcome.kind).toBe("finished");
    expect(continuous.requests).toHaveLength(2);
    const tail = continuous.requests[1]?.messages.at(-1)?.content ?? "";
    expect(tail).toContain("nonexistent_tool");
    expect(tail).toContain("has failed 3 times");

    expect(stepped.requests).toEqual(continuous.requests);
  });
});
