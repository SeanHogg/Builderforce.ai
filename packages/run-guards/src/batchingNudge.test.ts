import { describe, expect, it } from "vitest";
import { ProgressDetector } from "./progressDetector.js";
import { NO_PROGRESS_TURNS } from "./noProgress.js";
import { SERIAL_SINGLE_CALLS_AT } from "./batching.js";
import { BATCHING_NUDGE_NOTE } from "./batchingNudge.js";

const READS = new Set(["read_file", "search_code", "list_files"]);
const ports = { isReadOnly: (tool: string) => READS.has(tool) };
const okData = { data: { ok: true } };

/**
 * PRD 45 B4 (corrected): the nudge surfaces only on a PURE-IDLE turn — one that made no
 * ground AND no churn. A single read to a FRESH path earns ground and is real exploration,
 * so it must NOT be nudged. The streak turns therefore re-read KNOWN paths (seen already →
 * no ground, no churn → pure idle), rotating across many of them so no single target is
 * revisited in a tight window (that would trip circling_read) and so a revisit only counts
 * as re-ground after far more turns than any test runs (REGROUND_TURNS). Edits write
 * WRITTEN — a file no test ever reads — so no streak turn reads a file the run wrote (a
 * re-verifying trip). Ground turns (touch, freshReadTurn) reset the no_progress idle
 * counter between streak runs, because NO_PROGRESS_TURNS pure-idle turns in a row is
 * itself a trip and would mask the advisory.
 */

/** Pre-seeded known paths — re-reads of these earn no ground (pure idle). */
const KNOWN = Array.from({ length: 10 }, (_, i) => `known${i}.ts`);
/** The file edit tests write; never read, so no re-verifying trip shadows the streak. */
const WRITTEN = "w.ts";

/** One busy ground turn that seeds every known path: 10 calls → not a single-readonly
 *  streak turn, and every known path is now seen (later lone reads earn no ground). */
function touch(d: ProgressDetector): void {
  for (const p of KNOWN) d.observe("read_file", { path: p }, okData);
  expect(d.endTurn()).toBeNull();
}

let n = 0;
/** One pure-idle streak turn: exactly one read-only call to a rotating known path. */
function idleReadTurn(d: ProgressDetector): void {
  d.observe("read_file", { path: KNOWN[n++ % KNOWN.length]! }, okData);
}

/** One grounded single-read turn: a fresh path earns ground (resets the idle counter;
 *  B4-suppressed because the turn made ground). Extends the single-readonly streak. */
function freshReadTurn(d: ProgressDetector, i: number): void {
  d.observe("read_file", { path: `fresh${i}.ts` }, okData);
}

