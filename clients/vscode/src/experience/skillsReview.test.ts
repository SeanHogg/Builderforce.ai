import { describe, expect, it } from "vitest";
import type { Episode } from "@seanhogg/builderforce-memory-engine";
import { buildReview, defaultEpisodeName } from "./skillsReview";

const target = (name: string) => ({ name, automationId: "", controlType: "Edit", className: "", windowTitle: "", processName: "", relX: 0, relY: 0 });

const episode: Episode = {
  id: "e1",
  name: "Ledger",
  program: "C:\\apps\\ledger.exe",
  args: [],
  startedAt: 1,
  steps: [
    { id: "a", atMs: 0, action: { kind: "setValue", target: target("Amount"), value: "5" } },
    { id: "b", atMs: 1, action: { kind: "setValue", target: target("Password"), value: "", secret: true } },
    { id: "c", atMs: 2, action: { kind: "click", target: target("Send") } },
    { id: "d", atMs: 3, action: { kind: "keys", keys: "{TAB}" } },
  ],
};

describe("buildReview", () => {
  const review = buildReview(episode);

  it("suggests a parameter name for typed values only", () => {
    expect(review.steps.map((s) => s.paramName)).toEqual(["amount", "password", "", ""]);
    expect(review.steps.map((s) => s.isValue)).toEqual([true, true, false, false]);
  });

  it("marks secrets and never carries a value", () => {
    expect(review.steps[1]!.secret).toBe(true);
    expect(JSON.stringify(review)).not.toContain('"value"');
  });

  it("defaults the approval gate on for an irreversible click only", () => {
    expect(review.steps.map((s) => s.requiresApproval)).toEqual([false, false, true, false]);
  });

  it("names keys steps by the keys pressed", () => {
    expect(review.steps[3]).toMatchObject({ kind: "keys", target: "{TAB}" });
  });
});

describe("defaultEpisodeName", () => {
  it("uses the program's file name without its extension", () => {
    expect(defaultEpisodeName("C:\\apps\\ledger.exe")).toBe("ledger");
    expect(defaultEpisodeName("/Applications/Calc.app")).toBe("Calc");
  });
});
