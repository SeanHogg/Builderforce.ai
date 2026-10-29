/**
 * Characterization — how a run ENDS across steps (PRD 35 WS3): one outcome row and one `run.finished` per run, nothing
 * terminal for an exception the surface will re-throw (a platform eviction), the failed outcome's `cause` / `exhausted`
 * markers, and what a stall with nothing left to try does per host (`RunPolicy.stallExhausted`).
 */
import { describe, expect, it, vi } from "vitest";
import type { ModelCompletion, RunEvent, RunOutcomeRow, RunPolicy, RunPorts, RunState } from "../../src/contract.js";
import { runAgent } from "../../src/runAgent.js";
import { TEST_POLICY } from "../support/policyContext.js";

const TASK = { prompt: "Do the work.", dispatch: { source: "chat" as const } };

function build(turns: Array<ModelCompletion | Error>, over: { commit?: () => void } = {}) {
  const events: RunEvent[] = [];
  const rows: RunOutcomeRow[] = [];
  let saved: RunState | undefined;
  let i = 0;
  const ports: RunPorts = {
    model: {
      complete: async () => {
        const turn = turns[Math.min(i++, turns.length - 1)]!;
        if (turn instanceof Error) throw turn;
        return turn;
      },
    },
    capabilities: { capabilities: new Set() },
    store: {
      load: () => saved,
      save: (s) => { saved = JSON.parse(JSON.stringify(s)) as RunState; },
      commitMemory: () => over.commit?.(),
    },
    events: { emit: (e) => { events.push(e); }, outcome: (r) => { rows.push(r); } },
    human: { ask: async () => ({ kind: "paused" }) },
    context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
  };
  return { ports, events, rows, saved: () => saved };
}

const kinds = (events: RunEvent[]) => events.map((e) => e.kind);

describe("one outcome row and one run.finished per RUN", () => {
  it("a tick that yields writes neither; the tick that ends the run writes both once", async () => {
    const run = build([
      { content: "", toolCalls: [{ id: "a", name: "tool_search", arguments: '{"query":"zzzz"}' }] },
      { content: "", toolCalls: [{ id: "b", name: "finish", arguments: '{"summary":"done"}' }] },
      { content: "done" },
    ]);
    let outcome = await runAgent({ task: TASK, policy: TEST_POLICY, ports: run.ports, maxSteps: 1 });
    expect(outcome.kind).toBe("yielded");
    expect(run.rows).toHaveLength(0);
    expect(kinds(run.events)).not.toContain("run.finished");
    for (let tick = 0; outcome.kind === "yielded" && tick < 20; tick += 1) {
      outcome = await runAgent({ task: TASK, policy: TEST_POLICY, ports: run.ports, resume: run.saved(), maxSteps: 1 });
    }
    expect(outcome.kind).toBe("finished");
    expect(run.rows).toHaveLength(1);
    expect(kinds(run.events).filter((k) => k === "run.finished")).toHaveLength(1);
  });

  describe("the row counts the WHOLE run, not the tick that ended it (§8.2)", () => {
    const turns = (): ModelCompletion[] => [
      { content: "", toolCalls: [{ id: "a", name: "tool_search", arguments: '{"query":"zzzz"}' }] },
      { content: "", toolCalls: [{ id: "b", name: "tool_search", arguments: '{"query":"qqqq"}' }] },
      { content: "", toolCalls: [{ id: "c", name: "tool_search", arguments: '{"query":"wwww"}' }] },
      { content: "ok" },
    ];

    async function stepped(run: ReturnType<typeof build>, after?: (tick: number) => void) {
      let outcome = await runAgent({ task: TASK, policy: TEST_POLICY, ports: run.ports, maxSteps: 1 });
      for (let tick = 1; outcome.kind === "yielded" && tick < 20; tick += 1) {
        after?.(tick);
        outcome = await runAgent({ task: TASK, policy: TEST_POLICY, ports: run.ports, resume: run.saved(), maxSteps: 1 });
      }
      return outcome;
    }

    it("a multi-tick run's single row counts every tick's tool calls, and equals the continuous run's row", async () => {
      const continuous = build(turns());
      expect((await runAgent({ task: TASK, policy: TEST_POLICY, ports: continuous.ports })).kind).toBe("finished");
      const ticked = build(turns());
      expect((await stepped(ticked)).kind).toBe("finished");

      expect(continuous.rows).toHaveLength(1);
      expect(ticked.rows).toHaveLength(1);
      expect(continuous.rows[0]!.toolCalls).toBe(3);
      expect(ticked.rows[0]!.toolCalls).toBe(3);
      expect(ticked.rows[0]).toEqual(continuous.rows[0]);
    });

    it("carries the tally in the saved state, and a cursor that carries none starts from zero", async () => {
      const run = build(turns());
      const outcome = await stepped(run, (tick) => {
        // After the first tick, the saved state holds that tick's one call.
        if (tick === 1) expect(run.saved()?.telemetry?.toolCalls).toBe(1);
        // A legacy cursor never carried a tally: the resumed run counts from here.
        if (tick === 2) delete run.saved()!.telemetry;
      });
      expect(outcome.kind).toBe("finished");
      expect(run.rows).toHaveLength(1);
      expect(run.rows[0]!.toolCalls).toBe(2);
    });
  });

  it("reports the advertised tool set once across ticks — only a real change repeats it", async () => {
    const run = build([
      { content: "", toolCalls: [{ id: "a", name: "tool_search", arguments: '{"query":"zzzz"}' }] },
      { content: "", toolCalls: [{ id: "b", name: "tool_search", arguments: '{"query":"qqqq"}' }] },
      { content: "ok" },
    ]);
    let outcome = await runAgent({ task: TASK, policy: TEST_POLICY, ports: run.ports, maxSteps: 1 });
    for (let tick = 0; outcome.kind === "yielded" && tick < 20; tick += 1) {
      outcome = await runAgent({ task: TASK, policy: TEST_POLICY, ports: run.ports, resume: run.saved(), maxSteps: 1 });
    }
    expect(kinds(run.events).filter((k) => k === "context.tools")).toHaveLength(1);
  });
});

