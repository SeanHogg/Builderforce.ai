/**
 * A3's `finish` through the kernel (VS Code chat #146477): verified → idle → finish → the
 * next turn advertises NO tools, sends no tool choice, keeps the run's role, is never judged
 * as a stall, and its answer — empty or narrative — finishes the run with no further step.
 */
import { describe, expect, it } from "vitest";
import type { Capability } from "@builderforce/agent-tools";
import { NO_PROGRESS_TURNS } from "@builderforce/run-guards";
import { runAgent, type ModelCompletion, type ModelRequest, type PlatformTools, type RunPorts } from "../../src/index.js";
import { TEST_POLICY, TEST_TASK, schemas } from "../support/policyContext.js";
import { finalSource } from "../../src/kernelHooks.js";

const call = (name: string, args: Record<string, unknown>, id: string): ModelCompletion => ({ content: "", toolCalls: [{ id, name, arguments: JSON.stringify(args) }] });

async function runToFinish(final: ModelCompletion) {
  const script: ModelCompletion[] = [
    call("edit_file", { path: "src/a.ts", old_string: "x", new_string: "y" }, "e1"),
    call("run_tests", {}, "t1"),
    // Two idle stretches: the first verified trip only asks (a steer), the second finishes.
    ...Array.from({ length: 2 * NO_PROGRESS_TURNS }, (_, i) => call("git_status", {}, `g${i}`)),
    final,
    // Only ever the run-end synthesis a silent run gets (`synthesizeFinal`, no tools) — never a loop step.
    { content: "Changed src/a.ts; tests pass." },
  ];
  const requests: ModelRequest[] = [];
  let n = 0;
  const platform: PlatformTools = {
    closed: true,
    verbatimText: true,
    schemas: () => schemas(["edit_file", "run_tests", "git_status"]),
    selection: { query: "", limit: 50, required: new Set<string>() },
    execute: async () => ({ data: { ok: true } }),
  };
  const ports: RunPorts = {
    model: {
      complete: async (request) => {
        requests.push(request);
        const answer = script[n++];
        if (!answer) throw new Error("script exhausted — the run took a step after its final turn");
        return answer;
      },
    },
    capabilities: { capabilities: new Set<Capability>() },
    store: { load: () => undefined, save: () => undefined },
    events: { emit: () => undefined },
    human: { ask: async () => ({ kind: "paused" }) },
    context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
    platform,
  };
  const outcome = await runAgent({ task: TEST_TASK, policy: { ...TEST_POLICY, levers: ["a3_progress_detector"] }, ports });
  return { outcome, requests, finalAt: script.length - 2 };
}

/** A run whose surface answers every turn's menu with `menu` and whose delivery ledger always owes a ship rung. */
async function runWithOwedRung(menu: { tools: ReturnType<typeof schemas>; final?: true }) {
  const requests: ModelRequest[] = [];
  const restated: number[] = [];
  const accepted: Array<{ step: number; content: string }> = [];
  const platform: PlatformTools = {
    closed: true,
    verbatimText: true,
    schemas: () => schemas(["edit_file", "git_commit"]),
    selection: { query: "", limit: 50, required: new Set<string>() },
    execute: async () => ({ data: { ok: true } }),
    turn: async () => menu,
  };
  const ports: RunPorts = {
    model: {
      complete: async (request) => {
        requests.push(request);
        if (requests.length > 4) throw new Error("the run kept re-prompting");
        return { content: "Final report: src/a.ts changed; the commit is still open." };
      },
    },
    capabilities: { capabilities: new Set<Capability>() },
    store: { load: () => undefined, save: () => undefined },
    events: { emit: () => undefined },
    human: { ask: async () => ({ kind: "paused" }) },
    context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
    platform,
    delivery: {
      rungs: () => [{ id: "ship", applies: true, restate: ["Verify, self-review, then git_commit."], spent: "fall", onRestate: (n) => { restated.push(n); } }],
      finalAccepted: (turn) => { accepted.push(turn); },
    },
  };
  const outcome = await runAgent({ task: TEST_TASK, policy: TEST_POLICY, ports });
  return { outcome, requests, restated, accepted };
}

describe("regression: chat #128305 — a surface's own final (no-tools) menu", () => {
  it("regression: a surface `final` menu is never sent back by a delivery rung: its answer finishes the run, and the ledger is told", async () => {
    const { outcome, requests, restated, accepted } = await runWithOwedRung({ tools: [], final: true });
    expect(requests.length).toBe(1);
    expect(requests[0]!.tools ?? []).toEqual([]);
    expect(requests[0]!.toolChoice).toBeUndefined();
    expect(restated).toEqual([]);
    expect(outcome.kind).toBe("finished");
    expect(outcome.kind === "finished" ? outcome.output : "").toMatch(/Final report/);
    expect(accepted).toEqual([{ step: expect.any(Number), content: "Final report: src/a.ts changed; the commit is still open." }]);
  });

  it("a surface `final` menu advertises NO tools, whatever tools it carried", async () => {
    const { requests } = await runWithOwedRung({ tools: schemas(["git_commit"]), final: true });
    expect(requests[0]!.tools ?? []).toEqual([]);
  });

  it("an empty menu the surface did NOT mark final is still judged by the rung, and is never reported as final (the control)", async () => {
    const { requests, restated, accepted } = await runWithOwedRung({ tools: [] });
    expect(restated.length).toBeGreaterThan(0);
    expect(requests.length).toBeGreaterThan(1);
    expect(accepted).toEqual([]);
  });
});

describe("finalSource — who makes a turn final", () => {
  it("a surface `final` menu is the surface's, and never peeks or spends the guards' pending finish", () => {
    let asked = 0;
    expect(finalSource({ tools: [], final: true }, () => { asked += 1; return true; })).toBe("surface");
    expect(asked).toBe(0);
  });

  it("a surface-forced (`required`) turn wins the step: the guards' finish is deferred (not final, so `finalTurnDone` is not called)", () => {
    let asked = 0;
    expect(finalSource({ tools: [], toolChoice: "required" }, () => { asked += 1; return true; })).toBeUndefined();
    expect(asked).toBe(0);
  });

  it("an ordinary menu is final only when the guards' A3 finish is due", () => {
    expect(finalSource({ tools: [] }, () => true)).toBe("guards");
    expect(finalSource(undefined, () => true)).toBe("guards");
    expect(finalSource({ tools: [] }, () => false)).toBeUndefined();
  });
});

describe("regression: chat #146477 — the final turn through the kernel", () => {
  for (const [name, final] of [["narrative", { content: "Changed src/a.ts; tests pass." }], ["empty", { content: "" }]] as const) {
    it(`regression: a ${name} final turn with no tools finishes the run, with no further step`, async () => {
      const { outcome, requests, finalAt } = await runToFinish(final);
      const last = requests[finalAt]!;
      expect(last.tools ?? []).toEqual([]);
      expect(last.toolChoice).toBeUndefined();
      expect(last.role).not.toBe("chat");
      expect(requests[finalAt - 1]!.tools?.length ?? 0).toBeGreaterThan(0);
      // Nothing after it offers a tool: a narrative answer ends the loop outright; an empty one gets only the run-end synthesis.
      expect(requests.length).toBe(name === "narrative" ? finalAt + 1 : finalAt + 2);
      expect(requests.slice(finalAt).every((r) => (r.tools ?? []).length === 0)).toBe(true);
      expect(outcome.state.guards.finishDue).toBeUndefined();
      expect(JSON.stringify(outcome)).not.toMatch(/Paused for a human/);
    });
  }
});
