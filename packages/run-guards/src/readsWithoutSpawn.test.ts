import { describe, expect, it } from "vitest";
import { READS_BEFORE_DELEGATION_NUDGE, ReadsWithoutSpawn } from "./readsWithoutSpawn.js";

describe("ReadsWithoutSpawn", () => {
  it("is due on the sixth read with no spawn, and only once", () => {
    const t = new ReadsWithoutSpawn();
    for (let i = 1; i < READS_BEFORE_DELEGATION_NUDGE; i += 1) {
      t.record("read");
      expect(t.due()).toBe(false);
    }
    expect(t.record("read")).toBe(6);
    expect(t.due()).toBe(true);
    t.markNudged();
    t.record("read");
    expect(t.due()).toBe(false);
  });

  it("never fires once a spawn was attempted", () => {
    const t = new ReadsWithoutSpawn();
    t.record("read");
    t.record("spawn");
    for (let i = 0; i < 10; i += 1) t.record("read");
    expect(t.due()).toBe(false);
    expect(t.snapshot()).toEqual({ reads: 1, spawned: true, nudged: false });
  });

  it("ignores other calls and round-trips its state", () => {
    const t = new ReadsWithoutSpawn();
    t.record("other");
    t.record("read");
    const back = new ReadsWithoutSpawn(t.snapshot());
    expect(back.snapshot()).toEqual({ reads: 1, spawned: false, nudged: false });
    expect(back.due(1)).toBe(true);
  });
});
