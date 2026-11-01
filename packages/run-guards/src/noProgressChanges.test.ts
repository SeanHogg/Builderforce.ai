import { describe, expect, it } from "vitest";
import { LADDER_RESET_TURNS, ProgressDetector } from "./progressDetector.js";
import { CHURN_TURNS, NO_PROGRESS_TURNS, REGROUND_TURNS, NoProgressTracker } from "./noProgress.js";

const READS = new Set(["read_file", "search_code"]);
const ports = { isReadOnly: (tool: string) => READS.has(tool) };
const okData = { data: { ok: true } };
const failed = { data: { ok: false, error: "no match" }, isError: true };

function edit(d: ProgressDetector, path: string, from: string, to: string, result = okData): void {
  d.observe("edit_file", { path, old_string: from, new_string: to }, result);
}

/** A detector that has already touched a.ts, with its first (new-path) turn behind it. */
function touched(): ProgressDetector {
  const d = new ProgressDetector({}, ports);
  d.observe("read_file", { path: "a.ts" }, okData);
  expect(d.endTurn()).toBeNull();
  return d;
}

let fresh = 0;
function productiveTurns(d: ProgressDetector, n: number): void {
  for (let i = 0; i < n; i++) {
    d.observe("read_file", { path: `fresh${fresh++}.ts` }, okData);
    expect(d.endTurn()).toBeNull();
  }
}

/** Idle turns until the stretch trips; returns the trip's action. */
function stuckStretch(d: ProgressDetector) {
  for (let i = 0; i < NO_PROGRESS_TURNS - 1; i++) expect(d.endTurn()).toBeNull();
  return d.endTurn();
}

describe("no_progress counts changes the run has not made before", () => {
  it("never trips on repeated distinct edits to one already-touched source file", () => {
    const d = touched();
    for (let i = 0; i < NO_PROGRESS_TURNS * 3; i++) {
      edit(d, "a.ts", `v${i}`, `v${i + 1}`);
      expect(d.endTurn()).toBeNull();
    }
  });

  it("trips after NO_PROGRESS_TURNS when the identical edit is replayed", () => {
    const d = touched();
    edit(d, "a.ts", "x", "y");
    expect(d.endTurn()).toBeNull();
    for (let i = 0; i < NO_PROGRESS_TURNS - 1; i++) {
      edit(d, "a.ts", "x", "y");
      expect(d.endTurn()).toBeNull();
    }
    edit(d, "a.ts", "x", "y");
    expect(d.endTurn()?.signal.kind).toBe("no_progress");
  });

  it("counts a distinct successful mutating command as progress, and the same command repeated as idle", () => {
    const d = touched();
    for (let i = 0; i < NO_PROGRESS_TURNS * 2; i++) {
      d.observe("run_command", { command: `sed -i s/a/b${i}/ a.ts` }, okData);
      expect(d.endTurn()).toBeNull();
    }
    d.observe("run_command", { command: "mkdir out" }, okData);
    expect(d.endTurn()).toBeNull();
    for (let i = 0; i < NO_PROGRESS_TURNS - 1; i++) {
      d.observe("run_command", { command: "mkdir out" }, okData);
      expect(d.endTurn()).toBeNull();
    }
    d.observe("run_command", { command: "mkdir out" }, okData);
    expect(d.endTurn()?.signal.kind).toBe("no_progress");
  });

  it("does not count a failed edit as progress", () => {
    const d = touched();
    for (let i = 0; i < NO_PROGRESS_TURNS - 1; i++) {
      edit(d, "a.ts", `miss${i}`, "z", failed);
      expect(d.endTurn()).toBeNull();
    }
    edit(d, "a.ts", "miss-last", "z", failed);
    expect(d.endTurn()?.signal.kind).toBe("no_progress");
  });
});

describe("sustained progress clears the trip ladder", () => {
  it("steers every time when stuck stretches are separated by LADDER_RESET_TURNS productive turns", () => {
    const d = touched();
    for (let stretch = 0; stretch < 3; stretch++) {
      expect(stuckStretch(d)?.kind).toBe("steer");
      productiveTurns(d, LADDER_RESET_TURNS);
    }
  });

  it("still steers → escalates → pauses when the stuck stretches are back to back", () => {
    const d = touched();
    expect([1, 2, 3].map(() => stuckStretch(d)?.kind)).toEqual(["steer", "escalate", "pause"]);
  });

  it("does not clear the ladder after fewer than LADDER_RESET_TURNS productive turns", () => {
    const d = touched();
    const kinds = [];
    for (let stretch = 0; stretch < 3; stretch++) {
      kinds.push(stuckStretch(d)?.kind);
      productiveTurns(d, LADDER_RESET_TURNS - 1);
    }
    expect(kinds).toEqual(["steer", "escalate", "pause"]);
  });

  it("keeps the run telemetry when it clears the ladder", () => {
    const d = touched();
    stuckStretch(d);
    productiveTurns(d, LADDER_RESET_TURNS);
    const snap = d.snapshot();
    expect(snap.trips).toBeUndefined();
    expect(snap.tripsBySignal).toEqual({ no_progress: 1 });
  });
});

