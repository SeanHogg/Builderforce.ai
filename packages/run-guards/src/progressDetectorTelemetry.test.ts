/**
 * The run-telemetry counters the detector carries for PRD 35 §8.2: the trips BY SIGNAL
 * and every unkept readiness claim of the run — neither reset by a trip, both surviving
 * a snapshot round trip (a cloud run resumes the detector from JSON every tick).
 */
import { describe, expect, it } from "vitest";
import { ProgressDetector } from "./progressDetector.js";
import { NO_PROGRESS_TURNS } from "./noProgress.js";
import { UNKEPT_READY_AT } from "./readinessClaim.js";

const READS = new Set(["read_file", "search_code"]);
const ports = { isReadOnly: (tool: string) => READS.has(tool) };
const okData = { data: { ok: true } };

/** One turn that says it is ready, then only reads a file it has not read before. */
function unkeptTurn(d: ProgressDetector, i: number): ReturnType<ProgressDetector["endTurn"]> {
  d.noteTurnText("Now I have everything I need.");
  d.observe("read_file", { path: `more${i}.ts` }, okData);
  return d.endTurn();
}

describe("ProgressDetector run telemetry", () => {
  it("records nothing for a run that never tripped and never claimed", () => {
    const d = new ProgressDetector({}, ports);
    d.observe("read_file", { path: "a.ts" }, okData);
    d.endTurn();
    const snap = d.snapshot();
    expect(snap.tripsBySignal).toBeUndefined();
    expect(snap.unkeptTurns).toBeUndefined();
  });

  it("counts every trip by the signal that caused it, across a snapshot round trip", () => {
    let d = new ProgressDetector({}, ports);
    d.observe("write_file", { path: "a.ts", content: "A" }, okData);
    d.observe("write_file", { path: "a.ts", content: "B" }, okData);
    d.observe("write_file", { path: "a.ts", content: "A" }, okData);
    expect(d.endTurn()?.signal.kind).toBe("edit_revert");
    d = new ProgressDetector(JSON.parse(JSON.stringify(d.snapshot())), ports);
    for (let i = 0; i < NO_PROGRESS_TURNS - 1; i++) expect(d.endTurn()).toBeNull();
    expect(d.endTurn()?.signal.kind).toBe("no_progress");
    expect(d.snapshot().trips).toBe(2);
    expect(d.snapshot().tripsBySignal).toEqual({ edit_revert: 1, no_progress: 1 });
  });

  it("counts every unkept readiness claim, including the one that tripped and reset the streak", () => {
    const d = new ProgressDetector({}, ports);
    for (let i = 0; i < UNKEPT_READY_AT - 1; i++) expect(unkeptTurn(d, i)).toBeNull();
    expect(unkeptTurn(d, UNKEPT_READY_AT)?.signal.kind).toBe("unkept_ready");
    expect(d.snapshot().claims).toBeUndefined();
    expect(d.snapshot().unkeptTurns).toBe(UNKEPT_READY_AT);
    expect(d.snapshot().tripsBySignal).toEqual({ unkept_ready: 1 });
  });

  it("does not count a claimed turn that acted", () => {
    const d = new ProgressDetector({}, ports);
    d.noteTurnText("Now I have everything I need.");
    d.observe("edit_file", { path: "a.ts", old_string: "x", new_string: "y" }, okData);
    d.endTurn();
    expect(d.snapshot().unkeptTurns).toBeUndefined();
  });
});
