import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityGate, nextSliceSize, realClock, SLICE_MS, TYPING_QUIET_MS, UNFOCUSED_PAUSE_MS } from "./indexBudget";
import { IndexQueue, PRIORITY, SliceRunner } from "./indexScheduler";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("the indexer's priority queue (PRD 41 B6 scheduling)", () => {
  it("takes open files first, then visible, then the rest, in arrival order within a priority; a promoted path joins the end of its better bucket", () => {
    const q = new IndexQueue();
    q.push("rest-1", PRIORITY.rest);
    q.push("visible", PRIORITY.visible);
    q.push("rest-2", PRIORITY.rest);
    q.push("open", PRIORITY.open);
    q.push("rest-1", PRIORITY.open);
    q.push("open", PRIORITY.rest);
    expect(q.take(2)).toEqual(["open", "rest-1"]);
    expect(q.take(10)).toEqual(["visible", "rest-2"]);
    expect(q.size).toBe(0);
  });

  it("sizes a slice to fit 50 ms from the measured cost per file", () => {
    expect(nextSliceSize(undefined)).toBe(1);
    expect(nextSliceSize(SLICE_MS)).toBe(1);
    expect(nextSliceSize(5)).toBe(10);
    expect(nextSliceSize(1000)).toBe(1);
  });
});

describe("yielding to the person (Risks: background indexing slows typing)", () => {
  function harness() {
    const q = new IndexQueue();
    const work = vi.fn(async (_batch: string[]) => undefined);
    let runner: SliceRunner | undefined;
    const gate = new ActivityGate(realClock, () => { void runner?.kick(); });
    runner = new SliceRunner(q, { clock: realClock, pausedBy: () => gate.pausedBy(), work });
    return { q, work, gate, runner };
  }

  it("a keystroke pauses the queue; it drains once typing has been quiet", async () => {
    const { q, work, gate, runner } = harness();
    for (const p of ["a", "b", "c"]) q.push(p, PRIORITY.rest);
    gate.keystroke();
    void runner.kick();
    await vi.advanceTimersByTimeAsync(TYPING_QUIET_MS - 1);
    expect(work).not.toHaveBeenCalled();
    gate.keystroke(); // still typing: the quiet window starts again
    await vi.advanceTimersByTimeAsync(TYPING_QUIET_MS - 1);
    expect(work).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(10);
    expect(work.mock.calls.flat(2)).toEqual(["a", "b", "c"]);
  });

  it("a keystroke during a slice stops the drain at that slice's end", async () => {
    const { q, work, gate, runner } = harness();
    for (const p of ["a", "b", "c"]) q.push(p, PRIORITY.rest);
    work.mockImplementationOnce(async () => { gate.keystroke(); });
    void runner.kick();
    await vi.advanceTimersByTimeAsync(TYPING_QUIET_MS - 1);
    expect(work).toHaveBeenCalledTimes(1);
    expect(q.size).toBe(2);
    await vi.advanceTimersByTimeAsync(20);
    expect(q.size).toBe(0);
  });

  it("a window unfocused for 10 minutes pauses the queue until focus returns", async () => {
    const { q, work, gate, runner } = harness();
    gate.focus(false);
    await vi.advanceTimersByTimeAsync(UNFOCUSED_PAUSE_MS);
    expect(gate.pausedBy()).toBe("unfocused");
    q.push("a", PRIORITY.rest);
    void runner.kick();
    await vi.advanceTimersByTimeAsync(10);
    expect(work).not.toHaveBeenCalled();
    gate.focus(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(work).toHaveBeenCalledTimes(1);
  });
});
