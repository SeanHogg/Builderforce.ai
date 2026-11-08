import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createMemoryLocalFirstStore, type ExecutionValue, type LocalFirstStore } from "@builderforce/local-first";
import {
  installRunRecovery,
  type RunRecoveryHostContext,
} from "./installRunRecovery";
import {
  listInterruptedRuns,
  recordRunAcknowledged,
  recordRunCheckpoint,
  recordRunFinished,
  recordRunStarted,
  RUN_ID_REQUIRED,
  type RunLifecycleDeps,
} from "./runRecovery";

const at = new Date("2026-10-18T12:00:00.000Z");
const deps: RunLifecycleDeps = { deviceId: "device-1", now: () => at };

function ctx(): RunRecoveryHostContext {
  return { globalState: { get: () => undefined, update: async () => undefined } };
}

function ports(store: LocalFirstStore) {
  return { store, deviceId: "device-1", now: () => at };
}

async function statusOf(store: LocalFirstStore, id: string): Promise<string | undefined> {
  return store.read(async (tx) => (await tx.get<ExecutionValue>("execution", id))?.payload.status);
}

describe("installRunRecovery", () => {
  it("records a cancelled run as terminal, so the next activation does not interrupt it", async () => {
    const store = createMemoryLocalFirstStore();
    await recordRunStarted(store, deps, { runId: "run-stopped" });
    await recordRunFinished(store, deps, { runId: "run-stopped", status: "cancelled" });
    const row = await store.read((tx) => tx.get<ExecutionValue>("execution", "run-stopped"));
    expect(row?.payload.status).toBe("cancelled");
    expect(row?.payload).not.toHaveProperty("outcome");
    const installed = installRunRecovery(ctx(), ports(store));
    expect(await installed.recovered).toEqual([]);
    expect(await statusOf(store, "run-stopped")).toBe("cancelled");
    const events = await store.read((tx) => tx.pending());
    const cancelled = events.find((event) => event.idempotencyKey === "execution:cancelled:run-stopped");
    expect(cancelled?.payload).toEqual({ status: "cancelled" });
    // A later terminal report does not rewrite a cancelled run.
    await recordRunFinished(store, deps, { runId: "run-stopped", status: "failed" });
    expect(await statusOf(store, "run-stopped")).toBe("cancelled");
  });

  it("rejects a start with no run id and writes nothing", async () => {
    const store = createMemoryLocalFirstStore();
    for (const runId of ["", "   ", undefined as unknown as string]) {
      await expect(recordRunStarted(store, deps, { runId })).rejects.toThrow(RUN_ID_REQUIRED);
    }
    const snap = await store.export();
    expect(snap.records).toEqual([]);
    expect(snap.events).toEqual([]);
  });

  it("recovers a running execution as interrupted, never completed", async () => {
    const store = createMemoryLocalFirstStore();
    await recordRunStarted(store, deps, { runId: "run-live", chatId: "chat-1" });
    await recordRunStarted(store, deps, { runId: "run-done" });
    await recordRunFinished(store, deps, { runId: "run-done", status: "completed" });
    await recordRunStarted(store, deps, { runId: "run-failed" });
    await recordRunFinished(store, deps, { runId: "run-failed", status: "failed" });
    await recordRunStarted(store, deps, { runId: "run-queued" });
    await store.transact(async (tx) => {
      const queued = (await tx.get<ExecutionValue>("execution", "run-queued"))!;
      await tx.put<ExecutionValue>({ ...queued, version: queued.version + 1, payload: { ...queued.payload, status: "queued" } }, queued.version);
    });
    await recordRunStarted(store, deps, { runId: "run-waiting" });
    await store.transact(async (tx) => {
      const waiting = (await tx.get<ExecutionValue>("execution", "run-waiting"))!;
      await tx.put<ExecutionValue>(
        { ...waiting, version: waiting.version + 1, payload: { ...waiting.payload, status: "awaiting_input" } },
        waiting.version,
      );
    });

    const installed = installRunRecovery(ctx(), ports(store));
    const recovered = await installed.recovered;
    const ids = recovered.map((run) => run.runId).sort();

    expect(ids).toEqual(["run-live", "run-queued", "run-waiting"]);
    for (const run of recovered) {
      expect(run.record.payload.status).toBe("interrupted");
      expect(run.record.payload.status).not.toBe("completed");
    }
    expect(await statusOf(store, "run-live")).toBe("interrupted");
    expect(await statusOf(store, "run-done")).toBe("completed");
    expect(await statusOf(store, "run-failed")).toBe("failed");

    const snap = await store.export();
    const completedEvents = snap.events.filter((event) => event.idempotencyKey?.includes(":completed:"));
    expect(completedEvents.map((event) => event.clientEntityId)).toEqual(["run-done"]);
    expect(snap.events.some((event) => event.idempotencyKey?.startsWith("execution:interrupted:"))).toBe(true);
  });

  it("journals a host start, and a restarted context recovers it as interrupted rather than completed", async () => {
    const store = createMemoryLocalFirstStore();
    const first = installRunRecovery(ctx(), ports(store));
    await first.recovered;
    await first.recordStarted({ runId: "host-1", chatId: 42, ticketId: 7 });
    expect(await statusOf(store, "host-1")).toBe("running");

    const restarted = installRunRecovery(ctx(), ports(store));
    const recovered = await restarted.recovered;
    expect(recovered.map((run) => run.runId)).toEqual(["host-1"]);
    expect(recovered[0].record.payload.status).toBe("interrupted");
    expect(recovered[0].record.payload.chatId).toBe("42");
    expect(recovered[0].record.payload.ticketId).toBe("7");
    expect(restarted.safeToResume(recovered[0])).toBe(false);
  });

  it("fails if recoverInterruptedRuns is never called from installRunRecovery", () => {
    const source = readFileSync(new URL("./installRunRecovery.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const start = source.indexOf("export function installRunRecovery");
    expect(start).toBeGreaterThanOrEqual(0);
    const body = source.slice(start);
    expect(body).toMatch(/recoverInterruptedRuns\s*\(/);
    expect(body).not.toMatch(/function recoverInterruptedRuns/);
  });

  it("records a started run and, on the next call, recovers it only when safe to resume", async () => {
    const store = createMemoryLocalFirstStore();
    const first = installRunRecovery(ctx(), ports(store));
    await first.recovered;
    await first.recordStarted({ runId: "next-call", chatId: "chat-9" });
    expect(await statusOf(store, "next-call")).toBe("running");

    await recordRunCheckpoint(store, deps, {
      runId: "next-call",
      step: 2,
      safeToResume: true,
      state: {
        pending: [
          { name: "read_file", kind: "read", resultRecorded: true },
          { name: "run_command", kind: "shell" },
        ],
      },
    });

    const next = installRunRecovery(ctx(), ports(store));
    const [run] = await next.recovered;
    expect(run.runId).toBe("next-call");
    expect(run.record.payload.status).toBe("interrupted");
    expect(next.safeToResume(run)).toBe(true);
    expect(await statusOf(store, "next-call")).toBe("interrupted");
  });

  it("does not recover again on the same context, so a start after activation stays running", async () => {
    const store = createMemoryLocalFirstStore();
    const context = ctx();
    const first = installRunRecovery(context, ports(store));
    await first.recovered;
    await first.recordStarted({ runId: "still-live", chatId: "9" });

    const second = installRunRecovery(context, ports(store));
    expect(second).toBe(first);
    await second.recovered;
    expect(await statusOf(store, "still-live")).toBe("running");
  });

  it("lists an interrupted run on later activations until it is acknowledged, then never again", async () => {
    const store = createMemoryLocalFirstStore();
    await recordRunStarted(store, deps, { runId: "dismissed", chatId: "4" });
    await recordRunStarted(store, deps, { runId: "kept", chatId: "5" });

    const first = installRunRecovery(ctx(), ports(store));
    expect((await first.recovered).map((run) => run.runId).sort()).toEqual(["dismissed", "kept"]);

    await first.recordAcknowledged("dismissed");
    expect(await statusOf(store, "dismissed")).toBe("cancelled");
    expect((await listInterruptedRuns(store)).map((run) => run.runId)).toEqual(["kept"]);

    // The next activation: the dismissed run is neither recovered nor listed again.
    const second = installRunRecovery(ctx(), ports(store));
    expect(await second.recovered).toEqual([]);
    expect((await second.interrupted()).map((run) => run.runId)).toEqual(["kept"]);
  });

  it("acknowledges only an interrupted run", async () => {
    const store = createMemoryLocalFirstStore();
    await recordRunStarted(store, deps, { runId: "live" });
    await recordRunAcknowledged(store, deps, { runId: "live" });
    expect(await statusOf(store, "live")).toBe("running");
    await recordRunAcknowledged(store, deps, { runId: "missing" });
    expect(await statusOf(store, "missing")).toBeUndefined();
  });
});
