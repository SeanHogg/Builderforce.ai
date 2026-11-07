import { describe, expect, it, vi } from "vitest";
import type { ExtractJob, ExtractJobResult } from "@seanhogg/builderforce-memory/knowledge";
import { createExtractPool, defaultExtractPoolSize, type PoolWorker } from "./extractPool";

class FakeWorker implements PoolWorker {
  readonly posted: Array<{ id: number; job: ExtractJob }> = [];
  terminated = false;
  private readonly handlers = new Map<string, Array<(value: unknown) => void>>();
  on(event: string, listener: (value: any) => void): this {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), listener]);
    return this;
  }
  postMessage(message: unknown): void { this.posted.push(message as { id: number; job: ExtractJob }); }
  terminate(): Promise<number> { this.terminated = true; return Promise.resolve(0); }
  emit(event: string, value: unknown): void { for (const h of this.handlers.get(event) ?? []) h(value); }
  reply(index: number, result: ExtractJobResult): void { this.emit("message", { id: this.posted[index]!.id, result }); }
}

const jobOf = (path: string): ExtractJob => ({ rootId: "r", path, hash: path, doc: {} as ExtractJob["doc"], knownKeys: [] });
const done = (tag: string): ExtractJobResult => ({ extracted: [], sections: [{ text: tag } as never] });

function rig(size: number) {
  const workers: FakeWorker[] = [];
  const handle = createExtractPool({ size, workerFile: "worker.js", spawn: () => { const w = new FakeWorker(); workers.push(w); return w; } });
  return { workers, ...handle };
}

