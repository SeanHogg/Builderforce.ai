/**
 * The run-level wiring a scripted task proves end to end: the model preflight opens the
 * trace, a steered message is acknowledged before the turn it reaches, and a steered
 * STOP command settles the run cancelled with no further model turn (§6.3, §6.10).
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Capability } from "@builderforce/agent-tools";
import {
  queueRunSteering,
  runAgent,
  runSteeringSource,
  type ModelCompletion,
  type ModelRequest,
  type RunEvent,
  type RunPorts,
} from "../../src/index.js";
import { resetRunSteering } from "../../src/policy/steering/index.js";
import { TEST_POLICY, TEST_TASK } from "../support/policyContext.js";

function ports(runKey: number, answers: Array<(request: ModelRequest) => ModelCompletion>, events: RunEvent[], calls: { n: number }): RunPorts {
  return {
    model: {
      complete: async (request) => {
        const answer = answers[calls.n];
        calls.n += 1;
        if (!answer) throw new Error("script exhausted");
        return answer(request);
      },
    },
    capabilities: { capabilities: new Set<Capability>() },
    store: { load: () => undefined, save: () => undefined },
    events: { emit: (event) => void events.push(event) },
    human: { ask: async () => ({ kind: "paused" }) },
    steering: runSteeringSource(runKey),
    context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
  };
}

const callTool = (): ModelCompletion => ({ content: "", toolCalls: [{ id: "c1", name: "list_files", arguments: "{}" }] });

beforeEach(() => resetRunSteering());

describe("the run's wiring", () => {
  it("emits model.preflight right after run.started, ok when the transport has no preflight", async () => {
    const events: RunEvent[] = [];
    const outcome = await runAgent({ task: TEST_TASK, policy: TEST_POLICY, ports: ports(1, [() => ({ content: "Done." })], events, { n: 0 }) });
    expect(outcome.kind).toBe("finished");
    expect(events[0]?.kind).toBe("run.started");
    expect(events[1]).toEqual({ kind: "model.preflight", step: 0, status: "ok", notices: [] });
  });

  it("acknowledges a steered message with steer.applied before the turn it reaches", async () => {
    const events: RunEvent[] = [];
    const seen: string[] = [];
    const answers = [
      () => {
        queueRunSteering(2, "use the v2 endpoint instead");
        return callTool();
      },
      (request: ModelRequest) => {
        seen.push(...request.messages.map((m) => m.content));
        return { content: "Done." };
      },
    ];
    await runAgent({ task: TEST_TASK, policy: TEST_POLICY, ports: ports(2, answers, events, { n: 0 }) });
    const kinds = events.map((e) => e.kind);
    expect(kinds.filter((k) => k === "steer.applied")).toHaveLength(1);
    expect(kinds.indexOf("steer.applied")).toBeLessThan(kinds.lastIndexOf("turn.started"));
    expect(seen).toContain("use the v2 endpoint instead");
  });

  it("a steered STOP command settles the run cancelled and the model is never asked again", async () => {
    const events: RunEvent[] = [];
    const calls = { n: 0 };
    const answers = [
      () => {
        queueRunSteering(3, "STOP executing", { interrupt: true });
        return callTool();
      },
      () => ({ content: "should never run" }),
    ];
    const outcome = await runAgent({ task: TEST_TASK, policy: TEST_POLICY, ports: ports(3, answers, events, calls) });
    expect(outcome).toMatchObject({ kind: "failed", reason: "cancelled" });
    expect(calls.n).toBe(1);
    expect(events.at(-1)).toEqual({ kind: "run.finished", step: expect.any(Number), outcome: "failed" });
  });
});