describe("an exception the surface will re-throw is not the run's end", () => {
  it("fails with the exception as its cause, and writes no outcome row, no run.finished and no memory", async () => {
    const eviction = new Error("Durable Object reset because its code was updated.");
    const commit = vi.fn();
    const run = build([eviction], { commit });
    const outcome = await runAgent({ task: TASK, policy: TEST_POLICY, ports: run.ports });
    expect(outcome).toMatchObject({ kind: "failed", cause: eviction });
    expect(run.rows).toHaveLength(0);
    expect(kinds(run.events)).not.toContain("run.finished");
    expect(commit).not.toHaveBeenCalled();
  });
});

describe("a budget that ends a run marks it exhausted", () => {
  it("a spent step budget with nothing to say fails exhausted", async () => {
    const run = build([
      { content: "", toolCalls: [{ id: "a", name: "tool_search", arguments: '{"query":"zzzz"}' }] },
      { content: "" },
    ]);
    const policy: RunPolicy = { ...TEST_POLICY, budgets: { steps: 1 } };
    const outcome = await runAgent({ task: TASK, policy, ports: run.ports });
    expect(outcome).toMatchObject({ kind: "failed", exhausted: true });
  });
});

describe("a stall with nothing left to try, per host", () => {
  const narrate: ModelCompletion = { content: "I will now read the file and then I will update it accordingly." };

  it("ends the run unfinished by default", async () => {
    const run = build([narrate]);
    const outcome = await runAgent({ task: TASK, policy: TEST_POLICY, ports: run.ports });
    expect(outcome.kind).toBe("failed");
  });

  it("finishes with what it said and the notice when the host lands runs", async () => {
    const run = build([narrate]);
    const policy: RunPolicy = { ...TEST_POLICY, stallExhausted: "finish" };
    const outcome = await runAgent({ task: TASK, policy, ports: run.ports });
    expect(outcome.kind).toBe("finished");
    if (outcome.kind === "finished") expect(outcome.output).toContain("I will now read the file");
  });
});