describe("snapshot round trip", () => {
  it("keeps the change fingerprints, so a replay after resume is still idle", () => {
    const t = new NoProgressTracker();
    t.observe("edit_file", { path: "a.ts", old_string: "x", new_string: "y" }, { ok: true, wrote: true });
    t.endTurn();
    const resumed = new NoProgressTracker(JSON.parse(JSON.stringify(t.snapshot())));
    resumed.observe("edit_file", { path: "a.ts", old_string: "x", new_string: "y" }, { ok: true, wrote: true });
    expect(resumed.endTurn()).toBe(1);
    resumed.observe("edit_file", { path: "a.ts", old_string: "x", new_string: "z" }, { ok: true, wrote: true });
    expect(resumed.endTurn()).toBe(0);
  });

  it("loads an older snapshot without fingerprints", () => {
    const t = new NoProgressTracker({ seen: ["a.ts"], idleTurns: 2 });
    expect(t.snapshot().changes).toBeUndefined();
  });

  it("keeps the productive streak toward the ladder reset", () => {
    let d = touched();
    stuckStretch(d);
    productiveTurns(d, 3);
    expect(d.snapshot().quietTurns).toBe(3);
    d = new ProgressDetector(JSON.parse(JSON.stringify(d.snapshot())), ports);
    productiveTurns(d, LADDER_RESET_TURNS - 3);
    expect(d.snapshot().trips).toBeUndefined();
    expect(d.snapshot().quietTurns).toBeUndefined();
  });
});

describe("re-ground: spaced revisits across a wide survey are re-engagement, not circling", () => {
  it("credits a revisit to a known path after REGROUND_TURNS idle turns", () => {
    const t = new NoProgressTracker();
    // Touch the file so it is 'seen', then let REGROUND_TURNS turns pass.
    t.observe("read_file", { path: "a.ts" }, { ok: true, wrote: false });
    t.endTurn();
    for (let i = 0; i < REGROUND_TURNS; i++) {
      t.observe("run_command", { command: `noop ${i}` }, { ok: true, wrote: true });
      expect(t.endTurn()).toBe(0); // churn, so not idle
    }
    // Revisit after the window: re-ground, so the turn is progress (idle resets).
    t.observe("read_file", { path: "a.ts" }, { ok: true, wrote: false });
    expect(t.endTurn()).toBe(0);
  });

  it("a tight revisit of one file is still caught by circling (VisitTally), not re-ground", () => {
    const d = new ProgressDetector({}, ports);
    d.observe("read_file", { path: "a.ts" }, okData);
    d.endTurn();
    // Read the SAME file every turn in a tight window: circling_read trips before no_progress.
    let kinds: Array<string | undefined> = [];
    for (let i = 0; i < 6; i++) {
      d.observe("read_file", { path: "a.ts" }, okData);
      kinds.push(d.endTurn()?.signal.kind);
    }
    expect(kinds.some((k) => k === "circling_read")).toBe(true);
    expect(kinds.filter(Boolean).slice(0, 1)).toEqual(["circling_read"]);
  });
});

describe("platform progress: a turn that moved the board is not idle", () => {
  // Mirrors the host wiring: isMutatingPlatformTool credits any builtin_* that is NOT
  // read-only — so a ticket update counts, a list does not.
  const platformPorts = {
    isPlatformProgress: (tool: string) => tool.startsWith("builtin_") && !tool.includes("_list_"),
  };

  it("credits a mutating platform call (ticket update) as progress", () => {
    const d = new ProgressDetector({}, { ...ports, ...platformPorts });
    d.observe("read_file", { path: "a.ts" }, okData);
    d.endTurn();
    for (let i = 0; i < NO_PROGRESS_TURNS * 2; i++) {
      d.observe("builtin_tasks_update", { id: 6421, status: "done" }, okData);
      expect(d.endTurn()).toBeNull();
    }
  });

  it("still trips on a read-only platform tool (a list) with no other progress", () => {
    const d = new ProgressDetector({}, { ...ports, ...platformPorts });
    // First call names a new target (ground). Then repeated identical lists are neither
    // ground nor churn, so the no-progress window fills and trips.
    d.observe("builtin_chats_list_tickets", { chatId: 187 }, okData);
    d.endTurn();
    for (let i = 0; i < NO_PROGRESS_TURNS - 1; i++) {
      d.observe("builtin_chats_list_tickets", { chatId: 187 }, okData);
      expect(d.endTurn()).toBeNull();
    }
    d.observe("builtin_chats_list_tickets", { chatId: 187 }, okData);
    expect(d.endTurn()?.signal.kind).toBe("no_progress");
  });
});


