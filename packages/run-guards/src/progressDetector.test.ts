import { describe, expect, it } from "vitest";
import { ProgressDetector, type ProgressAction } from "./progressDetector.js";
import { NO_PROGRESS_TURNS } from "./noProgress.js";
import { REVISIT_HARD_AT } from "./visitTally.js";
import { FAILURE_HARD_AT } from "./failureTally.js";

const READS = new Set(["read_file", "search_code"]);
const ports = { isReadOnly: (tool: string) => READS.has(tool) };
const okData = { data: { ok: true } };

/** The trip a turn ended in — narrowed off the B1 advisory (none of these tests claim
 *  readiness, so an advisory never appears, but tsc must see the union discriminated). */
const trip = (a: ProgressAction | null) => (a && a.kind !== "advisory" ? a.signal : undefined);

describe("ProgressDetector", () => {
  it("is silent for a run that keeps reaching new files", () => {
    const d = new ProgressDetector({}, ports);
    for (let i = 0; i < 10; i++) {
      d.observe("read_file", { path: `f${i}.ts` }, okData);
      expect(d.endTurn()).toBeNull();
    }
  });

  it("trips no_progress after the idle window, then steers → escalates → pauses on later trips", () => {
    const d = new ProgressDetector({}, ports);
    d.observe("read_file", { path: "a.ts" }, okData);
    expect(d.endTurn()).toBeNull();
    const actions = [];
    for (let trip = 0; trip < 3; trip++) {
      for (let i = 0; i < NO_PROGRESS_TURNS - 1; i++) expect(d.endTurn()).toBeNull();
      actions.push(d.endTurn());
    }
    expect(actions.map((a) => a?.kind)).toEqual(["steer", "escalate", "pause"]);
    expect(trip(actions[0] ?? null)?.kind).toBe("no_progress");
  });

  it("shows a steer for exactly one turn", () => {
    const d = new ProgressDetector({}, ports);
    d.observe("write_file", { path: "a.ts", content: "A" }, okData);
    d.observe("write_file", { path: "a.ts", content: "B" }, okData);
    d.observe("write_file", { path: "a.ts", content: "A" }, okData);
    const a = d.endTurn();
    expect(a).toMatchObject({ kind: "steer", signal: { kind: "edit_revert", target: "a.ts" } });
    expect(d.steerNote()).toContain("a.ts");
    d.observe("read_file", { path: "new.ts" }, okData);
    expect(d.endTurn()).toBeNull();
    expect(d.steerNote()).toBe("");
  });

  it("trips circling_read on the hard revisit count, and a write to the file excuses it", () => {
    const d = new ProgressDetector({}, ports);
    for (let i = 0; i < REVISIT_HARD_AT - 1; i++) d.observe("read_file", { path: "a.ts", offset: i * 10 }, okData);
    d.observe("edit_file", { path: "a.ts", old_string: "x", new_string: "y" }, okData);
    d.observe("read_file", { path: "a.ts" }, okData);
    expect(d.endTurn()).toBeNull();
    for (let i = 0; i < REVISIT_HARD_AT; i++) d.observe("read_file", { path: "b.ts", offset: i }, okData);
    expect(trip(d.endTurn())).toMatchObject({ kind: "circling_read", target: "b.ts", count: REVISIT_HARD_AT });
  });

  it("trips repeated_failure on the identical failing call, quoting its error", () => {
    const d = new ProgressDetector({}, ports);
    for (let i = 0; i < FAILURE_HARD_AT; i++) d.observe("search_code", { query: "x" }, { data: { ok: false, error: "bad scope" }, isError: true });
    expect(trip(d.endTurn())).toMatchObject({ kind: "repeated_failure", tool: "search_code", reason: "bad scope" });
  });

  it("reports the strongest signal of a turn", () => {
    const d = new ProgressDetector({}, ports);
    for (let i = 0; i < FAILURE_HARD_AT; i++) d.observe("search_code", { query: "x" }, { data: { ok: false }, isError: true });
    d.observe("edit_file", { path: "a.ts", old_string: "x", new_string: "y" }, okData);
    d.observe("edit_file", { path: "a.ts", old_string: "y", new_string: "x" }, okData);
    expect(trip(d.endTurn())?.kind).toBe("edit_revert");
  });

  it("keeps judging the whole run across a durable resume", () => {
    const d = new ProgressDetector({}, ports);
    d.observe("write_file", { path: "a.ts", content: "A" }, okData);
    d.observe("write_file", { path: "a.ts", content: "B" }, okData);
    d.endTurn();
    const resumed = new ProgressDetector(JSON.parse(JSON.stringify(d.snapshot())), ports);
    resumed.observe("write_file", { path: "a.ts", content: "A" }, okData);
    expect(trip(resumed.endTurn())?.kind).toBe("edit_revert");
  });

  it("trips reverifying when a turn only re-reads files the run itself wrote", () => {
    const d = new ProgressDetector({}, ports);
    // Turn 1: the run writes and verifies a file.
    d.observe("edit_file", { path: "src/a.ts", old_string: "x", new_string: "y" }, okData);
    expect(d.endTurn()).toBeNull();
    // Turn 2: it re-reads that same file it wrote — no new path, no change, no test movement.
    d.observe("read_file", { path: "src/a.ts" }, okData);
    const a = d.endTurn();
    expect(a).toMatchObject({ kind: "steer", signal: { kind: "reverifying" } });
    expect(d.steerNote()).toContain("re-verify");
  });

  it("does not trip reverifying when the turn also breaks new ground", () => {
    const d = new ProgressDetector({}, ports);
    d.observe("edit_file", { path: "src/a.ts", old_string: "x", new_string: "y" }, okData);
    expect(d.endTurn()).toBeNull();
    // The run wrote a file AND reached a new one — that is real work, not a verification loop.
    d.observe("read_file", { path: "src/a.ts" }, okData);
    d.observe("read_file", { path: "src/never-seen.ts" }, okData);
    expect(d.endTurn()).toBeNull();
  });

  it("counts a changed check result as progress, an unchanged re-run as idle", () => {
    const d = new ProgressDetector({}, ports);
    d.observe("read_file", { path: "a.ts" }, okData);
    d.endTurn();
    let tripped = false;
    for (let i = 0; i < NO_PROGRESS_TURNS + 2; i++) {
      d.observe("run_checks", {}, { data: { ok: false, errors: [i] } });
      tripped ||= d.endTurn() !== null;
    }
    expect(tripped).toBe(false);
    for (let i = 0; i < NO_PROGRESS_TURNS + 1; i++) {
      d.observe("run_checks", {}, { data: { ok: false, errors: ["same"] } });
      tripped ||= d.endTurn() !== null;
    }
    expect(tripped).toBe(true);
  });
});
