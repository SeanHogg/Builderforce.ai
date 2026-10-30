/**
 * Characterization — a call the run PARKS on an approver (a `require-approval` governance gate) never ran, so it is no counted
 * call and no error, and nothing after it in the same turn dispatches while the run waits on a person.
 */
import { describe, expect, it, vi } from "vitest";
import type { PolicyGate } from "@builderforce/agent-tools";
import type { ModelCompletion, RunPorts } from "../../src/contract.js";
import { runAgent } from "../../src/runAgent.js";
import { TEST_POLICY } from "../support/policyContext.js";

const GATE: PolicyGate = { id: "g1", tool: "run_command", effect: "require-approval", reason: "shell needs an approver" };
const TASK = { prompt: "Do the work.", dispatch: { source: "chat" as const } };

describe("a parked governance call", () => {
  it("is not tallied as a call or an error, and the turn's later calls are not dispatched", async () => {
    const turn: ModelCompletion = {
      content: "",
      toolCalls: [
        { id: "a", name: "run_command", arguments: '{"command":"ls"}' },
        { id: "b", name: "list_files", arguments: '{"path":"src"}' },
      ],
    };
    const approve = vi.fn(async () => ({ kind: "paused" as const, approvalId: "appr-1" }));
    const dispatched: string[] = [];
    const ports: RunPorts = {
      model: { complete: async () => turn },
      capabilities: { capabilities: new Set() },
      store: { load: () => undefined, save: () => undefined },
      events: { emit: (e) => { if (e.kind === "tool.dispatched") dispatched.push(e.tool); } },
      human: { ask: vi.fn(), approve },
      context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
    };
    const outcome = await runAgent({ task: TASK, policy: { ...TEST_POLICY, approvalGates: [GATE] }, ports });
    expect(outcome.kind).toBe("paused");
    expect(approve).toHaveBeenCalledTimes(1);
    expect(outcome.state.telemetry).toMatchObject({ toolCalls: 0, toolErrors: 0 });
    expect(dispatched).toEqual([]);
    const second = outcome.state.messages.find((m) => (m as { toolCallId?: string }).toolCallId === "b") as { content: string } | undefined;
    expect(second?.content).toContain("parked on an approval");
  });
});
