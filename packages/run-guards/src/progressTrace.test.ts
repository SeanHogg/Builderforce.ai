import { describe, expect, it } from "vitest";
import { ProgressDetector } from "./progressDetector.js";
import { progressTraceStep } from "./progressTrace.js";
import { BATCHING_NUDGE_NOTE } from "./batchingNudge.js";

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
});
