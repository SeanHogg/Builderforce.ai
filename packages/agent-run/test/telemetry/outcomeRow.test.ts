/**
 * WS6 — the §8.2 uniform outcome row (PRD 35).
 *
 * Every field of the row is read back from the ONE writer the run has for it; these
 * cases pin each field to its source, then prove end to end that the driver writes ONE
 * row per run — at the end, never on a yielded tick — and that a run driven one tick at
 * a time totals what the same run driven continuously totals.
 */
import { describe, expect, it } from "vitest";
import type { Capability } from "@builderforce/agent-tools";
import {
  buildOutcomeRow,
  freshTally,
  runAgent,
  tallyCall,
  tallyTurn,
  tallyVerify,
  type ModelCompletion,
  type RunOutcomeRow,
  type RunPorts,
  type RunState,
} from "../../src/index.js";
import { freshState } from "../../src/runState.js";
import { TEST_POLICY, TEST_TASK } from "../support/policyContext.js";

function state(): RunState {
  return freshState(TEST_POLICY, TEST_TASK);
}

describe("buildOutcomeRow — each §8.2 field from its source", () => {
  it("a run that did nothing has zero counts, verify not-run and no spawn", () => {
    const row = buildOutcomeRow({ entryPoint: "vscode", kind: "finished", state: state() });
    expect(row).toEqual({
      entryPoint: "vscode",
      steps: 0,
      toolCalls: 0,
      toolErrors: 0,
      compactions: 0,
      stallRecoveries: 0,
      escalations: 0,
      verify: "not-run",
      terminalStatus: "finished",
      tokens: 0,
      cacheReadTokens: 0,
      firstSpawnTurn: null,
      coveredReadStubs: 0,
      shellFileReads: 0,
      repoErrors: 0,
      contextPackTokens: 0,
      unkeptReadyClaims: 0,
      progressTrips: {},
    });
  });

  it("reads every field from the state the run carried", () => {
    const s = state();
    s.step = 7;
    s.telemetry = { ...freshTally(), toolCalls: 12, toolErrors: 3, model: "m-1", tokens: 900, cacheReadTokens: 400, costMc: 25, firstSpawnTurn: 2, shellFileReads: 4, repoErrors: 1, verify: "failed" };
    s.compaction = { compactions: 2 };
    s.stall = { recoveriesUsed: 0, recoveriesTotal: 3 };
    s.guards = { escalations: 1, progress: { trips: 2, tripsBySignal: { no_progress: 1, circling_read: 1 }, unkeptTurns: 5 } };
    s.reads = { ...s.reads, stubCount: 6 };
    s.preflight = "degraded:openai:expired";
    s.context = { focus: [{ path: "a.ts", content: "x".repeat(40) }], facts: [], recall: [] };

    const row = buildOutcomeRow({ entryPoint: "cloud", runId: "run-9", kind: "failed", state: s });
    expect(row).toEqual({
      entryPoint: "cloud",
      runId: "run-9",
      steps: 7,
      toolCalls: 12,
      toolErrors: 3,
      compactions: 2,
      stallRecoveries: 3,
      escalations: 1,
      verify: "failed",
      terminalStatus: "failed",
      model: "m-1",
      tokens: 900,
      cacheReadTokens: 400,
      cost: 25,
      firstSpawnTurn: 2,
      coveredReadStubs: 6,
      shellFileReads: 4,
      repoErrors: 1,
      // "## a.ts\n" + 40 chars = 48 chars → 12 tokens at chars/4.
      contextPackTokens: 12,
      modelPreflight: "degraded:openai:expired",
      unkeptReadyClaims: 5,
      progressTrips: { no_progress: 1, circling_read: 1 },
    });
  });

  it("a state saved before the tally existed still builds a full row", () => {
    const s = state();
    delete s.telemetry;
    const row = buildOutcomeRow({ entryPoint: "web", kind: "finished", state: s });
    expect(row.toolCalls).toBe(0);
    expect(row.tokens).toBe(0);
    expect(row.verify).toBe("not-run");
  });
});

