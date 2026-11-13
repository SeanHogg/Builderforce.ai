import { describe, expect, it, vi } from "vitest";

vi.mock("@builderforce/repo-map", () => ({ repoMapPort: { accepts: (p: string) => p.endsWith(".ts") } }));

import type { WorkspaceExtracted } from "@builderforce/agent-tools/knowledge";
import { L3_WORKER_HEAP_MB, runL3InWorker, workspaceRunner, type L3WorkerHandle } from "./l3Worker";
import { portableResult, type L3Job } from "./l3WorkerJob";

const job: L3Job = { folderPath: "/ws", rootId: "r" };
const result: WorkspaceExtracted = { extracted: [], snapshot: null, edges: 3 };

/** A scripted worker: the test emits its events. */
function fakeWorker() {
  const listeners: Record<string, Array<(v: unknown) => void>> = {};
  const posted: unknown[] = [];
  const handle: L3WorkerHandle & { terminated: number } = {
    terminated: 0,
    postMessage: (m) => { posted.push(m); },
    on: (event, listener) => { (listeners[event] ??= []).push(listener); },
    terminate: () => { handle.terminated += 1; },
  };
  return { handle, posted, emit: (event: string, value?: unknown) => { for (const l of listeners[event] ?? []) l(value); } };
}

describe("runL3InWorker", () => {
  it("posts the job as plain data, bounds the worker's heap, forwards progress and warnings, and resolves its result", async () => {
    const w = fakeWorker();
    const spawn = vi.fn(() => w.handle);
    const onProgress = vi.fn();
    const onWarn = vi.fn();
    const run = runL3InWorker(job, { onProgress, onWarn }, { file: "/out/w.js", spawn });
    expect(spawn).toHaveBeenCalledWith("/out/w.js", { resourceLimits: { maxOldGenerationSizeMb: L3_WORKER_HEAP_MB } });
    expect(w.posted).toEqual([job]);
    w.emit("message", { type: "progress", progress: { done: 1, total: 2 } });
    w.emit("message", { type: "warn", message: "partial" });
    w.emit("message", { type: "done", result });
    expect(await run).toEqual(result);
    expect(onProgress).toHaveBeenCalledWith({ done: 1, total: 2 });
    expect(onWarn).toHaveBeenCalledWith("partial");
    expect(w.handle.terminated).toBe(1); // one job per worker
  });

  // regression: the graph reads carry the repo map's `accepts` function, which `postMessage` cannot clone (the first worker run died on it).
  it("regression: the reads' repo-map policy never crosses the thread boundary and is put back on arrival", async () => {
    const reads = { read: ["a.ts"], skipped: [], accepts: () => true };
    expect(portableResult({ ...result, graphReads: reads }).graphReads).toEqual({ read: ["a.ts"], skipped: [] });
    expect(() => structuredClone(portableResult({ ...result, graphReads: reads }))).not.toThrow();
    const w = fakeWorker();
    const run = runL3InWorker(job, {}, { file: "/out/w.js", spawn: () => w.handle });
    w.emit("message", { type: "done", result: { ...result, graphReads: { read: ["a.ts"], skipped: [] } } });
    const arrived = (await run).graphReads!;
    expect(arrived.accepts!("src/x.ts")).toBe(true);
    expect(arrived.accepts!("x.png")).toBe(false);
    // regression: the policy also keeps the review's own skipped folders out (it had lost that half across the hop).
    expect(arrived.accepts!("node_modules/pkg/x.ts")).toBe(false);
  });

  it("regression: aborting the signal terminates the worker at once (a synchronous build no flag could reach) and the job resolves to nothing", async () => {
    const w = fakeWorker();
    const controller = new AbortController();
    const run = runL3InWorker(job, { signal: controller.signal }, { file: "/out/w.js", spawn: () => w.handle });
    controller.abort();
    expect(w.handle.terminated).toBe(1);
    expect(await run).toEqual({ extracted: [], snapshot: null });
    w.emit("exit", 1); // the terminated worker's exit is not a failure of a job nobody waits for
  });

  it("a signal already aborted never starts a worker", async () => {
    const spawn = vi.fn();
    const controller = new AbortController();
    controller.abort();
    expect(await runL3InWorker(job, { signal: controller.signal }, { file: "/out/w.js", spawn })).toEqual({ extracted: [], snapshot: null });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("regression: a worker that runs out of memory or exits rejects ONLY its job, with the reason (logged as a failed L3 pass); the host carries on", async () => {
    const oom = fakeWorker();
    const first = runL3InWorker(job, {}, { file: "/out/w.js", spawn: () => oom.handle });
    oom.emit("error", Object.assign(new Error("Worker terminated due to reaching memory limit"), { code: "ERR_WORKER_OUT_OF_MEMORY" }));
    await expect(first).rejects.toThrow(/memory limit/);
    expect(oom.handle.terminated).toBe(1);
    oom.emit("exit", 1);

    const crashed = fakeWorker();
    const second = runL3InWorker(job, {}, { file: "/out/w.js", spawn: () => crashed.handle });
    crashed.emit("exit", 3);
    await expect(second).rejects.toThrow("l3_worker_exit:3");

    const failed = fakeWorker();
    const third = runL3InWorker(job, {}, { file: "/out/w.js", spawn: () => failed.handle });
    failed.emit("message", { type: "error", error: "boom" });
    await expect(third).rejects.toThrow("boom");

    // the next job still gets its own worker
    const ok = fakeWorker();
    const next = runL3InWorker(job, {}, { file: "/out/w.js", spawn: () => ok.handle });
    ok.emit("message", { type: "done", result });
    expect(await next).toEqual(result);
  });

  it("with no worker file the same job runs in this thread (tests, a dev run before the bundle exists)", async () => {
    const inThread = vi.fn(async () => result);
    const hooks = { onWarn: vi.fn() };
    expect(await runL3InWorker(job, hooks, { file: null, inThread })).toEqual(result);
    expect(inThread).toHaveBeenCalledWith(job, hooks);
  });
});

describe("workspaceRunner", () => {
  it("adds the root id to the job and hands a finished result to the caller's thread (the review recorder's edges)", async () => {
    const inThread = vi.fn(async (_job: L3Job, _hooks: object) => result);
    const seen = vi.fn();
    const run = workspaceRunner({ folderPath: "/ws", l3RootPath: "/ws" }, seen, inThread);
    expect(await run("root-1", {})).toEqual(result);
    expect(inThread).toHaveBeenCalledWith({ folderPath: "/ws", l3RootPath: "/ws", rootId: "root-1" }, {});
    expect(seen).toHaveBeenCalledWith(result);
  });

  it("reports nothing for a run its asker stopped", async () => {
    const controller = new AbortController();
    const inThread = vi.fn(async () => { controller.abort(); return result; });
    const seen = vi.fn();
    await workspaceRunner({ folderPath: "/ws" }, seen, inThread)("r", { signal: controller.signal });
    expect(seen).not.toHaveBeenCalled();
  });
});
