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

  it("no approver reachable: says so, and never says declined", async () => {
    const { toolRow } = await runWith({ kind: "answered", answer: "", approved: false, refusal: "unreachable" });
    expect(toolRow).toContain("No approver could be reached");
    expect(toolRow).toContain("ask-first");
    expect(toolRow).not.toContain("declined");
  });

  it("each is told as a gate refusal naming the gate; so is a channel with no approver at all", async () => {
    for (const answer of [
      { kind: "answered", answer: "", approved: false, refusal: "declined" },
      { kind: "answered", answer: "", approved: false, refusal: "timed_out" },
      { kind: "answered", answer: "", approved: false, refusal: "stopped" },
      { kind: "answered", answer: "", approved: false, refusal: "unreachable" },
      undefined,
    ] as Array<HumanAnswer | undefined>) {
      const { events } = await runWith(answer);
      expect(events.filter((e) => e.kind === "policy.blocked")).toEqual([expect.objectContaining({ gateId: "ask-first", tool: "exec" })]);
    }
  });
});

describe("a refused call asked again", () => {
  /** The model asks for the same call `calls` times, then replies; the approver answers `answer` and counts how often it is asked. */
  async function askedTimes(answer: HumanAnswer, calls: Array<Record<string, unknown>>) {
    let asked = 0;
    const script: ModelCompletion[] = [
      ...calls.map((args, i) => ({ content: "", toolCalls: [{ id: `c${i}`, name: "exec", arguments: JSON.stringify(args) }] })),
      { content: "fin" },
    ];
    let n = 0;
    const requests: ModelRequest[] = [];
    const ports: RunPorts = {
      model: { complete: async (request) => { requests.push(JSON.parse(JSON.stringify(request)) as ModelRequest); return script[n++]!; } },
      capabilities: { capabilities: new Set<Capability>() },
      store: { load: () => undefined, save: () => undefined },
      events: { emit: () => undefined },
      human: { ask: async () => ({ kind: "paused" }), approve: async () => { asked += 1; return answer; } },
      context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
    };
    await runAgent({ task: TEST_TASK, policy: { ...TEST_POLICY, approvalGates: GATES }, ports });
    return { asked, requests };
  }

  for (const refusal of ["declined", "timed_out", "stopped", "unreachable"] as const) {
    it(`${refusal}: the identical call is refused at once, the approver is asked once`, async () => {
      const { asked, requests } = await askedTimes({ kind: "answered", answer: "", approved: false, refusal }, [{ command: "ls" }, { command: "ls" }]);
      expect(asked).toBe(1);
      // the second refusal reads the same as the first
      const rows = requests.at(-1)!.messages.filter((m) => m.role === "tool").map((m) => JSON.stringify(m.content));
      expect(rows).toHaveLength(2);
      expect(rows[1]).toBe(rows[0]);
    });
  }

  it("a DIFFERENT call is still asked about", async () => {
    const { asked } = await askedTimes({ kind: "answered", answer: "", approved: false, refusal: "declined" }, [{ command: "ls" }, { command: "rm -rf /" }]);
    expect(asked).toBe(2);
  });

  it("tells the model not to ask again", async () => {
    const { requests } = await askedTimes({ kind: "answered", answer: "", approved: false, refusal: "declined" }, [{ command: "ls" }]);
    expect(JSON.stringify(requests.at(-1)!.messages)).toContain("Do not ask for this again");
  });
});
