import { describe, expect, it, vi } from "vitest";
import { createMemoryLocalFirstStore, type ExecutionValue } from "@builderforce/local-first";
import { recordRunChildren } from "./childRunJournal";
import type { PersistedChild } from "./childLedger";
import { createHostRunLifecycle, type RunOutcomeSnapshot } from "./hostRunLifecycle";
import { installRunRecovery, type RunRecoveryHostContext } from "./installRunRecovery";
import { interruptedResumeTurn, RESUME_TURN_DEFAULTS } from "./interruptedResumeTurn";
import { toInterruptedRunView } from "./interruptedRunsView";
import { liveChildrenBlock } from "./liveChildrenFinish";
import { recordRunFinished, recordRunStarted, recoverInterruptedRuns } from "./runRecovery";

const at = new Date("2026-11-08T10:00:00.000Z");
const deps = { deviceId: "device-1", now: () => at };
const english = (_key: string, fallback: string): string => fallback;

function ctx(): RunRecoveryHostContext {
  return { globalState: { get: () => undefined, update: async () => undefined } };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

const child = (over: Partial<PersistedChild>): PersistedChild => ({
  handle: "a1", label: "audit", owner: "BuilderForce", brief: "Audit the legend.", role: "reviewer", state: "running", ...over,
});

describe("stateful resume of an interrupted run (chat #61651)", () => {
  it("journals the ask, plan, files and last steps, and Resume continues from them - never the bare headline", async () => {
    const store = createMemoryLocalFirstStore();
    const recovery = installRunRecovery(ctx(), { store, deviceId: "device-1", now: () => at });
    await recovery.recovered;
    const trace: RunOutcomeSnapshot["trace"] = [
      { ts: "2026-11-08T10:00:01.000Z", category: "tool", label: "update_task_state", args: { goal: "Fix the legend overlap" }, result: { ok: true } },
      { ts: "2026-11-08T10:00:02.000Z", category: "tool", label: "edit_file", args: { path: "src/Legend.tsx", old: "a", new: "b" }, result: { ok: true } },
      // An EARLIER run of the same chat is not this run's.
      { ts: "2026-11-08T09:00:00.000Z", category: "tool", label: "edit_file", args: { path: "src/Other.tsx", old: "a", new: "b" }, result: { ok: true } },
    ];
    const lifecycle = createHostRunLifecycle({ recovery, snapshot: () => ({ error: "", trace }), log: vi.fn(), now: () => at });
    lifecycle.started(9, "host-run:9:a", "Fix the visualizer legend overlap");
    await settle();
    lifecycle.sink.post({ type: "run.tool", chatId: 9, name: "edit_file", mutating: true, remote: false, ok: true });
    await settle();

    // The editor dies: the next activation recovers the run, and its row carries the resume.
    const [run] = await recoverInterruptedRuns(store, deps);
    const view = toInterruptedRunView(run!);
    expect(view.resume).toMatchObject({ ask: "Fix the visualizer legend overlap", files: ["src/Legend.tsx"] });
    const turn = interruptedResumeTurn(english, view.resume);
    expect(turn).toContain("> Fix the visualizer legend overlap");
    expect(turn).toContain("Goal: Fix the legend overlap");
    expect(turn).toContain("- src/Legend.tsx");
    expect(turn).not.toContain("src/Other.tsx");
    expect(turn).toContain(RESUME_TURN_DEFAULTS["ir.continueScope"]);
    expect(turn).not.toBe(RESUME_TURN_DEFAULTS["ir.continue"]);
  });

  it("tells the resumed run what became of its sub-agents (describeInterruptedChildren)", async () => {
    const store = createMemoryLocalFirstStore();
    await recordRunStarted(store, deps, { runId: "r1", chatId: "4", state: { ask: "Audit it" } });
    await recordRunChildren(store, { chatId: "4", children: [child({})], now: () => at });
    const [run] = await recoverInterruptedRuns(store, deps);
    const turn = interruptedResumeTurn(english, toInterruptedRunView(run!).resume);
    expect(turn).toContain("a1 (audit");
    expect(turn).toContain("died with the editor");
  });

  it("regression: chat #61651 — the resume turn carries THIS chat's ask, never another session's", async () => {
    const store = createMemoryLocalFirstStore();
    await recordRunStarted(store, deps, { runId: "mine", chatId: "61651", state: { ask: "Fix the legend overlap" } });
    await recordRunStarted(store, deps, { runId: "theirs", chatId: "70000", state: { ask: "Rewrite the billing page" } });
    const runs = await recoverInterruptedRuns(store, deps);
    const mine = runs.find((run) => run.runId === "mine")!;
    const turn = interruptedResumeTurn(english, toInterruptedRunView(mine).resume);
    expect(turn).toContain("> Fix the legend overlap");
    expect(turn).not.toContain("billing");
    expect(turn).toContain(RESUME_TURN_DEFAULTS["ir.continueScope"]);
  });

  it("words the sub-agents in the person's language through the ir.* labels, keeping the data literal", async () => {
    const store = createMemoryLocalFirstStore();
    await recordRunStarted(store, deps, { runId: "r9", chatId: "9", state: { ask: "Audit it" } });
    await recordRunChildren(store, { chatId: "9", children: [child({})], now: () => at });
    const [run] = await recoverInterruptedRuns(store, deps);
    const german = (key: string, fallback: string): string => (key === "ir.childStartedBy" ? "gestartet von {owner}" : fallback);
    const turn = interruptedResumeTurn(german, toInterruptedRunView(run!).resume);
    expect(turn).toContain("a1 (audit; gestartet von BuilderForce)");
    expect(turn).toContain("Audit the legend.");
  });

  it("keeps the headline alone for a run that journaled nothing (an older record)", async () => {
    expect(interruptedResumeTurn(english, undefined)).toBe(RESUME_TURN_DEFAULTS["ir.continue"]);
  });

  it("surfaces a COMPLETED parent whose sub-agents were still running when the editor died", async () => {
    const store = createMemoryLocalFirstStore();
    await recordRunStarted(store, deps, { runId: "parent", chatId: "5" });
    await recordRunChildren(store, { chatId: "5", children: [child({ handle: "b2" })], now: () => at });
    await recordRunFinished(store, deps, { runId: "parent", status: "completed" });
    // A completed parent whose children all finished stays finished.
    await recordRunStarted(store, deps, { runId: "done", chatId: "6" });
    await recordRunChildren(store, { chatId: "6", children: [child({ state: "done", report: undefined })], now: () => at });
    await recordRunFinished(store, deps, { runId: "done", status: "completed" });

    const recovered = await recoverInterruptedRuns(store, deps);
    expect(recovered.map((run) => run.runId)).toEqual(["parent"]);
    const row = await store.read((tx) => tx.get<ExecutionValue>("execution", "parent"));
    expect(row?.payload.status).toBe("interrupted");
    const untouched = await store.read((tx) => tx.get<ExecutionValue>("execution", "done"));
    expect(untouched?.payload.status).toBe("completed");
  });
});

describe("the owner's live-children finish hold", () => {
  it("blocks while a sub-agent is live, naming it and the tools that resolve it", () => {
    const block = liveChildrenBlock([{ handle: "a1" }, { handle: "a2" }]);
    expect(block).toContain("a1, a2");
    expect(block).toContain("wait_agents");
    expect(block).toContain("stop_agent");
  });

  it("lets the owner finish when none is live", () => {
    expect(liveChildrenBlock([])).toBeNull();
  });
});