describe("batchingNudge (B4 — batching nudge, chat #216 regression)", () => {
  it("advisory after 2 consecutive pure-idle single-readonly turns, naming batching", () => {
    const d = new ProgressDetector({}, ports);
    touch(d);
    idleReadTurn(d);
    expect(d.endTurn()).toBeNull(); // streak 1 (idle)
    idleReadTurn(d);
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
    touch(d);
    idleReadTurn(d);
    expect(d.endTurn()).toBeNull();
    // A write turn breaks the streak before it completes.
    d.observe("edit_file", { path: WRITTEN, old_string: "x", new_string: "y" }, okData);
    expect(d.endTurn()).toBeNull();
    idleReadTurn(d);
    expect(d.endTurn()).toBeNull(); // streak only 1 again
  });

  it("a write turn resets the streak — the run acted, it was not serial reading", () => {
    const d = new ProgressDetector({}, ports);
    touch(d);
    idleReadTurn(d);
    expect(d.endTurn()).toBeNull();
    d.observe("edit_file", { path: WRITTEN, old_string: "x", new_string: "y" }, okData);
    expect(d.endTurn()).toBeNull();
    idleReadTurn(d);
    expect(d.endTurn()).toBeNull();
    idleReadTurn(d);
    const a = d.endTurn();
    expect(a).toEqual({ kind: "advisory", note: BATCHING_NUDGE_NOTE });
  });

  it("a 2+ call turn resets the streak", () => {
    const d = new ProgressDetector({}, ports);
    touch(d);
    idleReadTurn(d);
    expect(d.endTurn()).toBeNull();
    // Turn with two fresh-path reads — not a serial single call, and grounded.
    d.observe("read_file", { path: "freshA.ts" }, okData);
    d.observe("read_file", { path: "freshB.ts" }, okData);
    expect(d.endTurn()).toBeNull();
    idleReadTurn(d);
    expect(d.endTurn()).toBeNull(); // streak 1 only
    idleReadTurn(d);
    expect(d.endTurn()?.kind).toBe("advisory");
  });

  it("a zero-call turn resets the streak", () => {
    const d = new ProgressDetector({}, ports);
    touch(d);
    idleReadTurn(d);
    expect(d.endTurn()).toBeNull(); // streak 1
    expect(d.endTurn()).toBeNull(); // zero-call turn — no calls at all, streak reset
    // Without the reset this next lone read would be streak 2 and fire the note; with it
    // the streak is only 1, so nothing surfaces.
    idleReadTurn(d);
    expect(d.endTurn()).toBeNull();
  });

  it("is one-shot per run: a later fresh streak does not re-fire", () => {
    const d = new ProgressDetector({}, ports);
    touch(d);
    idleReadTurn(d);
    expect(d.endTurn()).toBeNull();
    idleReadTurn(d);
    expect(d.endTurn()?.kind).toBe("advisory");
    // A grounded turn resets the idle counter without resetting the one-shot `fired` flag.
    freshReadTurn(d, 0);
    expect(d.endTurn()).toBeNull();
    // Next idle turns open clean — the one note has been shown, and even a new completed
    // streak does not re-fire.
    idleReadTurn(d);
    expect(d.endTurn()).toBeNull();
    idleReadTurn(d);
    expect(d.endTurn()).toBeNull();
  });

  it("does NOT fire when the streak turn reached a FRESH path (ground = real exploration)", () => {
    const d = new ProgressDetector({}, ports);
    // Two consecutive single-readonly turns, but each read a fresh path → GROUND.
    freshReadTurn(d, 0);
    expect(d.endTurn()).toBeNull(); // streak 1, ground
    freshReadTurn(d, 1);
    // The streak completes, but the turn made ground — real exploration, not serial
    // re-reading — so the nudge must NOT fire.
    expect(d.endTurn()).toBeNull();
  });

  it("does NOT fire on a churn turn (a distinct edit is real work, not serial reading)", () => {
    const d = new ProgressDetector({}, ports);
    touch(d);
    idleReadTurn(d);
    expect(d.endTurn()).toBeNull(); // streak 1
    // The would-be streak-completing turn makes a distinct edit (churn — a new change),
    // which is real work, so the nudge must NOT fire: not read-only, and not idle.
    d.observe("edit_file", { path: WRITTEN, old_string: "x", new_string: "y" }, okData);
    expect(d.endTurn()).toBeNull();
  });

  it("never masks a trip: a streak turn that also fills the no_progress window yields the trip", () => {
    const d = new ProgressDetector({}, ports);
    touch(d); // the ground turn: the idle counter starts after it
    // NO_PROGRESS_TURNS pure-idle single-readonly turns in a row. The 2nd completes the
    // B4 streak and surfaces the one-shot advisory (signal-free, so it returns instead of
    // a trip); the NO_PROGRESS_TURNS-th fills the no_progress window.
    for (let i = 1; i <= NO_PROGRESS_TURNS; i++) {
      idleReadTurn(d);
      const a = d.endTurn();
      if (i === SERIAL_SINGLE_CALLS_AT) {
        expect(a?.kind).toBe("advisory"); // the one-shot note, on the signal-free streak turn
      } else if (i === NO_PROGRESS_TURNS) {
        expect(a?.kind).not.toBe("advisory");
        if (a && a.kind !== "advisory") expect(a.signal.kind).toBe("no_progress");
      } else {
        expect(a).toBeNull();
      }
    }
  });

  it("the threshold is data (SERIAL_SINGLE_CALLS_AT), not a magic number", () => {
    expect(SERIAL_SINGLE_CALLS_AT).toBe(2);
  });
});
