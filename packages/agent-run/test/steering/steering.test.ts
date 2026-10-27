import { describe, expect, it } from "vitest";
import { isStopSteer, steeringHook } from "../../src/policy/steering/index.js";

/**
 * Steering relay — ported from `brain-embedded/src/runStore/steerInterrupt.test.ts`'s
 * drain contract and the cloud loop's `applyPendingSteering`: a late steer is never
 * lost, every drained message becomes the next user turn in the order the user sent
 * them, and one whose text IS a stop command is surfaced as an interrupt.
 */

describe("steeringHook.inject — the drained steer becomes the next user turn", () => {
  it("turns every drained message into a user row, in order", () => {
    const rows = steeringHook.inject(
      {} as never,
      ["use the v2 endpoint instead", "and add a test"],
    );
    expect(rows).toEqual([
      { role: "user", content: "use the v2 endpoint instead" },
      { role: "user", content: "and add a test" },
    ]);
  });

  it("returns nothing when nothing was steered", () => {
    expect(steeringHook.inject({} as never, [])).toBeUndefined();
  });
});

describe("isStopSteer — a steered message that IS a stop command", () => {
  it("marks a whole-message stop command as an interrupt", () => {
    expect(isStopSteer(["STOP executing"])).toBe(true);
    expect(isStopSteer(["stop the run"])).toBe(true);
  });

  it("never marks an ordinary instruction, or a child report, as a stop", () => {
    expect(isStopSteer(["write the update now"])).toBe(false);
    expect(isStopSteer(["Ada finished the schema"])).toBe(false);
    expect(isStopSteer([])).toBe(false);
  });
});
