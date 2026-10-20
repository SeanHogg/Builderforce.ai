import { describe, expect, it, vi } from "vitest";
import { STOPPED_TURN_STEP } from "@seanhogg/builderforce-brain-embedded";
import { createMemoryLocalFirstStore, type ExecutionValue } from "@builderforce/local-first";
import { createHostRunLifecycle, terminalStatusOf, type RunOutcomeSnapshot } from "./hostRunLifecycle";
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
});