describe("createExtractPool", () => {
  it("runs at most `size` jobs at once, one per worker, in FIFO order, starting workers lazily", async () => {
    const { pool, workers } = rig(2);
    expect(workers).toHaveLength(0);
    const results = ["a", "b", "c", "d"].map((p) => pool(jobOf(p)));
    expect(workers).toHaveLength(2);
    expect(workers.map((w) => w.posted.map((m) => m.job.path))).toEqual([["a"], ["b"]]);

    workers[1]!.reply(0, done("b"));
    await expect(results[1]).resolves.toEqual(done("b"));
    // The freed worker takes the next queued job (c), not the busy one.
    expect(workers[1]!.posted.map((m) => m.job.path)).toEqual(["b", "c"]);
    expect(workers[0]!.posted).toHaveLength(1);

    workers[0]!.reply(0, done("a"));
    await expect(results[0]).resolves.toEqual(done("a"));
    expect(workers[0]!.posted.map((m) => m.job.path)).toEqual(["a", "d"]);
    expect(workers).toHaveLength(2);
  });

  it("rejects a job whose worker answers with an error, and keeps the worker", async () => {
    const { pool, workers } = rig(1);
    const failing = pool(jobOf("x"));
    workers[0]!.emit("message", { id: workers[0]!.posted[0]!.id, error: "parse blew up" });
    await expect(failing).rejects.toThrow("parse blew up");
    const next = pool(jobOf("y"));
    expect(workers).toHaveLength(1);
    workers[0]!.reply(1, done("y"));
    await expect(next).resolves.toEqual(done("y"));
  });

  it("terminates the worker of an aborted running job and respawns for the next job", async () => {
    const { pool, workers } = rig(1);
    const controller = new AbortController();
    const running = pool(jobOf("slow"), controller.signal);
    const queued = pool(jobOf("after"));
    controller.abort();
    await expect(running).rejects.toMatchObject({ name: "AbortError" });
    expect(workers[0]!.terminated).toBe(true);
    // The queued job went to a fresh worker.
    expect(workers).toHaveLength(2);
    expect(workers[1]!.posted.map((m) => m.job.path)).toEqual(["after"]);
    workers[1]!.reply(0, done("after"));
    await expect(queued).resolves.toEqual(done("after"));
  });

  it("rejects an aborted job that was still queued without touching any worker", async () => {
    const { pool, workers } = rig(1);
    const first = pool(jobOf("one"));
    const controller = new AbortController();
    const queued = pool(jobOf("two"), controller.signal);
    controller.abort();
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    expect(workers[0]!.terminated).toBe(false);
    workers[0]!.reply(0, done("one"));
    await expect(first).resolves.toEqual(done("one"));
  });

  it("rejects a job already aborted when it is submitted", async () => {
    const { pool, workers } = rig(1);
    const controller = new AbortController();
    controller.abort();
    await expect(pool(jobOf("x"), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(workers).toHaveLength(0);
  });

  it("rejects the job of a crashed worker with the reason, and respawns it", async () => {
    const { pool, workers } = rig(1);
    const crashing = pool(jobOf("boom"));
    const after = pool(jobOf("next"));
    workers[0]!.emit("error", new Error("out of memory"));
    await expect(crashing).rejects.toThrow(/crashed: out of memory/);
    expect(workers).toHaveLength(2);
    expect(workers[1]!.posted.map((m) => m.job.path)).toEqual(["next"]);
    workers[1]!.reply(0, done("next"));
    await expect(after).resolves.toEqual(done("next"));
  });

  it("rejects the job of a worker that exits, once", async () => {
    const { pool, workers } = rig(1);
    const lost = pool(jobOf("gone"));
    workers[0]!.emit("exit", 1);
    workers[0]!.emit("exit", 1);
    await expect(lost).rejects.toThrow(/exited \(code 1\)/);
    expect(workers).toHaveLength(1);
  });

  it("rejects what is waiting or running when disposed, and refuses new jobs", async () => {
    const { pool, workers, dispose } = rig(1);
    const running = pool(jobOf("a"));
    const queued = pool(jobOf("b"));
    dispose();
    await expect(running).rejects.toThrow(/disposed/);
    await expect(queued).rejects.toThrow(/disposed/);
    expect(workers[0]!.terminated).toBe(true);
    await expect(pool(jobOf("c"))).rejects.toThrow(/disposed/);
  });
});

describe("per-job timeout (PRD 41 A10)", () => {
  it("rejects a job that never answers with 'timeout', recycles its worker and runs the next job on a fresh one", async () => {
    vi.useFakeTimers();
    try {
      const workers: FakeWorker[] = [];
      const { pool } = createExtractPool({ size: 1, workerFile: "w.js", jobTimeoutMs: 10_000, spawn: () => { const w = new FakeWorker(); workers.push(w); return w; } });
      const hung = pool(jobOf("hang"));
      const next = pool(jobOf("next"));
      const caught = expect(hung).rejects.toThrow("timeout");
      await vi.advanceTimersByTimeAsync(10_000);
      await caught;
      expect(workers[0]!.terminated).toBe(true);
      expect(workers).toHaveLength(2);
      expect(workers[1]!.posted.map((m) => m.job.path)).toEqual(["next"]);
      workers[1]!.reply(0, done("next"));
      await expect(next).resolves.toEqual(done("next"));
    } finally { vi.useRealTimers(); }
  });

  it("counts from the post, not from the queue: a queued job is not timed while it waits", async () => {
    vi.useFakeTimers();
    try {
      const workers: FakeWorker[] = [];
      const { pool } = createExtractPool({ size: 1, workerFile: "w.js", jobTimeoutMs: 10_000, spawn: () => { const w = new FakeWorker(); workers.push(w); return w; } });
      const first = pool(jobOf("a"));
      const second = pool(jobOf("b"));
      await vi.advanceTimersByTimeAsync(9_000);
      workers[0]!.reply(0, done("a"));
      await first;
      await vi.advanceTimersByTimeAsync(9_000); // 18 s since b was queued, 9 s since posted
      workers[0]!.reply(1, done("b"));
      await expect(second).resolves.toEqual(done("b"));
    } finally { vi.useRealTimers(); }
  });

  it("warm() starts every slot's worker without a job", () => {
    const { workers, warm } = rig(3);
    warm();
    expect(workers).toHaveLength(3);
    expect(workers.every((w) => w.posted.length === 0)).toBe(true);
  });
});

describe("a worker that never loads", () => {
  const fallback = async (job: ExtractJob): Promise<ExtractJobResult> => done(`in-thread:${job.path}`);

  function rigWithFallback(size: number) {
    const workers: FakeWorker[] = [];
    const downs: string[] = [];
    const handle = createExtractPool({
      size, workerFile: "worker.js", fallback, onDown: (r) => downs.push(r),
      spawn: () => { const w = new FakeWorker(); workers.push(w); return w; },
    });
    return { workers, downs, ...handle };
  }

  it("takes the pool down (it died before ready): the held job and every later one run in-thread, none fails", async () => {
    const { pool, workers, downs, state } = rigWithFallback(2);
    const first = pool(jobOf("a"));
    const second = pool(jobOf("b"));
    const queued = pool(jobOf("c"));
    workers[0]!.emit("error", new Error("Cannot find module"));

    await expect(first).resolves.toEqual(done("in-thread:a"));
    await expect(queued).resolves.toEqual(done("in-thread:c"));
    await expect(second).resolves.toEqual(done("in-thread:b"));
    expect(downs).toHaveLength(1);
    expect(state().down).toMatch(/crashed: Cannot find module/);
    expect(workers.every((w) => w.terminated)).toBe(true);
    // Later jobs never touch a worker again.
    await expect(pool(jobOf("d"))).resolves.toEqual(done("in-thread:d"));
    expect(workers).toHaveLength(2);
  });

  it("treats a worker that exits before answering the same way", async () => {
    const { pool, workers, state } = rigWithFallback(1);
    const job = pool(jobOf("a"));
    workers[0]!.emit("exit", 1);
    await expect(job).resolves.toEqual(done("in-thread:a"));
    expect(state().down).toMatch(/exited \(code 1\)/);
  });

  it("a death after ready, on its very first job, fails only that job: the pool stays up and respawns", async () => {
    const { pool, workers, downs, state } = rigWithFallback(1);
    const lost = pool(jobOf("poison"));
    workers[0]!.emit("message", { ready: true });
    workers[0]!.emit("error", new Error("segfault"));
    await expect(lost).rejects.toThrow(/crashed: segfault/);
    expect(state().down).toBeUndefined();
    expect(downs).toHaveLength(0);
    // A fresh worker takes the next job (it is not run in-thread).
    const next = pool(jobOf("fine"));
    expect(workers).toHaveLength(2);
    workers[1]!.emit("message", { ready: true });
    workers[1]!.reply(0, done("fine"));
    await expect(next).resolves.toEqual(done("fine"));
  });

  it("a respawned worker that dies before its own ready takes the pool down", async () => {
    const { pool, workers, state } = rigWithFallback(1);
    const first = pool(jobOf("a"));
    workers[0]!.emit("message", { ready: true });
    workers[0]!.emit("exit", 1);
    await expect(first).rejects.toThrow(/exited/);
    const next = pool(jobOf("b"));
    workers[1]!.emit("exit", 1); // never said ready
    await expect(next).resolves.toEqual(done("in-thread:b"));
    expect(state().down).toMatch(/exited/);
  });

  it("goes down when a worker cannot even be started", async () => {
    const downs: string[] = [];
    const { pool, state } = createExtractPool({
      size: 1, workerFile: "x.js", fallback, onDown: (r) => downs.push(r),
      spawn: () => { throw new Error("no worker_threads"); },
    });
    await expect(pool(jobOf("a"))).resolves.toEqual(done("in-thread:a"));
    expect(state().down).toMatch(/could not start: no worker_threads/);
  });
});

describe("a queued job whose review was stopped", () => {
  it("is skipped when its turn comes, not sent to a worker", async () => {
    const { pool, workers } = rig(1);
    const first = pool(jobOf("one"));
    const controller = new AbortController();
    const stopped = pool(jobOf("stopped"), controller.signal);
    const third = pool(jobOf("three"));
    // The signal fires but the abort listener has already been consumed elsewhere: mark it aborted without notifying.
    Object.defineProperty(controller.signal, "aborted", { value: true });
    workers[0]!.reply(0, done("one"));
    await expect(first).resolves.toEqual(done("one"));
    await expect(stopped).rejects.toMatchObject({ name: "AbortError" });
    expect(workers[0]!.posted.map((m) => m.job.path)).toEqual(["one", "three"]);
    workers[0]!.reply(1, done("three"));
    await expect(third).resolves.toEqual(done("three"));
  });
});

describe("defaultExtractPoolSize", () => {
  it("is one less than the cores, between 1 and 8", () => {
    expect(defaultExtractPoolSize(1)).toBe(1);
    expect(defaultExtractPoolSize(2)).toBe(1);
    expect(defaultExtractPoolSize(4)).toBe(3);
    expect(defaultExtractPoolSize(64)).toBe(8);
  });
});