describe("churn is bounded", () => {
  function run(d: ProgressDetector, turn: (i: number) => void, turns: number): Array<string | undefined> {
    const kinds: Array<string | undefined> = [];
    for (let i = 0; i < turns; i++) {
      turn(i);
      kinds.push(d.endTurn()?.kind);
    }
    return kinds;
  }

  it("does not trip on CHURN_TURNS distinct edits to one known file", () => {
    const d = touched();
    expect(run(d, (i) => edit(d, "a.ts", `v${i}`, `v${i + 1}`), CHURN_TURNS).filter(Boolean)).toEqual([]);
  });

  it("reaches a pause on endless distinct no-op commands", () => {
    const d = touched();
    const kinds = run(d, (i) => d.observe("run_command", { command: `echo ${i}` }, okData), 200);
    expect(kinds.filter(Boolean).slice(0, 3)).toEqual(["steer", "escalate", "pause"]);
  });

  it("reaches a pause on endless one-character edit drift", () => {
    const d = touched();
    const kinds = run(d, (i) => edit(d, "a.ts", `v${i}`, `v${i + 1}`), 200);
    expect(kinds.filter(Boolean).slice(0, 3)).toEqual(["steer", "escalate", "pause"]);
  });

  it("never trips on distinct edits interleaved with a changing check", () => {
    const d = touched();
    for (let i = 0; i < 100; i++) {
      edit(d, "a.ts", `v${i}`, `v${i + 1}`);
      d.observe("run_checks", {}, { data: { ok: false, errors: [i] } });
      expect(d.endTurn()).toBeNull();
    }
  });

  it("gives a read-only shell call no credit when the isReadOnly port says so", () => {
    const d = new ProgressDetector({}, { isReadOnly: (tool, args) => tool === "run_command" && String((args as { command?: string }).command).startsWith("cat") });
    d.observe("read_file", { path: "a.ts" }, okData);
    d.endTurn();
    for (let i = 0; i < NO_PROGRESS_TURNS - 1; i++) {
      d.observe("run_command", { command: `cat a.ts ${i}` }, okData);
      expect(d.endTurn()).toBeNull();
    }
    d.observe("run_command", { command: "cat a.ts last" }, okData);
    expect(d.endTurn()?.signal.kind).toBe("no_progress");
  });

  it("never clears the ladder by churn alone", () => {
    const d = touched();
    expect(stuckStretch(d)?.kind).toBe("steer");
    for (let i = 0; i < LADDER_RESET_TURNS; i++) {
      edit(d, "a.ts", `c${i}`, `c${i + 1}`);
      expect(d.endTurn()).toBeNull();
    }
    expect(d.snapshot().trips).toBe(1);
    expect(stuckStretch(d)?.kind).toBe("escalate");
  });

  it("lets a churn turn leave the streak alone, so edit-then-check still clears the ladder", () => {
    const d = touched();
    stuckStretch(d);
    for (let i = 0; i < LADDER_RESET_TURNS; i++) {
      edit(d, "a.ts", `e${i}`, `e${i + 1}`);
      expect(d.endTurn()).toBeNull();
      d.observe("run_checks", {}, { data: { ok: false, errors: [`r${i}`] } });
      expect(d.endTurn()).toBeNull();
    }
    expect(d.snapshot().trips).toBeUndefined();
  });

  it("keeps churnTurns across a trip and a snapshot round trip", () => {
    let d = touched();
    for (let i = 0; i < 5; i++) {
      edit(d, "a.ts", `k${i}`, `k${i + 1}`);
      d.endTurn();
    }
    stuckStretch(d);
    d = new ProgressDetector(JSON.parse(JSON.stringify(d.snapshot())), ports);
    expect(d.snapshot().progress?.churnTurns).toBe(5);
    for (let i = 0; i < CHURN_TURNS - 5; i++) {
      edit(d, "a.ts", `m${i}`, `m${i + 1}`);
      d.endTurn();
    }
    expect(d.snapshot().progress?.churnTurns).toBe(CHURN_TURNS);
    expect(d.snapshot().progress?.idleTurns).toBe(0);
    edit(d, "a.ts", "over", "over2");
    d.endTurn();
    expect(d.snapshot().progress?.idleTurns).toBe(1);
  });

  it("keeps tripsBySignal through a ladder reset and a snapshot round trip", () => {
    let d = touched();
    stuckStretch(d);
    productiveTurns(d, LADDER_RESET_TURNS);
    d = new ProgressDetector(JSON.parse(JSON.stringify(d.snapshot())), ports);
    expect(d.snapshot().trips).toBeUndefined();
    expect(d.snapshot().tripsBySignal).toEqual({ no_progress: 1 });
  });
});
