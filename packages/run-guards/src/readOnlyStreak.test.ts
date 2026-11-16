import { describe, expect, it } from "vitest";
import { READ_ONLY_STREAK_CALLS, READ_ONLY_STREAK_TURNS, ReadOnlyStreak } from "./readOnlyStreak.js";

function turn(s: ReadOnlyStreak, calls: boolean[]) {
  for (const readOnly of calls) s.observe(readOnly);
  return s.endTurn();
}

describe("ReadOnlyStreak", () => {
  it("thresholds are data", () => {
    expect(READ_ONLY_STREAK_TURNS).toBe(6);
    expect(READ_ONLY_STREAK_CALLS).toBe(18);
  });

  it("extends on all-read-only turns, counting turns and calls", () => {
    const s = new ReadOnlyStreak();
    expect(turn(s, [true, true])).toEqual({ turns: 1, calls: 2 });
    expect(turn(s, [true, true, true])).toEqual({ turns: 2, calls: 5 });
  });

  it("a turn with any non-read-only call resets it", () => {
    const s = new ReadOnlyStreak();
    turn(s, [true, true]);
    expect(turn(s, [true, false, true])).toEqual({ turns: 0, calls: 0 });
  });

  it("a turn with no calls (a final answer) resets it", () => {
    const s = new ReadOnlyStreak();
    turn(s, [true]);
    expect(s.endTurn()).toEqual({ turns: 0, calls: 0 });
  });

  it("reset() clears it", () => {
    const s = new ReadOnlyStreak();
    turn(s, [true]);
    s.reset();
    expect(s.snapshot()).toEqual({ turns: 0, calls: 0 });
  });

  it("survives a JSON round trip", () => {
    const s = new ReadOnlyStreak();
    turn(s, [true, true]);
    const resumed = new ReadOnlyStreak(JSON.parse(JSON.stringify(s.snapshot())));
    expect(turn(resumed, [true])).toEqual({ turns: 2, calls: 3 });
  });
});
