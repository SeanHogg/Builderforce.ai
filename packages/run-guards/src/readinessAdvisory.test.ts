import { describe, expect, it } from "vitest";
import { ProgressDetector } from "./progressDetector.js";
import { UNKEPT_READY_AT } from "./readinessClaim.js";
import { READINESS_ADVISORY_NOTE, ReadinessAdvisory, UNKEPT_STEER_AT } from "./readinessAdvisory.js";
import { REVISIT_HARD_AT } from "./visitTally.js";

const READS = new Set(["read_file", "search_code"]);
const ports = { isReadOnly: (tool: string) => READS.has(tool) };
const okData = { data: { ok: true } };

/** A turn whose text claims readiness and whose only call is a read. */
function unkeptTurn(d: ProgressDetector, i: number): void {
  d.noteTurnText("Now I have everything I need.");
  d.observe("read_file", { path: `f${i}.ts` }, okData);
}

describe("readinessAdvisory (B1 — earlier readiness steer)", () => {
  it("fires an advisory on the FIRST unkept claim, a full UNKEPT_READY_AT before the trip", () => {
    const d = new ProgressDetector({}, ports);
    unkeptTurn(d, 0);
    const a = d.endTurn();
    // One claim: the advisory, NOT a trip — the ladder needs UNKEPT_READY_AT (2).
    expect(a).toEqual({ kind: "advisory", note: READINESS_ADVISORY_NOTE });
    expect(UNKEPT_STEER_AT).toBeLessThan(UNKEPT_READY_AT);
    // The trip count never moved — this is not a ladder trip.
    expect(d.tripCount).toBe(0);
    expect(d.snapshot().advisory?.note).toBe(READINESS_ADVISORY_NOTE);
  });

  it("keeps the existing trip at UNKEPT_READY_AT after the advisory", () => {
    const d = new ProgressDetector({}, ports);
    unkeptTurn(d, 0);
    expect(d.endTurn()?.kind).toBe("advisory");
    // Turn 2 is also an unkept claim — now the streak hits the trip threshold and the
    // EXISTING pause/steer ladder fires exactly as it did before B1.
    unkeptTurn(d, 1);
    const a = d.endTurn();
    expect(a).toMatchObject({ kind: "steer", signal: { kind: "unkept_ready", count: UNKEPT_READY_AT } });
    expect(d.tripCount).toBe(1);
  });

  it("is one-off: it does not fire again on a later unkept streak", () => {
    const d = new ProgressDetector({}, ports);
    unkeptTurn(d, 0);
    expect(d.endTurn()?.kind).toBe("advisory");
    // The advisory has now been shown for one turn — the next turn opens clean.
    d.observe("read_file", { path: "g.ts" }, okData);
    expect(d.endTurn()).toBeNull();
    expect(d.snapshot().advisory?.note ?? "").toBe("");
    // The claim streak carried through the clean turn (it neither claimed nor acted),
    // so the next unkept turn completes streak 2 → trip 1, resetting the windows. The
    // advisory stays spent — a FRESH streak afterwards does not re-trigger it.
    unkeptTurn(d, 2);
    expect(d.endTurn()?.kind).toBe("steer"); // streak 2 → trip 1, windows reset
    unkeptTurn(d, 3);
    expect(d.endTurn()).toBeNull(); // streak 1 again: still no advisory
    unkeptTurn(d, 4);
    expect(d.endTurn()?.kind).toBe("escalate"); // streak 2 → trip 2
  });

  it("fires the advisory even when the same turn trips another signal first", () => {
    const d = new ProgressDetector({}, ports);
    // One unkept claim AND a circling_read trip in the same turn: the trip wins the
    // turn, but the advisory still lands on the NEXT turn (the habit is there either
    // way). Circling is used (not an edit-revert) so the turn is also an UNKEPT claim —
    // a revert turn keeps its claim, and B1 is about claims that went unkept.
    d.noteTurnText("Now I have everything I need.");
    for (let i = 0; i < REVISIT_HARD_AT; i++) d.observe("read_file", { path: "a.md" }, okData);
    expect(d.endTurn()?.kind).toBe("steer"); // circling_read trip (REVISIT_HARD_AT reads of one target)
    d.observe("read_file", { path: "next.ts" }, okData);
    expect(d.endTurn()?.kind).toBe("advisory");
  });

  it("a turn that ACTS keeps the claim and raises nothing", () => {
    const d = new ProgressDetector({}, ports);
    d.noteTurnText("Now I have everything I need.");
    d.observe("edit_file", { path: "a.ts", old_string: "x", new_string: "y" }, okData);
    expect(d.endTurn()).toBeNull();
    expect(d.steerNote()).toBe("");
  });

  it("survives a durable resume (the one-shot state is plain JSON)", () => {
    const d = new ProgressDetector({}, ports);
    unkeptTurn(d, 0);
    expect(d.endTurn()?.kind).toBe("advisory");
    const resumed = new ProgressDetector(JSON.parse(JSON.stringify(d.snapshot())), ports);
    expect(resumed.snapshot().advisory?.note).toBe(READINESS_ADVISORY_NOTE);
    resumed.observe("read_file", { path: "h.ts" }, okData);
    expect(resumed.endTurn()).toBeNull();
  });

  it("regression: a consumed advisory does not re-fire after a durable resume", () => {
    const d = new ProgressDetector({}, ports);
    unkeptTurn(d, 0);
    expect(d.endTurn()?.kind).toBe("advisory");
    // The note rides one turn and is consumed; the run's unkept total is still ≥ the threshold.
    d.observe("read_file", { path: "g.ts" }, okData);
    expect(d.endTurn()).toBeNull();
    const snap = JSON.parse(JSON.stringify(d.snapshot()));
    expect(snap.advisory).toEqual({ note: "", fired: true });
    const resumed = new ProgressDetector(snap, ports);
    resumed.observe("read_file", { path: "h.ts" }, okData);
    expect(resumed.endTurn()).toBeNull();
  });

  it("ReadinessAdvisory.observe is data-driven off UNKEPT_STEER_AT, not a magic number", () => {
    const a = new ReadinessAdvisory();
    expect(a.observe(UNKEPT_STEER_AT - 1)).toBe("");
    expect(a.observe(UNKEPT_STEER_AT)).toBe(READINESS_ADVISORY_NOTE);
    expect(a.observe(UNKEPT_STEER_AT + 5)).toBe(READINESS_ADVISORY_NOTE); // one-shot
  });
});
