import { describe, expect, it } from "vitest";
import { ProgressDetector } from "./progressDetector.js";
import { SERIAL_SINGLE_CALLS_AT } from "./batching.js";
import { BATCHING_NUDGE_NOTE } from "./batchingNudge.js";

const READS = new Set(["read_file", "search_code", "list_files"]);
const ports = { isReadOnly: (tool: string) => READS.has(tool) };
const okData = { data: { ok: true } };

/** One turn that made exactly one read-only call. */
function singleReadTurn(d: ProgressDetector, i: number): void {
  d.observe("read_file", { path: `f${i}.ts` }, okData);
}

describe("batchingNudge (B4 — batching nudge, chat #216 regression)", () => {
  it("advisory after 2 consecutive single-readonly turns, naming batching", () => {
    const d = new ProgressDetector({}, ports);
    singleReadTurn(d, 0);
    expect(d.endTurn()).toBeNull(); // streak 1
    singleReadTurn(d, 1);
    const a = d.endTurn();
    expect(a).toEqual({ kind: "advisory", note: BATCHING_NUDGE_NOTE });
    expect(a?.kind).toBe("advisory");
    if (a?.kind === "advisory") expect(a.note).toContain("batch");
    // Advisory only — the ladder and every signal stay untouched.
    expect(d.tripCount).toBe(0);
    expect(d.snapshot().tripsBySignal).toBeUndefined();
    // UNKEPT_READY_AT / other signals unchanged: the state carries no ladder movement.
    expect(d.snapshot().trips).toBeUndefined();
  });

  it("does NOT fire when the threshold is not yet reached (streak 1)", () => {
    const d = new ProgressDetector({}, ports);
    singleReadTurn(d, 0);
    expect(d.endTurn()).toBeNull();
    // A write turn breaks the streak before it completes.
    d.observe("edit_file", { path: "a.ts", old_string: "x", new_string: "y" }, okData);
    expect(d.endTurn()).toBeNull();
    singleReadTurn(d, 1);
    expect(d.endTurn()).toBeNull(); // streak only 1 again
  });

  it("a write turn resets the streak — the run acted, it was not serial reading", () => {
    const d = new ProgressDetector({}, ports);
    singleReadTurn(d, 0);
    expect(d.endTurn()).toBeNull();
    d.observe("edit_file", { path: "a.ts", old_string: "x", new_string: "y" }, okData);
    expect(d.endTurn()).toBeNull();
    singleReadTurn(d, 1);
    expect(d.endTurn()).toBeNull();
    singleReadTurn(d, 2);
    const a = d.endTurn();
    expect(a).toEqual({ kind: "advisory", note: BATCHING_NUDGE_NOTE });
  });

  it("a 2+ call turn resets the streak", () => {
    const d = new ProgressDetector({}, ports);
    singleReadTurn(d, 0);
    expect(d.endTurn()).toBeNull();
    // Turn with two reads — not a serial single call.
    d.observe("read_file", { path: "a.ts" }, okData);
    d.observe("search_code", { query: "x" }, okData);
    expect(d.endTurn()).toBeNull();
    singleReadTurn(d, 1);
    expect(d.endTurn()).toBeNull(); // streak 1 only
    singleReadTurn(d, 2);
    expect(d.endTurn()?.kind).toBe("advisory");
  });

  it("a zero-call turn resets the streak", () => {
    const d = new ProgressDetector({}, ports);
    singleReadTurn(d, 0);
    expect(d.endTurn()).toBeNull();
    expect(d.endTurn()).toBeNull(); // empty turn — no calls at all
    singleReadTurn(d, 1);
    expect(d.endTurn()).toBeNull();
    singleReadTurn(d, 2);
    expect(d.endTurn()?.kind).toBe("advisory");
  });

  it("is one-shot per run: a later fresh streak does not re-fire", () => {
    const d = new ProgressDetector({}, ports);
    singleReadTurn(d, 0);
    expect(d.endTurn()).toBeNull();
    singleReadTurn(d, 1);
    expect(d.endTurn()?.kind).toBe("advisory");
    // Next turn opens clean — the one note has been shown.
    singleReadTurn(d, 2);
    expect(d.endTurn()).toBeNull();
    // Even a new completed streak does not re-fire.
    singleReadTurn(d, 3);
    expect(d.endTurn()).toBeNull();
  });

  it("the threshold is data (SERIAL_SINGLE_CALLS_AT), not a magic number", () => {
    expect(SERIAL_SINGLE_CALLS_AT).toBe(2);
  });
});
