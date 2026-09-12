import { describe, expect, it } from "vitest";
import { buildLateSteerReport, createLateSteerRegistry, lateSteerFromFrame } from "./relay-late-steers.js";

describe("late steers on the relay — held for a finishing run, handed back once", () => {
  it("holds a steer only for a run this host owns; with no such run the caller reports it at once", () => {
    const reg = createLateSteerRegistry();
    expect(reg.hold(42, { messageId: 7, text: "push" })).toBe(false);
    reg.open(42);
    expect(reg.hold(42, { messageId: 7, text: "push" })).toBe(true);
  });

  it("drains each held steer exactly once, in arrival order — so the follow-up is reported once", () => {
    const reg = createLateSteerRegistry();
    reg.open(42);
    reg.hold(42, { messageId: 7, text: "also run the tests" });
    reg.hold(42, { messageId: 8, text: "then push" });
    expect(reg.drain(42)).toEqual([
      { messageId: 7, text: "also run the tests" },
      { messageId: 8, text: "then push" },
    ]);
    expect(reg.drain(42)).toEqual([]);
    // After the drain the run is gone from this host: a later steer is a no_live_run report.
    expect(reg.hold(42, { text: "late again" })).toBe(false);
  });

  it("re-opening a run that is already open keeps what it holds", () => {
    const reg = createLateSteerRegistry();
    reg.open(42);
    reg.hold(42, { text: "a" });
    reg.open(42);
    expect(reg.drain(42)).toEqual([{ text: "a" }]);
  });

  it("reads the steer and its row id off the frame; a frame without text is not a steer", () => {
    expect(lateSteerFromFrame({ text: "  use Go  ", messageId: 7 })).toEqual({ messageId: 7, text: "use Go" });
    expect(lateSteerFromFrame({ text: "use Go", messageId: "7" })).toEqual({ text: "use Go" });
    expect(lateSteerFromFrame({ text: "   " })).toBeNull();
  });

  it("builds the report the API's late-steers route accepts", () => {
    expect(buildLateSteerReport(42, "run_finishing", [{ messageId: 7, text: "push" }])).toEqual({
      executionId: 42,
      reason: "run_finishing",
      steers: [{ messageId: 7, text: "push" }],
    });
  });
});
