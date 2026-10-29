import { describe, expect, it } from "vitest";
import { ProgressDetector } from "./progressDetector.js";
import { NO_PROGRESS_TURNS } from "./noProgress.js";
import { REVISIT_HARD_AT } from "./visitTally.js";

// PRD 35 WS8p: `unkept_ready` is the fifth signal, ranked between `circling_read` and
// `no_progress` — a turn that shows more than one reports the strongest.

const READ_ONLY = new Set(["read_file", "list_files"]);
const READY = "Now I have everything I need.";
const detector = () => new ProgressDetector({}, { isReadOnly: (tool) => READ_ONLY.has(tool) });

function turn(d: ProgressDetector, text: string, calls: Array<[string, Record<string, unknown>]>) {
  d.noteTurnText(text);
  for (const [tool, args] of calls) d.observe(tool, args, { data: { ok: true } });
  return d.endTurn();
}

describe("ProgressDetector: where unkept_ready ranks", () => {
  it("outranks no_progress when both fill on the same turn", () => {
    const d = detector();
    // Idle turns: a listing names no path, so nothing is new ground.
    for (let i = 0; i < NO_PROGRESS_TURNS - 2; i++) expect(turn(d, "", [["list_files", {}]])).toBeNull();
    expect(turn(d, READY, [["list_files", {}]])).toBeNull();
    const action = turn(d, READY, [["list_files", {}]]);
    expect(action).toMatchObject({ kind: "steer", signal: { kind: "unkept_ready" } });
  });

  it("is outranked by circling_read when both fill on the same turn", () => {
    const d = detector();
    expect(turn(d, READY, [["read_file", { path: "a.md" }]])).toBeNull();
    const again = Array.from({ length: REVISIT_HARD_AT - 1 }, (): [string, Record<string, unknown>] => ["read_file", { path: "a.md" }]);
    const action = turn(d, READY, again);
    expect(action).toMatchObject({ kind: "steer", signal: { kind: "circling_read", target: "a.md" } });
  });
});
