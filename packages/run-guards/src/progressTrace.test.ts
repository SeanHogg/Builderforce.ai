import { describe, expect, it } from "vitest";
import { ProgressDetector } from "./progressDetector.js";
import { progressTraceStep } from "./progressTrace.js";
import { BATCHING_NUDGE_NOTE } from "./batchingNudge.js";
import { NO_PROGRESS_TURNS } from "./noProgress.js";

const READS = new Set(["read_file", "search_code"]);
const ports = { isReadOnly: (tool: string) => READS.has(tool) };
const okData = { data: { ok: true } };

describe("progressTraceStep", () => {
  it("gives the B1 readiness advisory a trace row, though it is never a trip", () => {
    const d = new ProgressDetector({}, ports);
    d.noteTurnText("Now I have everything I need.");
    d.observe("read_file", { path: "f0.ts" }, okData);
    const action = d.endTurn();
    expect(action?.kind).toBe("advisory");
    expect(progressTraceStep(action!)).toEqual({
      label: "loop.progress_advisory",
      args: { advisory: "readiness" },
      result: "progress advisory (readiness): a one-off note on the next turn, not a trip",
    });
    expect(d.tripCount).toBe(0);
  });

  it("names the B4 batching nudge as its own source", () => {
    expect(progressTraceStep({ kind: "advisory", note: BATCHING_NUDGE_NOTE }).args).toEqual({ advisory: "batching" });
  });

  it("lets a host that acted on a trip record its own outcome and detail on the same row", () => {
    const d = new ProgressDetector({}, ports);
    d.observe("write_file", { path: "a.ts", content: "A" }, okData);
    d.observe("write_file", { path: "a.ts", content: "B" }, okData);
    d.observe("write_file", { path: "a.ts", content: "A" }, okData);
    const action = d.endTurn()!;
    expect(progressTraceStep(action, { outcome: "pause", detail: { trip: 1, outcome: "pause" } })).toEqual({
      label: "loop.progress_check",
      args: { trip: 1, outcome: "pause" },
      result: "progress check 1: edit_revert → pause",
    });
  });

  it("traces a trip the way hosts already record loop.progress_check", () => {
    const d = new ProgressDetector({}, ports);
    d.observe("write_file", { path: "a.ts", content: "A" }, okData);
    d.observe("write_file", { path: "a.ts", content: "B" }, okData);
    d.observe("write_file", { path: "a.ts", content: "A" }, okData);
    expect(progressTraceStep(d.endTurn()!)).toEqual({
      label: "loop.progress_check",
      args: { trip: 1, signal: "edit_revert", action: "steer" },
      result: "progress check 1: edit_revert → steer",
    });
  });

  it("a no_progress trip still traces as a check — the advisory never masks it", () => {
    const d = new ProgressDetector({}, ports);
    // Seed 10 known paths in one ground turn (the idle counter starts after it), then run
    // NO_PROGRESS_TURNS pure-idle single-readonly turns re-reading rotating known paths —
    // exactly the batchingNudge streak scenario. The SERIAL_SINGLE_CALLS_AT-th returns the
    // one-shot advisory INSTEAD of the trip that turn, but the idle window keeps filling
    // and the NO_PROGRESS_TURNS-th turn yields the no_progress trip.
    const KNOWN = Array.from({ length: 10 }, (_, i) => `known${i}.ts`);
    for (const p of KNOWN) d.observe("read_file", { path: p }, okData);
    expect(d.endTurn()).toBeNull(); // the ground turn
    let action: ReturnType<ProgressDetector["endTurn"]> = null;
    for (let i = 0; i < NO_PROGRESS_TURNS; i++) {
      d.observe("read_file", { path: KNOWN[i % KNOWN.length]! }, okData);
      action = d.endTurn();
    }
    expect(action).not.toBeNull();
    expect(action!.kind).not.toBe("advisory");
    if (action!.kind !== "advisory") {
      expect(progressTraceStep(action!).label).toBe("loop.progress_check");
      expect(action!.signal.kind).toBe("no_progress");
    }
  });
});
