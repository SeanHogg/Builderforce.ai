/**
 * The surface decides which exception is a resumable interruption - at the END of a run too: an exception thrown while the run
 * consolidates its memory, or in the forced synthesis turn, is classified exactly like one thrown mid-run.
 */
import { describe, expect, it } from "vitest";
import type { ModelCompletion, RunEvent, RunOutcomeRow, RunPolicy, RunPorts } from "../../src/contract.js";
import { defaultPolicyModules } from "../../src/index.js";
import { runAgent } from "../../src/runAgent.js";
import { TEST_POLICY } from "../support/policyContext.js";

const TASK = { prompt: "Do the work.", dispatch: { source: "chat" as const } };
const eviction = new Error("Durable Object reset because its code was updated.");
const evicted = (err: unknown) => err === eviction;

function build(turns: Array<ModelCompletion | Error>, resumable?: (err: unknown) => boolean) {
  const rows: RunOutcomeRow[] = [];
  const events: RunEvent[] = [];
  let i = 0;
  const ports: RunPorts = {
    model: { complete: async () => { const t = turns[Math.min(i++, turns.length - 1)]!; if (t instanceof Error) throw t; return t; } },
    capabilities: { capabilities: new Set() },
    store: { load: () => undefined, save: () => undefined, ...(resumable ? { isResumable: resumable } : {}) },
    events: { emit: (e) => { events.push(e); }, outcome: (r) => { rows.push(r); } },
    human: { ask: async () => ({ kind: "paused" }) },
    context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
  };
  return { ports, rows, events };
}

const throwingMemory = (error: Error) => ({
  memory: { ...defaultPolicyModules.memory, consolidate: async () => { throw error; } },
});

describe("an exception while the run consolidates its memory", () => {
  it("a resumable one resumes the run: failed with the cause, no row, no run.finished", async () => {
    const run = build([{ content: "all done" }], evicted);
    const outcome = await runAgent({ task: TASK, policy: TEST_POLICY, ports: run.ports, modules: throwingMemory(eviction) });
    expect(outcome).toMatchObject({ kind: "failed", cause: eviction });
    expect(run.rows).toHaveLength(0);
    expect(run.events.some((e) => e.kind === "run.finished")).toBe(false);
  });

  it("any other one leaves memory best-effort: the run still finishes, with its row", async () => {
    const run = build([{ content: "all done" }], evicted);
    const outcome = await runAgent({ task: TASK, policy: TEST_POLICY, ports: run.ports, modules: throwingMemory(new Error("memory db down")) });
    expect(outcome.kind).toBe("finished");
    expect(run.rows).toHaveLength(1);
  });
});

describe("an exception in the forced synthesis turn", () => {
  const spent: RunPolicy = { ...TEST_POLICY, budgets: { steps: 1 } };
  const tool: ModelCompletion = { content: "", toolCalls: [{ id: "a", name: "list_files", arguments: "{}" }] };

  it("a resumable one settles the run failed WITH the cause (the host re-arms it)", async () => {
    const run = build([tool, eviction], evicted);
    const outcome = await runAgent({ task: TASK, policy: spent, ports: run.ports });
    expect(outcome).toMatchObject({ kind: "failed", cause: eviction });
    expect(run.rows).toHaveLength(0);
  });

  it("any other one is not a cause: the exhausted run fails terminal, with its row", async () => {
    const run = build([tool, new Error("gateway parse error")], evicted);
    const outcome = await runAgent({ task: TASK, policy: spent, ports: run.ports });
    expect(outcome.kind).toBe("failed");
    expect(outcome).not.toHaveProperty("cause");
    expect(run.rows).toHaveLength(1);
  });
});
