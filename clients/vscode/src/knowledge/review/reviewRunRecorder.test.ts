import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyReplicaState } from "@builderforce/agent-tools/knowledge";
import type { KnowledgeStoredRun } from "../knowledgeProtocol";
import { createRunRecorder, newRunId, RUN_POST_INTERVAL_MS, runKindOf } from "./reviewRunRecorder";

const step = (path: string, outcome: "ok" | "failed" = "ok") => ({ path, phase: "extract" as const, ms: 5, outcome, lane: 0, ...(outcome === "failed" ? { reason: "boom" } : {}) });

describe("createRunRecorder", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
  afterEach(() => { vi.useRealTimers(); });

  function rig() {
    const posted: Array<{ at: number; run: KnowledgeStoredRun }> = [];
    const recorder = createRunRecorder({ id: "run-1", root: "root-a", kind: "review", post: (run) => posted.push({ at: Date.now(), run }) });
    return { recorder, posted };
  }

  it("posts the run at once when it starts", () => {
    const { posted } = rig();
    expect(posted).toHaveLength(1);
    expect(posted[0]!.run).toMatchObject({ id: "run-1", root: "root-a", kind: "review", phases: [], steps: [] });
  });

  it("posts at most once per interval however many events arrive, with the latest state", () => {
    const { recorder, posted } = rig();
    for (let i = 0; i < 50; i += 1) {
      recorder.step(step(`f${i}.ts`));
      vi.advanceTimersByTime(5);
    }
    vi.advanceTimersByTime(RUN_POST_INTERVAL_MS);
    // 250 ms of events: the start post plus one per 100 ms, never more than 10 a second.
    const gaps = posted.slice(1).map((p, i) => p.at - posted[i]!.at);
    expect(gaps.every((g) => g >= RUN_POST_INTERVAL_MS)).toBe(true);
    expect(posted.length).toBeLessThanOrEqual(1 + Math.ceil(250 / RUN_POST_INTERVAL_MS) + 1);
    expect(posted.at(-1)!.run.steps).toHaveLength(50);
  });

  it("folds progress, steps and failures through the shared reducer", () => {
    const { recorder } = rig();
    recorder.progress({ phase: "extract", done: 0, total: 10 });
    recorder.step(step("a.ts"));
    recorder.step(step("b.ts", "failed"));
    expect(recorder.run.phases[0]).toMatchObject({ phase: "extract", done: 1, total: 10 });
    expect(recorder.run.lanes[0]).toMatchObject({ phase: "extract", id: 0, path: "b.ts", done: 2 });
    expect(recorder.run.failures).toEqual([{ path: "b.ts", phase: "extract", reason: "boom" }]);
  });

  it("always posts the final run at once, even inside the interval, and nothing after it", () => {
    const { recorder, posted } = rig();
    recorder.step(step("a.ts"));
    const before = posted.length;
    const replica = { ...emptyReplicaState(), dirty: 2 };
    const final = recorder.close("done", undefined, replica);
    recorder.flush();
    expect(posted.length).toBe(before + 1);
    expect(posted.at(-1)!.run).toEqual(final);
    expect(final).toMatchObject({ outcome: "done", replica, endedAt: 1_000_000 });
    vi.advanceTimersByTime(1000);
    expect(posted.length).toBe(before + 1);
  });
});

describe("close and flush", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
  afterEach(() => { vi.useRealTimers(); });

  it("close folds the end without posting, and cancels a post that was waiting, until the host flushes", () => {
    const posted: KnowledgeStoredRun[] = [];
    const recorder = createRunRecorder({ id: "r", root: "root-a", kind: "review", post: (run) => posted.push(run) });
    recorder.step(step("a.ts")); // schedules a throttled post
    const before = posted.length;
    const closed = recorder.close("stopped");
    vi.advanceTimersByTime(1000);
    expect(posted.length).toBe(before);
    expect(closed).toMatchObject({ outcome: "stopped", endedAt: 1_000_000 });

    recorder.flush();
    expect(posted.length).toBe(before + 1);
    expect(posted.at(-1)).toEqual(closed);
  });
});

describe("run ids and kinds", () => {
  it("makes a stable file-safe id from the time and a random tail", () => {
    const id = newRunId(1_700_000_000_000);
    expect(id).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
    expect(id.startsWith((1_700_000_000_000).toString(36))).toBe(true);
    expect(newRunId(1)).not.toBe(newRunId(1));
  });

  it("names the kind from the request: seed, then forced, else review", () => {
    expect(runKindOf({ seed: true, force: true })).toBe("seed");
    expect(runKindOf({ force: true })).toBe("re-review");
    expect(runKindOf({})).toBe("review");
  });
});