describe("the run tally — what each fact adds", () => {
  it("sums every turn's usage and keeps the last served model", () => {
    const t = freshTally();
    tallyTurn(t, "m-1", { inputTokens: 100, outputTokens: 20, cacheReadTokens: 60, costMc: 5 });
    tallyTurn(t, "m-2", { inputTokens: 50, outputTokens: 10 });
    tallyTurn(t, undefined, undefined);
    expect(t).toMatchObject({ model: "m-2", tokens: 180, cacheReadTokens: 60, costMc: 5 });
  });

  it("leaves cost absent when no transport reported one", () => {
    const t = freshTally();
    tallyTurn(t, "m-1", { inputTokens: 10, outputTokens: 1 });
    expect(t.costMc).toBeUndefined();
  });

  it("counts calls and errors from the dispatch verdict", () => {
    const t = freshTally();
    tallyCall(t, 1, "read_file", { path: "a.ts" }, { ok: true }, true);
    tallyCall(t, 1, "read_file", { path: "b.ts" }, { ok: false, error: "missing" }, false);
    expect(t).toMatchObject({ toolCalls: 2, toolErrors: 1 });
  });

  it("records the step of the FIRST spawn only", () => {
    const t = freshTally();
    tallyCall(t, 3, "spawn_agent", {}, { ok: true }, true);
    tallyCall(t, 5, "spawn_agents", {}, { ok: true }, true);
    expect(t.firstSpawnTurn).toBe(3);
  });

  it("counts a shell print of one workspace file, through an alias too, and nothing else", () => {
    const t = freshTally();
    tallyCall(t, 1, "run_command", { command: "sed -n '10,40p' src/a.ts" }, { ok: true }, true);
    tallyCall(t, 1, "bash", { command: "cat README.md" }, { ok: true }, true);
    tallyCall(t, 1, "run_command", { command: "npm test" }, { ok: true }, true);
    tallyCall(t, 1, "run_command", { command: "cat a.ts | grep x" }, { ok: true }, true);
    tallyCall(t, 1, "read_file", { command: "cat a.ts" }, { ok: true }, true);
    expect(t.shellFileReads).toBe(2);
  });

  it("counts a failed call that answered not-a-repo, from its error or its output", () => {
    const t = freshTally();
    tallyCall(t, 1, "git_status", {}, { ok: false, error: "not a git repository at the workspace root" }, false);
    tallyCall(t, 1, "run_command", { command: "git log" }, { ok: false, stdout: "", stderr: "fatal: not a git repository (or any of the parent directories): .git" }, false);
    tallyCall(t, 1, "run_command", { command: "npm test" }, { ok: false, error: "exit 1" }, false);
    expect(t.repoErrors).toBe(2);
  });

  it("records the run-end verify's verdict", () => {
    const t = freshTally();
    tallyVerify(t, false);
    expect(t.verify).toBe("failed");
    tallyVerify(t, true);
    expect(t.verify).toBe("passed");
  });
});

// ── End to end: one row per run ────────────────────────────────────────────────

const callTool = (): ModelCompletion => ({ content: "", toolCalls: [{ id: "c1", name: "list_files", arguments: "{}" }], usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 40 }, model: "m-1" });
const finish = (): ModelCompletion => ({ content: "Done.", usage: { inputTokens: 120, outputTokens: 5 }, model: "m-1" });

function ports(answers: Array<() => ModelCompletion>, rows: RunOutcomeRow[], store: { saved?: RunState }): RunPorts {
  let n = 0;
  return {
    model: {
      complete: async () => {
        const answer = answers[n];
        n += 1;
        if (!answer) throw new Error("script exhausted");
        return answer();
      },
    },
    capabilities: { capabilities: new Set<Capability>() },
    store: { load: () => store.saved, save: (s) => void (store.saved = JSON.parse(JSON.stringify(s)) as RunState) },
    events: { emit: () => undefined, outcome: (row) => void rows.push(row) },
    human: { ask: async () => ({ kind: "paused" }) },
    context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
  };
}

describe("the driver writes ONE row per run", () => {
  it("a continuous run writes one row, with the whole run's counts", async () => {
    const rows: RunOutcomeRow[] = [];
    const outcome = await runAgent({ task: { ...TEST_TASK, runId: "r-1" }, policy: TEST_POLICY, ports: ports([callTool, callTool, finish], rows, {}) });
    expect(outcome.kind).toBe("finished");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entryPoint: "vscode", runId: "r-1", terminalStatus: "finished", toolCalls: 2, toolErrors: 2, tokens: 345, cacheReadTokens: 80, model: "m-1", verify: "not-run" });
  });

  it("a run driven one tick at a time writes no row on a yielded tick, and the same row at the end", async () => {
    const continuous: RunOutcomeRow[] = [];
    await runAgent({ task: TEST_TASK, policy: TEST_POLICY, ports: ports([callTool, callTool, finish], continuous, {}) });

    const stepped: RunOutcomeRow[] = [];
    const store: { saved?: RunState } = {};
    const answers = [callTool, callTool, finish];
    let tick = 0;
    let outcome = await runAgent({ task: TEST_TASK, policy: TEST_POLICY, ports: ports(answers.slice(tick, tick + 1), stepped, store), maxSteps: 1 });
    while (outcome.kind === "yielded") {
      expect(stepped).toHaveLength(0);
      tick += 1;
      if (tick > 10) throw new Error("run never finished");
      outcome = await runAgent({ task: TEST_TASK, policy: TEST_POLICY, ports: ports(answers.slice(tick, tick + 1), stepped, store), resume: store.saved, maxSteps: 1 });
    }
    expect(outcome.kind).toBe("finished");
    expect(stepped).toHaveLength(1);
    expect(stepped[0]).toEqual(continuous[0]);
  });

  it("a failed run writes its row", async () => {
    const rows: RunOutcomeRow[] = [];
    const outcome = await runAgent({ task: TEST_TASK, policy: TEST_POLICY, ports: ports([], rows, {}) });
    expect(outcome.kind).toBe("failed");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.terminalStatus).toBe("failed");
  });
});
