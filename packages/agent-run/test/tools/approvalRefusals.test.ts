/**
 * An approval that is not granted reads true to the model, whoever or whatever said no: declined, timed out and stopped each say
 * what happened, and each is told as a gate refusal (`policy.blocked`) so a surface can name the gate when a run ends on it.
 */
import { describe, expect, it } from "vitest";
import type { Capability, PolicyGate } from "@builderforce/agent-tools";
import { runAgent, type HumanAnswer, type ModelCompletion, type ModelRequest, type RunEvent, type RunPorts } from "../../src/index.js";
import { TEST_POLICY, TEST_TASK } from "../support/policyContext.js";

const GATES: PolicyGate[] = [{ id: "ask-first", tool: "exec", effect: "require-approval", reason: "needs a person" }];

async function runWith(answer: HumanAnswer | undefined) {
  const events: RunEvent[] = [];
  const script: ModelCompletion[] = [{ content: "", toolCalls: [{ id: "c1", name: "exec", arguments: "{}" }] }, { content: "fin" }];
  let n = 0;
  const requests: ModelRequest[] = [];
  const ports: RunPorts = {
    model: { complete: async (request) => { requests.push(JSON.parse(JSON.stringify(request)) as ModelRequest); return script[n++]!; } },
    capabilities: { capabilities: new Set<Capability>() },
    store: { load: () => undefined, save: () => undefined },
    events: { emit: (e) => void events.push(e) },
    human: { ask: async () => ({ kind: "paused" }), approve: async () => answer as HumanAnswer },
    context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
  };
  await runAgent({ task: TEST_TASK, policy: { ...TEST_POLICY, approvalGates: GATES }, ports });
  const toolRow = JSON.stringify(requests[1]?.messages.find((m) => m.role === "tool")?.content ?? "");
  return { events, toolRow };
}

describe("a call whose approval was not granted", () => {
  it("declined: says the approver declined", async () => {
    const { toolRow } = await runWith({ kind: "answered", answer: "not today", approved: false, refusal: "declined" });
    expect(toolRow).toContain("The approver declined");
    expect(toolRow).toContain("not today");
  });

  it("with no stated reason is a decline (the contract before refusals were typed)", async () => {
    const { toolRow } = await runWith({ kind: "answered", answer: "", approved: false });
    expect(toolRow).toContain("The approver declined");
  });

  it("timed out: says nobody answered in time, and never says declined", async () => {
    const { toolRow } = await runWith({ kind: "answered", answer: "No approver responded in time.", approved: false, refusal: "timed_out" });
    expect(toolRow).toContain("in time");
    expect(toolRow).toContain("ask-first");
    expect(toolRow).not.toContain("declined");
  });

  it("stopped: says the run was stopped, and never says declined", async () => {
    const { toolRow } = await runWith({ kind: "answered", answer: "", approved: false, refusal: "stopped" });
    expect(toolRow).toContain("was stopped");
    expect(toolRow).toContain("ask-first");
    expect(toolRow).not.toContain("declined");
  });

  it("each is told as a gate refusal naming the gate; so is a channel with no approver at all", async () => {
    for (const answer of [
      { kind: "answered", answer: "", approved: false, refusal: "declined" },
      { kind: "answered", answer: "", approved: false, refusal: "timed_out" },
      { kind: "answered", answer: "", approved: false, refusal: "stopped" },
      undefined,
    ] as Array<HumanAnswer | undefined>) {
      const { events } = await runWith(answer);
      expect(events.filter((e) => e.kind === "policy.blocked")).toEqual([expect.objectContaining({ gateId: "ask-first", tool: "exec" })]);
    }
  });
});
