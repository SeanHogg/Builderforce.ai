import { describe, expect, it, vi } from "vitest";
import { STOPPED_TURN_STEP } from "@seanhogg/builderforce-brain-embedded";
import { createMemoryLocalFirstStore, type ExecutionValue } from "@builderforce/local-first";
import { MID_TURN_META_KEY } from "@builderforce/agent-loop";
import { createHostRunLifecycle, settledAnswerOf, terminalStatusOf, type RunOutcomeSnapshot } from "./hostRunLifecycle";
import { installRunRecovery, type RunRecoveryHostContext } from "./installRunRecovery";

const at = new Date("2026-10-19T10:00:00.000Z");

function ctx(): RunRecoveryHostContext {
  return { globalState: { get: () => undefined, update: async () => undefined } };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("host run lifecycle", () => {
  it("decides the terminal status from the host's event and the run cell", () => {
    const started = at.toISOString();
    const clean: RunOutcomeSnapshot = { error: "", trace: [] };
    expect(terminalStatusOf({ type: "run.settled", chatId: 1 }, clean, started)).toBe("completed");
    expect(terminalStatusOf({ type: "run.failed", chatId: 1, error: "no catalog" }, clean, started)).toBe("failed");
    expect(terminalStatusOf({ type: "run.settled", chatId: 1 }, { error: "gateway 500", trace: [] }, started)).toBe("failed");
    const stopped = { error: "aborted", trace: [{ label: STOPPED_TURN_STEP, ts: "2026-10-19T10:00:05.000Z" }] };
    expect(terminalStatusOf({ type: "run.settled", chatId: 1 }, stopped, started)).toBe("cancelled");
    // A Stop from an EARLIER run of the same chat does not cancel this one.
    const earlierStop = { error: "", trace: [{ label: STOPPED_TURN_STEP, ts: "2026-10-19T09:00:00.000Z" }] };
    expect(terminalStatusOf({ type: "run.settled", chatId: 1 }, earlierStop, started)).toBe("completed");
  });

  it("settledAnswerOf reads only THIS run's final answer, and lets only a completed run learn", () => {
    const started = at.toISOString();
    const row = (id: number, content: string, extra: { role?: string; metadata?: string | null } = {}) => ({ id, role: "assistant", content, ...extra });
    const prior = row(1, "Last run's answer.");
    const seen = new Set([1]);
    // A run that ended without writing a row must not pick the previous run's answer out of the cell's buffer.
    expect(settledAnswerOf(1, { error: "", trace: [], appended: [prior] }, started, seen)).toEqual({ learn: true });
    // This run's own answer, after the earlier one; a child's mid-turn report is not the answer.
    const child = row(3, "**Child → Owner:** done", { metadata: JSON.stringify({ [MID_TURN_META_KEY]: true }) });
    expect(settledAnswerOf(1, { error: "", trace: [], appended: [prior, row(2, "The real answer."), child] }, started, seen)).toEqual({ learn: true, answer: "The real answer." });
    // The parent wrote no answer; a child's report (lineage attribution in its metadata) is not one, mid-turn flag or not.
    const report = row(4, "The child finished its part.", { metadata: JSON.stringify({ subagentOf: { handle: "c1", owner: "BuilderForce", label: "tests" } }) });
    expect(settledAnswerOf(1, { error: "", trace: [], appended: [prior, report] }, started, seen)).toEqual({ learn: true });
    // A metadata flag that is not set (midTurn: false) does not disqualify the parent's real answer.
    const notMid = row(5, "The parent's answer.", { metadata: JSON.stringify({ [MID_TURN_META_KEY]: false }) });
    expect(settledAnswerOf(1, { error: "", trace: [], appended: [prior, notMid] }, started, seen)).toEqual({ learn: true, answer: "The parent's answer." });
    // A USD-cap stop is not a settled answer.
    const capped = { error: "", trace: [{ label: "run.budget_contained", ts: "2026-10-19T10:00:05.000Z" }], appended: [row(2, "Stopped at the cap.")] };
    expect(settledAnswerOf(1, capped, started, seen)).toEqual({ learn: true });
    // So is the forced closing answer of a run the failure breaker stopped: the loop records that turn as `llm.complete { forcedFinish }`.
    const forced = (ts: string) => ({ label: "llm.complete", category: "llm", ts, args: { forcedFinish: true, failureStreak: 5 } });
    const closed = { error: "", trace: [forced("2026-10-19T10:00:05.000Z")], appended: [row(2, "I could not finish: the calls failed.")] };
    expect(settledAnswerOf(1, closed, started, seen)).toEqual({ learn: true });
    // …however the failures were counted: malformed calls trace as `error` steps, not failed tool steps, and still trip the breaker.
    const malformed = Array.from({ length: 5 }, () => ({ label: "agent.malformed_call", category: "error", ts: "2026-10-19T10:00:04.000Z", isError: true }));
    expect(settledAnswerOf(1, { error: "", trace: [...malformed, forced("2026-10-19T10:00:05.000Z")], appended: [row(2, "Forced reply.")] }, started, seen)).toEqual({ learn: true });
    // A forced finish from an EARLIER run of the chat does not strip this run's answer; an ordinary completion does not either.
    const earlier = { error: "", trace: [forced("2026-10-19T09:00:00.000Z")], appended: [row(2, "A real answer.")] };
    expect(settledAnswerOf(1, earlier, started, seen)).toEqual({ learn: true, answer: "A real answer." });
    const ordinary = { error: "", trace: [{ label: "llm.complete", category: "llm", ts: "2026-10-19T10:00:05.000Z", args: { step: 1 } }], appended: [row(2, "Ordinary answer.")] };
    expect(settledAnswerOf(1, ordinary, started, seen)).toEqual({ learn: true, answer: "Ordinary answer." });
    // Failed and cancelled runs never learn.
    expect(settledAnswerOf(1, { error: "gateway 500", trace: [], appended: [row(2, "x")] }, started, seen)).toEqual({ learn: false });
    const stopped = { error: "", trace: [{ label: STOPPED_TURN_STEP, ts: "2026-10-19T10:00:05.000Z" }], appended: [row(2, "x")] };
    expect(settledAnswerOf(1, stopped, started, seen)).toEqual({ learn: false });
  });

  it("journals start, checkpoints, and the terminal status, so the next activation recovers nothing", async () => {
    const store = createMemoryLocalFirstStore();
    const recovery = installRunRecovery(ctx(), { store, deviceId: "device-1", now: () => at });
    await recovery.recovered;
    const snapshots = new Map<number, RunOutcomeSnapshot>([[7, { error: "", trace: [] }]]);
    const log = vi.fn();
    const lifecycle = createHostRunLifecycle({ recovery, snapshot: (chatId) => snapshots.get(chatId)!, log, now: () => at });

    lifecycle.started(7, "host-run:7:a");
    await settle();
    lifecycle.sink.post({ type: "run.tool", chatId: 7, name: "read_file", mutating: false, remote: false, ok: true });
    await settle();
    let row = await store.read((tx) => tx.get<ExecutionValue>("execution", "host-run:7:a"));
    expect(row?.payload.checkpoint).toEqual({ step: 1, safeToResume: true });

    lifecycle.sink.post({ type: "run.tool", chatId: 7, name: "write_file", mutating: true, remote: false, ok: true });
    await settle();
    row = await store.read((tx) => tx.get<ExecutionValue>("execution", "host-run:7:a"));
    expect(row?.payload.checkpoint).toEqual({ step: 2, safeToResume: false });

    // A sub-agent's events (a key this host did not start) are ignored.
    lifecycle.sink.post({ type: "run.settled", chatId: -99 });
    lifecycle.sink.post({ type: "run.settled", chatId: 7 });
    await settle();
    row = await store.read((tx) => tx.get<ExecutionValue>("execution", "host-run:7:a"));
    expect(row?.payload.status).toBe("completed");
    expect(log).not.toHaveBeenCalled();

    const nextActivation = installRunRecovery(ctx(), { store, deviceId: "device-1", now: () => at });
    expect(await nextActivation.recovered).toEqual([]);
  });

  it("journals a Stop during the run as cancelled, which the next activation leaves alone", async () => {
    const store = createMemoryLocalFirstStore();
    const recovery = installRunRecovery(ctx(), { store, deviceId: "device-1", now: () => at });
    const stopped = { error: "aborted", trace: [{ label: STOPPED_TURN_STEP, ts: "2026-10-19T10:00:05.000Z" }] };
    const lifecycle = createHostRunLifecycle({ recovery, snapshot: () => stopped, log: vi.fn(), now: () => at });
    lifecycle.started(5, "host-run:5:c");
    await settle();
    lifecycle.sink.post({ type: "run.settled", chatId: 5 });
    await settle();
    const row = await store.read((tx) => tx.get<ExecutionValue>("execution", "host-run:5:c"));
    expect(row?.payload.status).toBe("cancelled");
    const nextActivation = installRunRecovery(ctx(), { store, deviceId: "device-1", now: () => at });
    expect(await nextActivation.recovered).toEqual([]);
  });

  it("leaves a run the host died inside to be recovered as interrupted", async () => {
    const store = createMemoryLocalFirstStore();
    const recovery = installRunRecovery(ctx(), { store, deviceId: "device-1", now: () => at });
    const lifecycle = createHostRunLifecycle({ recovery, snapshot: () => ({ error: "", trace: [] }), log: vi.fn() });
    lifecycle.started(3, "host-run:3:b");
    await settle();
    const nextActivation = installRunRecovery(ctx(), { store, deviceId: "device-1", now: () => at });
    expect((await nextActivation.recovered).map((run) => run.runId)).toEqual(["host-run:3:b"]);
  });

  it("journals a completed run its finalize gate holds as awaiting_input with the hold, which the next activation leaves alone (PRD 41 §12.5)", async () => {
    const store = createMemoryLocalFirstStore();
    const recovery = installRunRecovery(ctx(), { store, deviceId: "device-1", now: () => at });
    const hold = { reason: "run_delta_blocking:guard-removed", rules: ["guard-removed"] };
    const beforeTerminal = vi.fn(async () => hold);
    const lifecycle = createHostRunLifecycle({ recovery, snapshot: () => ({ error: "", trace: [] }), log: vi.fn(), now: () => at, beforeTerminal });
    lifecycle.started(4, "host-run:4:held");
    await settle();
    lifecycle.sink.post({ type: "run.settled", chatId: 4 });
    await settle();
    expect(beforeTerminal).toHaveBeenCalledWith({ runId: "host-run:4:held", chatId: 4, status: "completed" });
    const row = await store.read((tx) => tx.get<ExecutionValue>("execution", "host-run:4:held"));
    expect(row?.payload.status).toBe("awaiting_input");
    expect(row?.payload.hold).toEqual(hold);
    const snapshot = await store.export();
    const held = snapshot.events.filter((e) => e.entityType === "execution" && e.clientEntityId === "host-run:4:held" && e.operation === "update");
    expect(held.map((e) => e.payload)).toEqual([{ status: "awaiting_input", hold }]);
    const nextActivation = installRunRecovery(ctx(), { store, deviceId: "device-1", now: () => at });
    expect(await nextActivation.recovered).toEqual([]);
  });

  it("never holds a failed run, whatever the gate says, and finishes a run the gate does not hold", async () => {
    const store = createMemoryLocalFirstStore();
    const recovery = installRunRecovery(ctx(), { store, deviceId: "device-1", now: () => at });
    const failing = { error: "gateway 500", trace: [] };
    const lifecycle = createHostRunLifecycle({
      recovery, snapshot: (chatId) => (chatId === 8 ? failing : { error: "", trace: [] }), log: vi.fn(), now: () => at,
      beforeTerminal: async ({ status }) => (status === "failed" ? { reason: "run_delta_blocking:guard-removed", rules: ["guard-removed"] } : undefined),
    });
    lifecycle.started(8, "host-run:8:failed");
    lifecycle.started(9, "host-run:9:clean");
    await settle();
    lifecycle.sink.post({ type: "run.settled", chatId: 8 });
    lifecycle.sink.post({ type: "run.settled", chatId: 9 });
    await settle();
    const failed = await store.read((tx) => tx.get<ExecutionValue>("execution", "host-run:8:failed"));
    expect(failed?.payload).toMatchObject({ status: "failed" });
    expect(failed?.payload.hold).toBeUndefined();
    const clean = await store.read((tx) => tx.get<ExecutionValue>("execution", "host-run:9:clean"));
    expect(clean?.payload.status).toBe("completed");
  });

  it("tells onTerminal once the terminal write landed, with the hold when it was held (what a release waits on)", async () => {
    const store = createMemoryLocalFirstStore();
    const recovery = installRunRecovery(ctx(), { store, deviceId: "device-1", now: () => at });
    const hold = { reason: "run_delta_unmeasured", rules: [] };
    const seen: Array<{ runId: string; hold?: unknown; status?: string }> = [];
    const lifecycle = createHostRunLifecycle({
      recovery, snapshot: () => ({ error: "", trace: [] }), log: vi.fn(), now: () => at,
      beforeTerminal: async ({ runId }) => (runId === "host-run:10:held" ? hold : undefined),
      onTerminal: (run) => {
        // The write is already in the store when this is told.
        void store.read((tx) => tx.get<ExecutionValue>("execution", run.runId)).then((row) => seen.push({ ...run, status: row?.payload.status }));
      },
    });
    lifecycle.started(10, "host-run:10:held");
    lifecycle.started(11, "host-run:11:done");
    await settle();
    lifecycle.sink.post({ type: "run.settled", chatId: 10 });
    lifecycle.sink.post({ type: "run.settled", chatId: 11 });
    await settle();
    await settle();
    expect(seen).toEqual(expect.arrayContaining([
      { runId: "host-run:10:held", hold, status: "awaiting_input" },
      { runId: "host-run:11:done", status: "completed" },
    ]));
  });
});
