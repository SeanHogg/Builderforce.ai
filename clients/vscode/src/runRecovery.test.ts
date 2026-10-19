import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createMemoryLocalFirstStore, type ExecutionValue, type LocalFirstStore } from "@builderforce/local-first";
import {
  EXTENSION_ACTIVATION_LINE,
  RUN_HOST_START_LINE,
  installRunRecovery,
  type RunRecoveryHostContext,
} from "./installRunRecovery";
import {
  applyResumePlan,
  recordRunCheckpoint,
  recordRunFinished,
  recordRunStarted,
  type PendingStep,
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

async function executePlan(
  store: LocalFirstStore,
  runId: string,
  execute: (step: PendingStep) => void,
): Promise<string[]> {
  const installed = installRunRecovery(ctx(), ports(store));
  const recovered = await installed.recovered;
  const run = recovered.find((item) => item.runId === runId);
  expect(run).toBeDefined();
  const names: string[] = [];
  await installed.applyResumePlan(installed.resumePlan(run!), async (step) => {
    names.push(step.name ?? "");
    execute(step);
  });
  return names;
}

describe("installRunRecovery", () => {
  it("documents the activation line extension.ts must add, and the host start line", () => {
    expect(EXTENSION_ACTIVATION_LINE).toBe("void installRunRecovery(context);");
    expect(RUN_HOST_START_LINE).toContain("recordStarted");
    expect(RUN_HOST_START_LINE).not.toContain("completed");
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
    const completedEvents = snap.events.filter((event) => event.eventId.includes(":completed:"));
    expect(completedEvents.map((event) => event.clientEntityId)).toEqual(["run-done"]);
    expect(snap.events.some((event) => event.eventId.startsWith("execution:interrupted:"))).toBe(true);
  });

  it("does not re-execute a step whose checkpoint is not safeToResume", async () => {
    const store = createMemoryLocalFirstStore();
    await recordRunStarted(store, deps, { runId: "run-unsafe" });
    await recordRunCheckpoint(store, deps, {
      runId: "run-unsafe",
      step: 1,
      safeToResume: false,
      state: { pending: [{ name: "read_file", kind: "read", resultRecorded: true }] },
    });

    const executed: string[] = [];
    const names = await executePlan(store, "run-unsafe", (step) => executed.push(step.name ?? ""));

    expect(names).toEqual([]);
    expect(executed).toEqual([]);
    expect(await statusOf(store, "run-unsafe")).toBe("interrupted");
  });

  it("does not replay a shell command or external action merely because no result was recorded", async () => {
    const store = createMemoryLocalFirstStore();
    await recordRunStarted(store, deps, { runId: "run-shell" });
    await recordRunCheckpoint(store, deps, {
      runId: "run-shell",
      step: 3,
      safeToResume: true,
      state: {
        pending: [
          { name: "read_file", kind: "read", resultRecorded: true },
          { name: "run_command", kind: "shell" },
          { name: "post_comment", kind: "external", external: true },
          { name: "read_file", kind: "read" },
        ],
      },
    });

    const executed: string[] = [];
    const installed = installRunRecovery(ctx(), ports(store));
    const [run] = await installed.recovered;
    expect(run.record.payload.status).toBe("interrupted");
    expect(installed.safeToResume(run)).toBe(true);

    const plan = installed.resumePlan(run);
    expect(plan.resume).toBe(true);
    expect(plan.steps.map((step) => step.name)).toEqual(["read_file"]);
    expect(plan.blocked.map((step) => step.name)).toEqual(["run_command", "post_comment", "read_file"]);

    const applied = await applyResumePlan(
      { ...plan, steps: [...plan.steps, { name: "run_command", kind: "shell" }] },
      async (step) => {
        executed.push(step.name ?? "");
      },
    );

    expect(executed).toEqual(["read_file"]);
    expect(applied.blocked.map((step) => step.name)).toContain("run_command");
    expect(await statusOf(store, "run-shell")).toBe("interrupted");
  });

  it("resumes only a recorded read after a safe checkpoint", async () => {
    const store = createMemoryLocalFirstStore();
    await recordRunStarted(store, deps, { runId: "run-safe" });
    await recordRunCheckpoint(store, deps, {
      runId: "run-safe",
      step: 1,
      safeToResume: true,
      state: { pending: [{ name: "read_file", kind: "read", resultRecorded: true }] },
    });

    const names = await executePlan(store, "run-safe", () => undefined);
    expect(names).toEqual(["read_file"]);
    expect(await statusOf(store, "run-safe")).toBe("interrupted");
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
    expect(restarted.resumePlan(recovered[0]).steps).toEqual([]);
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
    const plan = next.resumePlan(run);
    expect(plan.steps.map((step) => step.name)).toEqual(["read_file"]);
    expect(plan.blocked.map((step) => step.name)).toEqual(["run_command"]);
    const executed: string[] = [];
    await next.applyResumePlan(plan, async (step) => {
      executed.push(step.name ?? "");
    });
    expect(executed).toEqual(["read_file"]);
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
});
